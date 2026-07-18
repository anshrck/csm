import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessEntity, getAssignedCustomerOrgIds } from '@/lib/entity-access';
import type { Role, SessionUser } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/search?q=<text>
 *
 * Cross-entity, role-scoped search. Searches across:
 *   - Demands (title, description)
 *   - Tickets (number, title, description)
 *   - Services (name, description)
 *   - Knowledge articles (title, body — only PUBLISHED for customers)
 *   - Changes (title, implementationPlan)
 *   - Problems (title, rootCauseDescription)
 *
 * Returns a flat array of results grouped by `type`. Each result includes:
 *   { type, id, title, subtitle, url }
 *
 * The `url` field is a role-aware workspace URL the caller can navigate to
 * directly. The frontend's `viewToPath` helper constructs the actual URL from
 * the ViewKey — here we return the relative `/<prefix>/<view-path>` form so
 * the client can use it as a hint.
 *
 * Caps:
 *   - Max 8 results per type (so the palette stays readable).
 *   - Total max 60 results.
 *   - Min query length: 2 characters.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const rolePrefix =
    session.role === 'SERVICE_CUSTOMER'
      ? 'customer'
      : session.role === 'SCM_WORKER'
        ? 'scm'
        : session.role === 'CM_LEADER'
          ? 'cm'
          : 'owner';

  const results: SearchResult[] = [];
  const MAX_PER_TYPE = 8;

  // Run all searches in parallel; each is role-scoped.
  await Promise.all([
    searchDemands(session, q, rolePrefix, MAX_PER_TYPE, results),
    searchTickets(session, q, rolePrefix, MAX_PER_TYPE, results),
    searchServices(session, q, rolePrefix, MAX_PER_TYPE, results),
    searchKnowledge(session, q, rolePrefix, MAX_PER_TYPE, results),
    searchChanges(session, q, rolePrefix, MAX_PER_TYPE, results),
    searchProblems(session, q, rolePrefix, MAX_PER_TYPE, results),
  ]);

  return NextResponse.json({ results: results.slice(0, 60) });
}

