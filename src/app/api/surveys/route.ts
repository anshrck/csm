import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { canAccessEntity, type EntityType } from '@/lib/entity-access';
import type { Role } from '@/lib/types';
import {
  SURVEY_INCLUDE,
  asSurveyEntityType,
  errorResponse,
  serializeSurvey,
  type SurveyEntityType,
} from './_serialize';

export const runtime = 'nodejs';

// GET /api/surveys?entityType=TICKET&entityId=...&customerId=...
// Role scoping:
//   SERVICE_CUSTOMER → only their own surveys (customerId = session.id).
//   CM_LEADER        → all surveys.
//   SERVICE_OWNER    → surveys for entities tied to services they own.
//   SCM_WORKER       → surveys for demands/tickets in their assigned scope.
//
// When an `entityId` is supplied, the caller must also pass the
// entity-access gate (read) on the underlying entity before the survey is
// returned — survey results reveal customer sentiment and must be gated the
// same way as the entity itself.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const entityType = asSurveyEntityType(sp.get('entityType'));
    const entityId = sp.get('entityId') ?? undefined;
    const customerId = sp.get('customerId') ?? undefined;

    // Per-entity gate — verify the caller can read the underlying entity.
    if (entityType && entityId) {
      const ok = await canAccessEntity(session, entityType as EntityType, entityId, 'read');
      if (!ok) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (entityType) and.push({ entityType });
    if (entityId) and.push({ entityId });
    if (customerId) and.push({ customerId });

    if (session.role === 'SERVICE_CUSTOMER') {
      and.push({ customerId: session.id });
    } else if (session.role === 'SERVICE_OWNER') {
      // Find the demands / tickets tied to services this owner owns.
      const ownedServices = await db.service.findMany({
        where: { serviceOwnerId: session.id },
        select: { id: true },
      });
      const ownedServiceIds = ownedServices.map((s) => s.id);
      if (ownedServiceIds.length === 0) {
        return NextResponse.json([]);
      }

      // Demands related to owned services — via the JSON column.
      // SQLite has no JSON query primitives in Prisma Client, so we fetch
      // candidate demand rows and filter in JS.
      const candidateDemands = await db.demand.findMany({
        where: { status: { not: 'NEW' } },
        select: { id: true, relatedServiceIds: true },
      });
      const demandIds = candidateDemands
        .filter((d) => {
          try {
            const ids: string[] = JSON.parse(d.relatedServiceIds || '[]');
            return ids.some((sid) => ownedServiceIds.includes(sid));
          } catch {
            return false;
          }
        })
        .map((d) => d.id);

      // Tickets related to owned services.
      const tickets = await db.ticket.findMany({
        where: { serviceId: { in: ownedServiceIds } },
        select: { id: true },
      });
      const ticketIds = tickets.map((t) => t.id);

      // Build an OR clause over DEMAND / TICKET entity refs.
      const orClauses: Array<Record<string, unknown>> = [];
      if (demandIds.length) {
        orClauses.push({ entityType: 'DEMAND', entityId: { in: demandIds } });
      }
      if (ticketIds.length) {
        orClauses.push({ entityType: 'TICKET', entityId: { in: ticketIds } });
      }
      if (orClauses.length === 0) {
        return NextResponse.json([]);
      }
      and.push({ OR: orClauses });
    } else if (session.role === 'SCM_WORKER') {
      // Demands assigned to this worker.
      const assignedDemands = await db.demand.findMany({
        where: { assignedScmWorkerId: session.id },
        select: { id: true },
      });
      const assignedDemandIds = assignedDemands.map((d) => d.id);
      if (assignedDemandIds.length === 0) {
        return NextResponse.json([]);
      }
      and.push({ entityType: 'DEMAND', entityId: { in: assignedDemandIds } });
    }
    // CM_LEADER → no extra scoping.

    if (and.length === 0) delete where.AND;

    const rows = await db.satisfactionSurvey.findMany({
      where,
      include: SURVEY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json(rows.map(serializeSurvey));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/surveys — create a CSAT survey.
// Body: { entityType, entityId, rating: 1-5, comment? }
// SERVICE_CUSTOMER only. Validates the entity is owned by the customer's
// orgNode (entity-access helper verifies this on the underlying entity).
// Unique on [entityType, entityId, customerId] — returns 409 if a
// survey already exists.
//
// Side effects:
//   - audit log SURVEY_CREATED.
//   - if rating <= 2, notify all CM_LEADER users (low-rating alert).
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole('SERVICE_CUSTOMER' as Role);

    const body = await req.json().catch(() => ({}));
    const entityType = asSurveyEntityType(body.entityType);
    const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';
    const rating = Number(body.rating);
    const comment =
      typeof body.comment === 'string' && body.comment.trim()
        ? body.comment.trim().slice(0, 2000)
        : null;

    if (!entityType) {
      return NextResponse.json(
        { error: 'INVALID_ENTITY_TYPE — entityType must be TICKET or DEMAND' },
        { status: 400 },
      );
    }
    if (!entityId) {
      return NextResponse.json({ error: 'INVALID_ENTITY_ID — entityId is required' }, { status: 400 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'INVALID_RATING — rating must be an integer between 1 and 5' },
        { status: 400 },
      );
    }

    // Ownership check — the customer's orgNode must own the entity.
    // The entity-access helper already encodes this for SERVICE_CUSTOMER.
    if (!session.orgNodeId) {
      return NextResponse.json({ error: 'Forbidden — no customer org on session' }, { status: 403 });
    }
    const canAccess = await canAccessEntity(
      session,
      entityType as EntityType,
      entityId,
      'write',
    );
    if (!canAccess) {
      return NextResponse.json(
        { error: 'Forbidden — you can only survey entities owned by your organization' },
        { status: 403 },
      );
    }

    // Unique constraint — has this customer already surveyed this entity?
    const existing = await db.satisfactionSurvey.findUnique({
      where: {
        entityType_entityId_customerId: {
          entityType,
          entityId,
          customerId: session.id,
        },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'CONFLICT — you have already submitted a survey for this item' },
        { status: 409 },
      );
    }

    const created = await db.satisfactionSurvey.create({
      data: {
        entityType: entityType as SurveyEntityType,
        entityId,
        customerId: session.id,
        rating,
        comment,
      },
      include: SURVEY_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'SURVEY_CREATED',
      entityType,
      entityId,
      after: {
        surveyId: created.id,
        rating,
        commentPreview: comment ? comment.slice(0, 200) : null,
      },
    });

    // Low-rating alert — fan out to all CM_LEADER users.
    if (rating <= 2) {
      const cmLeaders = await db.user.findMany({
        where: { role: 'CM_LEADER' },
        select: { id: true },
      });
      if (cmLeaders.length) {
        const title =
          rating === 1 ? 'Detractor alert — 1★ CSAT rating' : 'Low CSAT alert — 2★ rating';
        await db.notification.createMany({
          data: cmLeaders.map((u) => ({
            userId: u.id,
            type: 'CommitmentEscalated', // reuse existing notification type
            title,
            message: `${session.name} rated ${entityType.toLowerCase()} ${entityId.slice(-6)} ${rating}★${comment ? `: "${comment.slice(0, 120)}"` : ''}`,
            entityRef: `${entityType.toLowerCase()}:${entityId}`,
          })),
        });
      }
    }

    return NextResponse.json(serializeSurvey(created), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
