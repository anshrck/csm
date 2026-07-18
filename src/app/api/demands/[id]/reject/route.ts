import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/reject
// UNDER_REVIEW or QUOTED → REJECTED. Body: { reason }.
// Role: SCM_WORKER or CM_LEADER (governance gate on rejection).
// Notifies the customer (DemandRejected).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (demand.status !== 'UNDER_REVIEW' && demand.status !== 'QUOTED') {
      return NextResponse.json(
        { error: `Demand can only be rejected from UNDER_REVIEW or QUOTED (current: ${demand.status})` },
        { status: 409 },
      );
    }

    // SCM scoping: assigned worker or CM Leader.
    if (
      session.role === 'SCM_WORKER' &&
      demand.assignedScmWorkerId !== null &&
      demand.assignedScmWorkerId !== session.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json(
        { error: 'A rejection reason is required' },
        { status: 400 },
      );
    }

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'REJECTED',
        actorId: session.id,
        actorName: session.name,
        notes: `Demand rejected by ${session.name}. Reason: ${reason}`,
      },
    });

    // Notify the customer.
    await db.notification.create({
      data: {
        userId: demand.submittedById,
        type: 'DemandRejected',
        title: 'Demand rejected',
        message: `Your demand "${demand.title}" was rejected. Reason: ${reason}`,
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
