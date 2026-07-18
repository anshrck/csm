import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { serializeService, buildOwnerMap } from '../_serialize';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

const VALID_LIFECYCLE_STAGES = new Set([
  'PLANNED',
  'ACTIVE',
  'UNDER_REVIEW',
  'RETIREMENT_CANDIDATE',
  'RETIRED',
]);

/**
 * GET /api/services/[id]
 *
 * Single service record with active offerings, primary SLA profile, owner
 * display names, and an SLA-event count summary for governance context.
 *
 * Returns 404 when the id does not resolve to a service.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const service = await db.service.findUnique({
    where: { id },
    include: {
      offerings: {
        where: { active: true },
        orderBy: { name: 'asc' },
      },
      slaProfiles: {
        take: 1,
        orderBy: { createdAt: 'asc' },
      },
      slaEvents: {
        select: { id: true, eventType: true },
      },
    },
  });

  if (!service) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Hydrate owner display names
  const ownerIds = [service.serviceOwnerId, service.technicalOwnerId].filter(
    Boolean,
  ) as string[];
  const ownerMap = await buildOwnerMap(ownerIds);

  const serialized = serializeService(service, ownerMap);

  // SLA event context — breakdown by event type
  const slaEventCount = service.slaEvents.length;
  const slaEventsByType = {
    WARNING: service.slaEvents.filter((e) => e.eventType === 'WARNING').length,
    BREACHED: service.slaEvents.filter((e) => e.eventType === 'BREACHED').length,
    CLOSED_IN_TIME: service.slaEvents.filter(
      (e) => e.eventType === 'CLOSED_IN_TIME',
    ).length,
  };

  return NextResponse.json({
    ...serialized,
    slaEventCount,
    slaEventsByType,
    lifecycleStage: service.lifecycleStage,
    lastReviewedAt: service.lastReviewedAt?.toISOString() ?? null,
    nextReviewDue: service.nextReviewDue?.toISOString() ?? null,
    updatedAt: service.updatedAt.toISOString(),
  });
}

/**
 * PATCH /api/services/[id]
 *
 * Limited-mutation endpoint for the Service Owner workspace. Only the owner of
 * the service (or a CM Leader) may call it. Supports three fields:
 *
 *   - lastReviewedAt: ISO string | null | true  → stamps the "catalog reviewed" date
 *   - lifecycleStage: PLANNED | ACTIVE | UNDER_REVIEW | RETIREMENT_CANDIDATE | RETIRED | null
 *   - nextReviewDue:  ISO string | null         → next scheduled review date
 *
 * All fields are optional; omitting a field leaves it untouched. The audit
 * trail records the before/after snapshot so governance reviewers can see when
 * the owner last reviewed the catalog entry and any lifecycle direction change.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SERVICE_OWNER', 'CM_LEADER' as Role);
    const { id } = await params;

    const existing = await db.service.findUnique({
      where: { id },
      select: {
        id: true,
        serviceOwnerId: true,
        lastReviewedAt: true,
        lifecycleStage: true,
        name: true,
        status: true,
        nextReviewDue: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // SERVICE_OWNER may only patch their own services; CM_LEADER is unrestricted.
    if (
      session.role === 'SERVICE_OWNER' &&
      existing.serviceOwnerId !== session.id
    ) {
      return NextResponse.json(
        { error: 'You can only update services you own' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'lastReviewedAt')) {
      const v = body.lastReviewedAt;
      if (v === null) {
        data.lastReviewedAt = null;
      } else if (typeof v === 'string') {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: 'lastReviewedAt must be a valid ISO date or null' },
            { status: 400 },
          );
        }
        data.lastReviewedAt = d;
      } else if (typeof v === 'boolean' && v) {
        // `true` is a convenience for "mark reviewed now".
        data.lastReviewedAt = new Date();
      } else {
        return NextResponse.json(
          { error: 'lastReviewedAt must be a string, null, or true' },
          { status: 400 },
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'lifecycleStage')) {
      const v = body.lifecycleStage;
      if (v === null || v === undefined || v === '') {
        data.lifecycleStage = null;
      } else if (typeof v === 'string' && VALID_LIFECYCLE_STAGES.has(v.toUpperCase())) {
        const stage = v.toUpperCase();
        data.lifecycleStage = stage;
        // When moving to RETIRED, also set status to RETIRED for catalog consistency.
        if (stage === 'RETIRED') data.status = 'RETIRED';
        // When moving out of RETIRED, restore to ACTIVE.
        if (stage !== 'RETIRED' && existing.status === 'RETIRED') {
          data.status = 'ACTIVE';
        }
      } else {
        return NextResponse.json(
          { error: 'lifecycleStage must be one of PLANNED | ACTIVE | UNDER_REVIEW | RETIREMENT_CANDIDATE | RETIRED' },
          { status: 400 },
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'nextReviewDue')) {
      const v = body.nextReviewDue;
      if (v === null) {
        data.nextReviewDue = null;
      } else if (typeof v === 'string') {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: 'nextReviewDue must be a valid ISO date or null' },
            { status: 400 },
          );
        }
        data.nextReviewDue = d;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields supplied (lastReviewedAt, lifecycleStage, nextReviewDue)' },
        { status: 400 },
      );
    }

    const updated = await db.service.update({
      where: { id },
      data,
      include: {
        offerings: { where: { active: true }, orderBy: { name: 'asc' } },
        slaProfiles: { take: 1, orderBy: { createdAt: 'asc' } },
        slaEvents: { select: { id: true, eventType: true } },
      },
    });

    await auditLog({
      actor: session,
      action: 'SERVICE_CATALOG_REVIEWED',
      entityType: 'Service',
      entityId: id,
      before: {
        lastReviewedAt: existing.lastReviewedAt?.toISOString() ?? null,
        lifecycleStage: existing.lifecycleStage,
        nextReviewDue: existing.nextReviewDue?.toISOString() ?? null,
        status: existing.status,
      },
      after: {
        lastReviewedAt: updated.lastReviewedAt?.toISOString() ?? null,
        lifecycleStage: updated.lifecycleStage,
        nextReviewDue: updated.nextReviewDue?.toISOString() ?? null,
        status: updated.status,
      },
    });

    const ownerIds = [updated.serviceOwnerId, updated.technicalOwnerId].filter(
      Boolean,
    ) as string[];
    const ownerMap = await buildOwnerMap(ownerIds);
    const serialized = serializeService(updated, ownerMap);

    const slaEventCount = updated.slaEvents.length;
    const slaEventsByType = {
      WARNING: updated.slaEvents.filter((e) => e.eventType === 'WARNING').length,
      BREACHED: updated.slaEvents.filter((e) => e.eventType === 'BREACHED').length,
      CLOSED_IN_TIME: updated.slaEvents.filter(
        (e) => e.eventType === 'CLOSED_IN_TIME',
      ).length,
    };

    return NextResponse.json({
      ...serialized,
      slaEventCount,
      slaEventsByType,
      lifecycleStage: updated.lifecycleStage,
      lastReviewedAt: updated.lastReviewedAt?.toISOString() ?? null,
      nextReviewDue: updated.nextReviewDue?.toISOString() ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (msg === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
