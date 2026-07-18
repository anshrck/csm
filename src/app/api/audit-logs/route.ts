import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getAssignedCustomerOrgIds } from '@/lib/entity-access';

export const runtime = 'nodejs';

// GET /api/audit-logs
//
// List audit log entries with filters + role-based scoping.
//
// Query params:
//   actorId         filter by actor user id
//   entityType      filter by entity type (TICKET | DEMAND | CHANGE | ...)
//   entityId        filter by entity id
//   action          filter by action (e.g. TICKET_CREATED)
//   dateFrom        ISO date — entries created >= this date
//   dateTo          ISO date — entries created <= this date
//   customerOrgId   filter to entries that reference entities owned by this
//                   customer org (best-effort: filters on entity rows where
//                   applicable)
//   limit           integer, default 100, max 500
//
// Role scoping:
//   - CM_LEADER:        all entries.
//   - SERVICE_OWNER:    entries for entities tied to services they own.
//   - SCM_WORKER:       entries for entities tied to their assigned customer
//                       orgs (CustomerAssignment) + their own actions.
//   - SERVICE_CUSTOMER: audit is internal — 403.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'SERVICE_CUSTOMER') {
      return NextResponse.json(
        { error: 'Forbidden — audit logs are internal' },
        { status: 403 },
      );
    }

    const sp = req.nextUrl.searchParams;
    const actorId = sp.get('actorId') ?? undefined;
    const entityType = sp.get('entityType') ?? undefined;
    const entityId = sp.get('entityId') ?? undefined;
    const action = sp.get('action') ?? undefined;
    const dateFrom = sp.get('dateFrom') ?? undefined;
    const dateTo = sp.get('dateTo') ?? undefined;
    const customerOrgId = sp.get('customerOrgId') ?? undefined;

    const limitRaw = Number(sp.get('limit') ?? '100');
    const limit =
      Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (actorId) and.push({ actorId });
    if (entityType) and.push({ entityType });
    if (entityId) and.push({ entityId });
    if (action) and.push({ action });
    if (dateFrom) {
      const d = new Date(dateFrom);
      if (!isNaN(d.getTime())) and.push({ createdAt: { gte: d } });
    }
    if (dateTo) {
      const d = new Date(dateTo);
      if (!isNaN(d.getTime())) and.push({ createdAt: { lte: d } });
    }

    // customerOrgId filter — narrow to entities owned by the given customer
    // org. We expand to a set of entity IDs that we then OR-filter against.
    if (customerOrgId) {
      const ids = await collectEntityIdsForCustomerOrg(customerOrgId);
      if (ids.length === 0) {
        // No matching entities — return an empty result.
        return NextResponse.json([]);
      }
      and.push({
        OR: ids.map((pair) => ({
          entityType: pair.entityType,
          entityId: pair.entityId,
        })),
      });
    }

    // Role scoping — restrict the entity refs the caller can see.
    if (session.role === 'CM_LEADER') {
      // No additional scoping — CM Leader sees all.
    } else if (session.role === 'SERVICE_OWNER') {
      const allowed = await collectOwnerEntityRefs(session.id);
      if (allowed.length === 0) return NextResponse.json([]);
      and.push({
        OR: allowed.map((pair) => ({
          entityType: pair.entityType,
          entityId: pair.entityId,
        })),
      });
    } else if (session.role === 'SCM_WORKER') {
      const allowed = await collectScmEntityRefs(session.id);
      if (allowed.length === 0) {
        // Fall back to just the caller's own audit actions (so they always
        // see what they did, even with zero customer assignments).
        and.push({ actorId: session.id });
      } else {
        const orClauses: Record<string, unknown>[] = allowed.map((pair) => ({
          entityType: pair.entityType,
          entityId: pair.entityId,
        }));
        orClauses.push({ actorId: session.id });
        and.push({ OR: orClauses });
      }
    }

    if (and.length === 0) delete where.AND;

    const rows = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Light serialization — surface before/after as parsed JSON so the UI can
    // inspect them without re-parsing.
    const serialized = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.beforeJson ? safeParse(r.beforeJson) : null,
      after: r.afterJson ? safeParse(r.afterJson) : null,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