export interface SearchResult {
  type: 'DEMAND' | 'TICKET' | 'SERVICE' | 'KNOWLEDGE' | 'CHANGE' | 'PROBLEM';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

// ---- Per-entity searches ----------------------------------------------------

async function searchDemands(
  session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  const where: Record<string, unknown> = {
    OR: [{ title: { contains: q } }, { description: { contains: q } }],
  };

  if (session.role === ('SERVICE_CUSTOMER' as Role)) {
    if (!session.orgNodeId) return;
    where.serviceCustomerId = session.orgNodeId;
  } else if (session.role === ('SCM_WORKER' as Role)) {
    // SCM sees demands assigned to them + demands from customers they serve.
    const assignedOrgIds = await getAssignedCustomerOrgIds(session.id);
    const orClauses: Record<string, unknown>[] = [{ assignedScmWorkerId: session.id }];
    if (assignedOrgIds.length) {
      orClauses.push({ serviceCustomerId: { in: assignedOrgIds } });
    }
    where.AND = [{ OR: orClauses }];
  } else if (session.role === ('SERVICE_OWNER' as Role)) {
    // Owner sees demands touching their services. relatedServiceIds is a JSON
    // string — we filter client-side after the contains query.
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    const ownedIds = owned.map((s) => s.id);
    if (ownedIds.length === 0) return;
    const rows = await db.demand.findMany({
      where,
      select: { id: true, title: true, status: true, relatedServiceIds: true },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    const filtered = rows.filter((r) => {
      let svcIds: string[] = [];
      try {
        svcIds = JSON.parse(r.relatedServiceIds || '[]');
      } catch {
        /* empty */
      }
      return svcIds.some((sid) => ownedIds.includes(sid));
    });
    for (const r of filtered.slice(0, limit)) {
      out.push({
        type: 'DEMAND',
        id: r.id,
        title: r.title,
        subtitle: r.status,
        url: `/${rolePrefix}/demands/${r.id}`,
      });
    }
    return;
  }
  // CM_LEADER — no extra filter.

  const rows = await db.demand.findMany({
    where,
    select: { id: true, title: true, status: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  for (const r of rows) {
    out.push({
      type: 'DEMAND',
      id: r.id,
      title: r.title,
      subtitle: r.status,
      url: `/${rolePrefix}/demands/${r.id}`,
    });
  }
}

async function searchTickets(
  session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  const where: Record<string, unknown> = {
    OR: [{ title: { contains: q } }, { number: { contains: q } }, { description: { contains: q } }],
  };

  if (session.role === ('SERVICE_CUSTOMER' as Role)) {
    if (!session.orgNodeId) return;
    where.serviceCustomerId = session.orgNodeId;
  } else if (session.role === ('SCM_WORKER' as Role)) {
    const assignedOrgIds = await getAssignedCustomerOrgIds(session.id);
    const orClauses: Record<string, unknown>[] = [
      { assignedUserId: session.id },
      { assignedUserId: null },
    ];
    if (assignedOrgIds.length) {
      orClauses.push({ serviceCustomerId: { in: assignedOrgIds } });
    }
    where.AND = [{ OR: orClauses }];
  } else if (session.role === ('SERVICE_OWNER' as Role)) {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    if (owned.length === 0) return;
    where.serviceId = { in: owned.map((s) => s.id) };
  }
  // CM_LEADER — no filter.

  const rows = await db.ticket.findMany({
    where,
    select: { id: true, number: true, title: true, status: true, priority: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  for (const r of rows) {
    out.push({
      type: 'TICKET',
      id: r.id,
      title: `${r.number} — ${r.title}`,
      subtitle: `${r.priority} · ${r.status}`,
      url: `/${rolePrefix}/tickets/${r.id}`,
    });
  }
}

async function searchServices(
  _session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  const rows = await db.service.findMany({
    where: {
      OR: [{ name: { contains: q } }, { description: { contains: q } }],
    },
    select: { id: true, name: true, slaClass: true, status: true, domain: true },
    take: limit,
    orderBy: { name: 'asc' },
  });
  for (const r of rows) {
    out.push({
      type: 'SERVICE',
      id: r.id,
      title: r.name,
      subtitle: `Class ${r.slaClass} · ${r.domain} · ${r.status}`,
      url: `/${rolePrefix}/catalog`,
    });
  }
}

async function searchKnowledge(
  session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  const where: Record<string, unknown> = {
    OR: [{ title: { contains: q } }, { body: { contains: q } }],
  };
  if (session.role === ('SERVICE_CUSTOMER' as Role)) {
    where.status = 'PUBLISHED';
  }

  const rows = await db.knowledgeArticle.findMany({
    where,
    select: { id: true, title: true, type: true, status: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  for (const r of rows) {
    out.push({
      type: 'KNOWLEDGE',
      id: r.id,
      title: r.title,
      subtitle: `${r.type} · ${r.status}`,
      url: `/${rolePrefix}/knowledge`,
    });
  }
}

async function searchChanges(
  session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  // Customers don't see the Changes workspace directly.
  if (session.role === ('SERVICE_CUSTOMER' as Role)) return;

  const where: Record<string, unknown> = {
    OR: [{ title: { contains: q } }, { implementationPlan: { contains: q } }],
  };

  if (session.role === ('SERVICE_OWNER' as Role)) {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    if (owned.length === 0) return;
    // affectedServiceIds is JSON — filter client-side.
    const rows = await db.change.findMany({
      where,
      select: { id: true, title: true, status: true, type: true, affectedServiceIds: true },
      take: 30,
      orderBy: { updatedAt: 'desc' },
    });
    const ownedIds = owned.map((s) => s.id);
    const filtered = rows.filter((r) => {
      let svcIds: string[] = [];
      try {
        svcIds = JSON.parse(r.affectedServiceIds || '[]');
      } catch {
        /* empty */
      }
      return svcIds.some((sid) => ownedIds.includes(sid));
    });
    for (const r of filtered.slice(0, limit)) {
      out.push({
        type: 'CHANGE',
        id: r.id,
        title: r.title,
        subtitle: `${r.type} · ${r.status}`,
        url: `/${rolePrefix}/changes`,
      });
    }
    return;
  }

  const rows = await db.change.findMany({
    where,
    select: { id: true, title: true, status: true, type: true },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
  for (const r of rows) {
    out.push({
      type: 'CHANGE',
      id: r.id,
      title: r.title,
      subtitle: `${r.type} · ${r.status}`,
      url: `/${rolePrefix}/changes`,
    });
  }
}

async function searchProblems(
  session: SessionUser,
  q: string,
  rolePrefix: string,
  limit: number,
  out: SearchResult[],
): Promise<void> {
  // Problems are internal — customers don't see them.
  if (session.role === ('SERVICE_CUSTOMER' as Role)) return;

  const where: Record<string, unknown> = {
    OR: [{ title: { contains: q } }, { rootCauseDescription: { contains: q } }],
  };

  if (session.role === ('SERVICE_OWNER' as Role)) {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    if (owned.length === 0) return;
    where.serviceId = { in: owned.map((s) => s.id) };
  }

  const rows = await db.problem.findMany({
    where,
    select: { id: true, title: true, status: true },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
  for (const r of rows) {
    out.push({
      type: 'PROBLEM',
      id: r.id,
      title: r.title,
      subtitle: r.status,
      url: `/${rolePrefix}/problems`,
    });
  }
}

// Re-export for callers that want the helper.
export { canAccessEntity };
