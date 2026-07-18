import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessEntity } from '@/lib/entity-access';
import type { EntityType } from '@/lib/entity-access';
import { auditLog } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Entity Links API — unifies relations across TICKET | DEMAND | CHANGE |
 * PROBLEM | SLA_EVENT entities.
 *
 * GET /api/entity-links?fromType=TICKET&fromId=abc[&linkType=CAUSED_BY]
 * GET /api/entity-links?toType=DEMAND&toId=xyz
 *
 * POST /api/entity-links
 *   { fromType, fromId, toType, toId, linkType }
 *
 * Access: caller must have read access to BOTH the "from" and "to" entities
 * (via canAccessEntity). Each successful mutation is recorded in the audit
 * log (entityType=EntityLink).
 */

const VALID_ENTITY_TYPES = new Set<EntityType>([
  'TICKET',
  'DEMAND',
  'CHANGE',
  'PROBLEM',
  'SLA_EVENT',
  'KNOWLEDGE_ARTICLE',
  'SLA_REPORT',
  'GOVERNANCE_DECISION',
  'COMMUNICATION',
]);

const VALID_LINK_TYPES = new Set([
  'CAUSED_BY',
  'RELATES_TO',
  'CONVERTED_TO',
  'FULFILLED_BY',
  'DUPLICATES',
  'BLOCKS',
  'DEPENDS_ON',
]);

/**
 * Resolve the display title + subtitle for an arbitrary entity row.
 * Returns null if the entity does not exist.
 *
 * This is the small lookup the EntityLinks UI uses to render a friendly label
 * next to each linked entity badge — without it the client would have to
 * know which API to call per type.
 */
export async function resolveEntitySummary(
  entityType: string,
  entityId: string,
): Promise<{ title: string; subtitle: string | null; url: string | null } | null> {
  switch (entityType) {
    case 'TICKET': {
      const t = await db.ticket.findUnique({
        where: { id: entityId },
        select: { id: true, number: true, title: true, status: true, priority: true },
      });
      if (!t) return null;
      return {
        title: `${t.number} — ${t.title}`,
        subtitle: `${t.priority} · ${t.status}`,
        url: null, // client resolves via its role-aware routing
      };
    }
    case 'DEMAND': {
      const d = await db.demand.findUnique({
        where: { id: entityId },
        select: { id: true, title: true, status: true },
      });
      if (!d) return null;
      return {
        title: d.title,
        subtitle: d.status,
        url: null,
      };
    }
    case 'CHANGE': {
      const c = await db.change.findUnique({
        where: { id: entityId },
        select: { id: true, title: true, status: true, type: true },
      });
      if (!c) return null;
      return {
        title: c.title,
        subtitle: `${c.type} · ${c.status}`,
        url: null,
      };
    }
    case 'PROBLEM': {
      const p = await db.problem.findUnique({
        where: { id: entityId },
        select: { id: true, title: true, status: true },
      });
      if (!p) return null;
      return {
        title: p.title,
        subtitle: p.status,
        url: null,
      };
    }
    case 'SLA_EVENT': {
      const e = await db.slaEvent.findUnique({
        where: { id: entityId },
        select: { id: true, eventType: true, message: true, serviceId: true },
      });
      if (!e) return null;
      const svc = e.serviceId
        ? await db.service.findUnique({ where: { id: e.serviceId }, select: { name: true } })
        : null;
      return {
        title: e.message.slice(0, 100) || `${e.eventType} SLA event`,
        subtitle: `${e.eventType}${svc ? ` · ${svc.name}` : ''}`,
        url: null,
      };
    }
    case 'KNOWLEDGE_ARTICLE': {
      const k = await db.knowledgeArticle.findUnique({
        where: { id: entityId },
        select: { id: true, title: true, type: true, status: true },
      });
      if (!k) return null;
      return {
        title: k.title,
        subtitle: `${k.type} · ${k.status}`,
        url: null,
      };
    }
    default:
      return null;
  }
}

