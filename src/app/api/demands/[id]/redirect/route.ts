import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/redirect
// UNDER_REVIEW → REDIRECTED. Body: { offeringId, reason? }.
// Demand is redirected to an existing catalog ServiceOffering (e.g. self-service).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const allowed = await authorize(session, {
      resource: 'demand',
      action: 'update',
      recordId: id,
      requestedChanges: { status: 'REDIRECTED' },
      workflowState: demand.status,
    });
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (demand.status !== 'UNDER_REVIEW') {
      return NextResponse.json(
        { error: `Demand can only be redirected from UNDER_REVIEW (current: ${demand.status})` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const offeringId =
      typeof body.offeringId === 'string' && body.offeringId.trim()
        ? body.offeringId.trim()
        : '';
    if (!offeringId) {
      return NextResponse.json(
        { error: 'offeringId is required' },
        { status: 400 },
      );
    }

    const offering = await db.serviceOffering.findUnique({
      where: { id: offeringId },
      include: { service: true },
    });
    if (!offering) {
      return NextResponse.json({ error: 'Service offering not found' }, { status: 400 });
    }

    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

    const before = {
      status: demand.status,
      redirectedToOfferingId: demand.redirectedToOfferingId,
      rejectionReason: demand.rejectionReason,
    };

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'REDIRECTED',
        redirectedToOfferingId: offeringId,
        rejectionReason: reason,
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'REDIRECTED',
        actorId: session.id,
        actorName: session.name,
        notes: `Redirected to offering "${offering.name}" (service: ${offering.service?.name ?? 'unknown'}).${reason ? ` Reason: ${reason}` : ''}`,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_REDIRECTED',
      entityType: 'Demand',
      entityId: id,
      before,
      after: {
        status: 'REDIRECTED',
        redirectedToOfferingId: offeringId,
        offeringName: offering.name,
        reason,
      },
    });

    // Notify the customer that their demand has been redirected.
    await db.notification.create({
      data: {
        userId: demand.submittedById,
        type: 'DemandRejected', // reuse the "rejected-ish" channel for visibility
        title: 'Demand redirected to catalog',
        message: `Your demand "${demand.title}" was redirected to the catalog offering "${offering.name}".${reason ? ` Reason: ${reason}` : ''}`,
        entityRef: `demand:${id}`,
      },
    });

    const fresh = await db.demand.findUnique({
      where: { id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
