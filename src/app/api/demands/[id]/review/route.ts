import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/review
// NEW → UNDER_REVIEW. Assigns the caller (if SCM_WORKER and unassigned) and
// starts the review. Role: SCM_WORKER or CM_LEADER.
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
      requestedChanges: { status: 'UNDER_REVIEW' },
      workflowState: demand.status,
    });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (demand.status !== 'NEW') {
      return NextResponse.json(
        { error: `Demand must be in NEW state to start review (current: ${demand.status})` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    let assignedId = demand.assignedScmWorkerId;

    // If not yet assigned, assign to the caller when they're an SCM worker,
    // or to a worker id provided in the body (CM Leader may reassign).
    if (!assignedId) {
      if (session.role === 'SCM_WORKER') {
        assignedId = session.id;
      } else if (typeof body.assignedScmWorkerId === 'string' && body.assignedScmWorkerId) {
        const u = await db.user.findUnique({ where: { id: body.assignedScmWorkerId } });
        if (!u || (u.role !== 'SCM_WORKER' && u.role !== 'CM_LEADER')) {
          return NextResponse.json(
            { error: 'Invalid assignedScmWorkerId' },
            { status: 400 },
          );
        }
        assignedId = u.id;
      } else {
        return NextResponse.json(
          { error: 'A demand must be assigned before review can start' },
          { status: 400 },
        );
      }
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : `Review started by ${session.name}.`;

    const before = {
      status: demand.status,
      assignedScmWorkerId: demand.assignedScmWorkerId,
    };

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'UNDER_REVIEW',
        assignedScmWorkerId: assignedId,
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'REVIEW_STARTED',
        actorId: session.id,
        actorName: session.name,
        notes,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_REVIEW_STARTED',
      entityType: 'Demand',
      entityId: id,
      before,
      after: { status: 'UNDER_REVIEW', assignedScmWorkerId: assignedId },
    });

    // Re-fetch so the response includes the new event.
    const fresh = await db.demand.findUnique({
      where: { id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