/**
 * GET /api/entity-links
 *
 * Returns an array of link rows. Each row includes both the raw link columns
 * and a `summary` object describing the OTHER side of the link (the entity
 * the caller did NOT filter by) so the UI can render without an extra round
 * trip.
 *
 * Query params:
 *   fromType / fromId — restrict to links FROM this entity
 *   toType   / toId   — restrict to links TO this entity
 *   linkType          — filter by link type
 *
 * At least one of (fromType+fromId) or (toType+toId) MUST be supplied.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const fromType = sp.get('fromType') ?? undefined;
  const fromId = sp.get('fromId') ?? undefined;
  const toType = sp.get('toType') ?? undefined;
  const toId = sp.get('toId') ?? undefined;
  const linkType = sp.get('linkType') ?? undefined;

  if ((!fromType || !fromId) && (!toType || !toId)) {
    return NextResponse.json(
      { error: 'Either fromType+fromId OR toType+toId is required' },
      { status: 400 },
    );
  }

  // Access check on the supplied "anchor" entity (the side the caller is
  // viewing from). The other side is checked below when we resolve summaries.
  if (fromType && fromId) {
    if (!VALID_ENTITY_TYPES.has(fromType as EntityType)) {
      return NextResponse.json({ error: `Invalid fromType: ${fromType}` }, { status: 400 });
    }
    const ok = await canAccessEntity(session, fromType as EntityType, fromId, 'read');
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (toType && toId) {
    if (!VALID_ENTITY_TYPES.has(toType as EntityType)) {
      return NextResponse.json({ error: `Invalid toType: ${toType}` }, { status: 400 });
    }
    const ok = await canAccessEntity(session, toType as EntityType, toId, 'read');
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const where: Record<string, unknown> = { AND: [] as Record<string, unknown>[] };
  const and = where.AND as Array<Record<string, unknown>>;
  if (fromType && fromId) and.push({ fromType, fromId });
  if (toType && toId) and.push({ toType, toId });
  if (linkType) and.push({ linkType });
  if (and.length === 0) delete where.AND;

  const rows = await db.entityLink.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Resolve the "other side" summary for each row in parallel.
  const summaries = await Promise.all(
    rows.map((r) => {
      // If we filtered by fromType+fromId, the other side is "to". Else "from".
      const otherType = fromType && fromId ? r.toType : r.fromType;
      const otherId = fromType && fromId ? r.toId : r.fromId;
      return resolveEntitySummary(otherType, otherId);
    }),
  );

  // Filter out rows whose other-side entity the caller cannot access (defensive
  // — we already checked the anchor, but the relation may point to an entity
  // the caller is not allowed to see).
  const out = await Promise.all(
    rows.map(async (r, i) => {
      const otherType = fromType && fromId ? r.toType : r.fromType;
      const otherId = fromType && fromId ? r.toId : r.fromId;
      const accessible =
        VALID_ENTITY_TYPES.has(otherType as EntityType) &&
        (await canAccessEntity(session, otherType as EntityType, otherId, 'read'));
      return {
        id: r.id,
        fromType: r.fromType,
        fromId: r.fromId,
        toType: r.toType,
        toId: r.toId,
        linkType: r.linkType,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        summary: summaries[i],
        accessible,
      };
    }),
  );

  // Drop entries the caller can't access on the other side.
  return NextResponse.json(out.filter((r) => r.accessible));
}

/**
 * POST /api/entity-links
 *
 * Create a new link. Body: { fromType, fromId, toType, toId, linkType }.
 * Caller must have read access to BOTH entities. The link is unique per
 * (fromType, fromId, toType, toId, linkType) — duplicates return 409.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fromType = typeof body?.fromType === 'string' ? body.fromType.trim().toUpperCase() : '';
  const fromId = typeof body?.fromId === 'string' ? body.fromId.trim() : '';
  const toType = typeof body?.toType === 'string' ? body.toType.trim().toUpperCase() : '';
  const toId = typeof body?.toId === 'string' ? body.toId.trim() : '';
  const linkType = typeof body?.linkType === 'string' ? body.linkType.trim().toUpperCase() : '';

  if (!fromType || !fromId || !toType || !toId || !linkType) {
    return NextResponse.json(
      { error: 'fromType, fromId, toType, toId, linkType are all required' },
      { status: 400 },
    );
  }
  if (!VALID_ENTITY_TYPES.has(fromType as EntityType)) {
    return NextResponse.json({ error: `Invalid fromType: ${fromType}` }, { status: 400 });
  }
  if (!VALID_ENTITY_TYPES.has(toType as EntityType)) {
    return NextResponse.json({ error: `Invalid toType: ${toType}` }, { status: 400 });
  }
  if (!VALID_LINK_TYPES.has(linkType)) {
    return NextResponse.json(
      { error: `Invalid linkType: ${linkType}. Valid: ${Array.from(VALID_LINK_TYPES).join(', ')}` },
      { status: 400 },
    );
  }
  if (fromType === toType && fromId === toId) {
    return NextResponse.json({ error: 'Cannot link an entity to itself' }, { status: 400 });
  }

  // Access check on both sides.
  const [fromOk, toOk] = await Promise.all([
    canAccessEntity(session, fromType as EntityType, fromId, 'write'),
    canAccessEntity(session, toType as EntityType, toId, 'write'),
  ]);
  if (!fromOk || !toOk) {
    return NextResponse.json({ error: 'Forbidden — cannot access one or both entities' }, { status: 403 });
  }

  // Idempotency: return the existing link if it already exists.
  const existing = await db.entityLink.findFirst({
    where: { fromType, fromId, toType, toId, linkType },
  });
  if (existing) {
    return NextResponse.json(
      {
        id: existing.id,
        fromType: existing.fromType,
        fromId: existing.fromId,
        toType: existing.toType,
        toId: existing.toId,
        linkType: existing.linkType,
        createdBy: existing.createdBy,
        createdAt: existing.createdAt.toISOString(),
        reused: true,
      },
      { status: 200 },
    );
  }

  const created = await db.entityLink.create({
    data: { fromType, fromId, toType, toId, linkType, createdBy: session.id },
  });

  await auditLog({
    actor: session,
    action: 'ENTITY_LINK_CREATED',
    entityType: 'EntityLink',
    entityId: created.id,
    after: { fromType, fromId, toType, toId, linkType },
  });

  return NextResponse.json(
    {
      id: created.id,
      fromType: created.fromType,
      fromId: created.fromId,
      toType: created.toType,
      toId: created.toId,
      linkType: created.linkType,
      createdBy: created.createdBy,
      createdAt: created.createdAt.toISOString(),
      reused: false,
    },
    { status: 201 },
  );
}