// ---- helpers ---------------------------------------------------------------

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function collectEntityIdsForCustomerOrg(
  customerOrgId: string,
): Promise<{ entityType: string; entityId: string }[]> {
  const refs: { entityType: string; entityId: string }[] = [];
  const tickets = await db.ticket.findMany({
    where: { serviceCustomerId: customerOrgId },
    select: { id: true },
  });
  for (const t of tickets) refs.push({ entityType: 'Ticket', entityId: t.id });
  const demands = await db.demand.findMany({
    where: { serviceCustomerId: customerOrgId },
    select: { id: true },
  });
  for (const d of demands) refs.push({ entityType: 'Demand', entityId: d.id });
  const comms = await db.communication.findMany({
    where: { serviceCustomerId: customerOrgId },
    select: { id: true },
  });
  for (const c of comms) refs.push({ entityType: 'Communication', entityId: c.id });
  return refs;
}

async function collectOwnerEntityRefs(
  userId: string,
): Promise<{ entityType: string; entityId: string }[]> {
  const refs: { entityType: string; entityId: string }[] = [];
  const services = await db.service.findMany({
    where: { serviceOwnerId: userId },
    select: { id: true },
  });
  const serviceIds = services.map((s) => s.id);
  if (serviceIds.length === 0) return refs;

  // The Service rows themselves — so owners can read their own catalog
  // review / lifecycle audit history.
  for (const s of services) refs.push({ entityType: 'Service', entityId: s.id });

  // Tickets on owned services.
  const tickets = await db.ticket.findMany({
    where: { serviceId: { in: serviceIds } },
    select: { id: true },
  });
  for (const t of tickets) refs.push({ entityType: 'Ticket', entityId: t.id });

  // Problems on owned services.
  const problems = await db.problem.findMany({
    where: { serviceId: { in: serviceIds } },
    select: { id: true },
  });
  for (const p of problems) refs.push({ entityType: 'Problem', entityId: p.id });

  // SLA events on owned services.
  const slaEvents = await db.slaEvent.findMany({
    where: { serviceId: { in: serviceIds } },
    select: { id: true },
  });
  for (const e of slaEvents) refs.push({ entityType: 'SlaEvent', entityId: e.id });

  // Demands referencing owned services (via JSON column).
  const candidates = await db.demand.findMany({
    select: { id: true, relatedServiceIds: true },
  });
  for (const d of candidates) {
    try {
      const ids: string[] = JSON.parse(d.relatedServiceIds || '[]');
      if (ids.some((sid) => serviceIds.includes(sid))) {
        refs.push({ entityType: 'Demand', entityId: d.id });
      }
    } catch {
      /* ignore */
    }
  }

  // Changes affecting owned services.
  const changeCandidates = await db.change.findMany({
    select: { id: true, affectedServiceIds: true },
  });
  for (const c of changeCandidates) {
    try {
      const ids: string[] = JSON.parse(c.affectedServiceIds || '[]');
      if (ids.some((sid) => serviceIds.includes(sid))) {
        refs.push({ entityType: 'Change', entityId: c.id });
      }
    } catch {
      /* ignore */
    }
  }

  // Knowledge articles on owned services.
  const articles = await db.knowledgeArticle.findMany({
    where: { serviceId: { in: serviceIds } },
    select: { id: true },
  });
  for (const a of articles) refs.push({ entityType: 'KnowledgeArticle', entityId: a.id });

  return refs;
}

async function collectScmEntityRefs(
  userId: string,
): Promise<{ entityType: string; entityId: string }[]> {
  const refs: { entityType: string; entityId: string }[] = [];
  const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(userId);
  if (assignedCustomerOrgIds.length === 0) return refs;

  const tickets = await db.ticket.findMany({
    where: { serviceCustomerId: { in: assignedCustomerOrgIds } },
    select: { id: true },
  });
  for (const t of tickets) refs.push({ entityType: 'Ticket', entityId: t.id });

  const demands = await db.demand.findMany({
    where: { serviceCustomerId: { in: assignedCustomerOrgIds } },
    select: { id: true },
  });
  for (const d of demands) refs.push({ entityType: 'Demand', entityId: d.id });

  const comms = await db.communication.findMany({
    where: { serviceCustomerId: { in: assignedCustomerOrgIds } },
    select: { id: true },
  });
  for (const c of comms) refs.push({ entityType: 'Communication', entityId: c.id });

  return refs;
}
