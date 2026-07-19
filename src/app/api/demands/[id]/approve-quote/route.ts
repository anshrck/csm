import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/approve-quote
// CM_LEADER gate — sets quoteApprovedByCmLeader=true, quoteApprovedAt=now.
// Allowed from UNDER_REVIEW (status does not change). Emits QUOTE_APPROVED event.
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

    const allowed = await authorize(session, { resource: 'demand', action: 'approve', recordId: id });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Allow approval from UNDER_REVIEW (typical) or QUOTED (re-approval after a
    // declined/re-submitted quote). Reject terminal statuses.
    const terminal = ['CLOSED', 'REJECTED', 'REDIRECTED'];
    if (terminal.includes(demand.status)) {
      return NextResponse.json(
        { error: `Cannot approve quote for a ${demand.status} demand` },
        { status: 409 },
      );
    }

    if (demand.quoteApprovedByCmLeader) {
      return NextResponse.json(
        { error: 'Quote is already approved by CM Leader' },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const notes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : `Quote pre-approved by CM Leader ${session.name}.`;

    const before = {
      status: demand.status,
      quoteApprovedByCmLeader: demand.quoteApprovedByCmLeader,
      quoteApprovedAt: demand.quoteApprovedAt,
    };

    const updated = await db.demand.update({
      where: { id },
      data: {
        quoteApprovedByCmLeader: true,
        quoteApprovedAt: new Date(),
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'QUOTE_APPROVED',
        actorId: session.id,
        actorName: session.name,
        notes,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_QUOTE_APPROVED',
      entityType: 'Demand',
      entityId: id,
      before,
      after: {
        status: updated.status,
        quoteApprovedByCmLeader: true,
        quoteApprovedAt: updated.quoteApprovedAt,
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
