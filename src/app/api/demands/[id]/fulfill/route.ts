import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/fulfill
// IN_CHANGE → FULFILLED. Only allowed when the linked change.status === 'CLOSED'.
// Notifies the customer (DemandFulfilled).
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
      requestedChanges: { status: 'FULFILLED' },
      workflowState: demand.status,
    });
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (demand.status !== 'IN_CHANGE') {
      return NextResponse.json(
        { error: `Demand must be IN_CHANGE to fulfill (current: ${demand.status})` },
        { status: 409 },
      );
    }

    if (!demand.changeRequestId) {
      return NextResponse.json(
        { error: 'Demand has no linked change request' },
        { status: 409 },
      );
    }

    const change = await db.change.findUnique({
      where: { id: demand.changeRequestId },
    });
    if (!change) {
      return NextResponse.json(
        { error: 'Linked change request not found' },
        { status: 500 },
      );
    }
    if (change.status !== 'CLOSED') {
      return NextResponse.json(
        { error: `Linked change must be CLOSED before fulfillment (current: ${change.status})` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const notes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : `Change ${change.id} closed. Demand marked fulfilled by ${session.name}.`;

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        fulfilledAt: new Date(),
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'FULFILLED',
        actorId: session.id,
        actorName: session.name,
        notes,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_FULFILLED',
      entityType: 'Demand',
      entityId: id,
      before: { status: 'IN_CHANGE', fulfilledAt: demand.fulfilledAt },
      after: { status: 'FULFILLED', fulfilledAt: updated.fulfilledAt, changeId: change.id },
    });

    // Notify the customer.
    await db.notification.create({
      data: {
        userId: demand.submittedById,
        type: 'DemandFulfilled',
        title: 'Your demand has been fulfilled',
        message: `Good news — your demand "${demand.title}" has been fulfilled. You can now close it.`,
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
