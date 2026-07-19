import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/close
// FULFILLED → CLOSED (customer closes fulfilled demand, no reason required).
// OR QUOTED → CLOSED (customer declines the quote; reason required in body).
// Caller: SERVICE_CUSTOMER (must be the demand's own customer) OR SCM_WORKER/CM_LEADER
//         (for closing after fulfillment).
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
      action: 'close',
      recordId: id,
      requestedChanges: { status: 'CLOSED' },
      workflowState: demand.status,
    });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

    const isCustomer = session.role === 'SERVICE_CUSTOMER';

    // Validate current status against the close semantics.
    if (demand.status === 'FULFILLED') {
      // Customer or SCM/CM may close.
      // No reason required.
    } else if (demand.status === 'QUOTED') {
      // Only customers may decline a quote via close.
      if (!isCustomer) {
        return NextResponse.json(
          { error: 'Only the customer may decline (close) a quoted demand' },
          { status: 403 },
        );
      }
      if (!reason) {
        return NextResponse.json(
          { error: 'A reason is required to decline a quote' },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { error: `Demand can only be closed from FULFILLED or QUOTED (current: ${demand.status})` },
        { status: 409 },
      );
    }

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        // Stash decline reason in rejectionReason when closing a quoted demand.
        rejectionReason: demand.status === 'QUOTED' ? reason : demand.rejectionReason,
      },
      include: DEMAND_INCLUDE,
    });

    const noteText =
      demand.status === 'QUOTED'
        ? `Quote declined and demand closed by ${session.name}. Reason: ${reason}`
        : `Demand closed by ${session.name}.`;

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'CLOSED',
        actorId: session.id,
        actorName: session.name,
        notes: noteText,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_CLOSED',
      entityType: 'Demand',
      entityId: id,
      before: { status: demand.status, closedAt: demand.closedAt },
      after: {
        status: 'CLOSED',
        closedAt: updated.closedAt,
        declineReason: demand.status === 'QUOTED' ? reason : null,
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
