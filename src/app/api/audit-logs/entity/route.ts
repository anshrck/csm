import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessEntity, type EntityType } from '@/lib/entity-access';

export const runtime = 'nodejs';

// GET /api/audit-logs/entity?entityType=&entityId=
//
// Per-entity audit history. The caller must pass the entity-access gate (read)
// on the underlying entity before its audit history is returned.
//
// Query params:
//   entityType (required) — Ticket | Demand | Change | Problem | SlaEvent |
//                           KnowledgeArticle | SlaReport | GovernanceDecision |
//                           Communication
//   entityId   (required)
//   limit      integer, default 100, max 500
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
    const entityType = sp.get('entityType') ?? '';
    const entityId = sp.get('entityId') ?? '';
    const limitRaw = Number(sp.get('limit') ?? '100');
    const limit =
      Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId are required' },
        { status: 400 },
      );
    }

    // Normalize the incoming entityType (URL-friendly form → Prisma model
    // name). The audit log stores `entityType` as a free-form string; we
    // accept both forms (e.g. "TICKET" or "Ticket").
    const normalizedType = normalizeEntityType(entityType);
    if (!normalizedType) {
      return NextResponse.json(
        { error: `Unknown entityType: ${entityType}` },
        { status: 400 },
      );
    }

    // Entity-access gate (read).
    const ok = await canAccessEntity(session, normalizedType, entityId, 'read');
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Pull rows matching the entity — accept any casing variant of the
    // entity type, since audit log entries are written by various routes that
    // may use the Prisma model name (e.g. "Ticket") or the upper-case
    // EntityType constant (e.g. "TICKET").
    const variants = new Set<string>([
      normalizedType,
      entityType.toUpperCase(),
      entityType.toLowerCase(),
      capitalize(normalizedType),
    ]);
    const rows = await db.auditLog.findMany({
      where: {
        entityId,
        entityType: { in: Array.from(variants) },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

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

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeEntityType(raw: string): EntityType | null {
  const map: Record<string, EntityType> = {
    TICKET: 'TICKET',
    TICKETS: 'TICKET',
    DEMAND: 'DEMAND',
    DEMANDS: 'DEMAND',
    CHANGE: 'CHANGE',
    CHANGES: 'CHANGE',
    PROBLEM: 'PROBLEM',
    PROBLEMS: 'PROBLEM',
    SLA_EVENT: 'SLA_EVENT',
    SLA_EVENTS: 'SLA_EVENT',
    SLAEVENT: 'SLA_EVENT',
    KNOWLEDGE_ARTICLE: 'KNOWLEDGE_ARTICLE',
    KNOWLEDGEARTICLE: 'KNOWLEDGE_ARTICLE',
    KNOWLEDGE: 'KNOWLEDGE_ARTICLE',
    SLA_REPORT: 'SLA_REPORT',
    SLAREPORT: 'SLA_REPORT',
    GOVERNANCE_DECISION: 'GOVERNANCE_DECISION',
    GOVERNANCEDECISION: 'GOVERNANCE_DECISION',
    COMMUNICATION: 'COMMUNICATION',
    COMMUNICATIONS: 'COMMUNICATION',
  };
  return map[raw.toUpperCase()] ?? null;
}
