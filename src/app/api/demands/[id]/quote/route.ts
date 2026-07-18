import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/quote
// UNDER_REVIEW → QUOTED. Requires quoteApprovedByCmLeader=true.
// Body: { estimatedEffortDays, estimatedCost?, quoteNotes? }
// Role: SCM_WORKER (or CM_LEADER).
// Notifies the customer (DemandQuoted).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (demand.status !== 'UNDER_REVIEW') {
      return NextResponse.json(
        { error: `Demand must be UNDER_REVIEW to quote (current: ${demand.status})` },
        { status: 409 },
      );
    }

    if (!demand.quoteApprovedByCmLeader) {
      return NextResponse.json(
        { error: 'Quote must be approved by a CM Leader before submission' },
        { status: 403 },
      );
    }

    // SCM scoping: must be assigned (or claim if unassigned).
    if (
      session.role === 'SCM_WORKER' &&
      demand.assignedScmWorkerId !== null &&
      demand.assignedScmWorkerId !== session.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // estimatedEffortDays: accept from body, else fall back to already-stored value.
    let effortDays: number | null = null;
    const e = body.estimatedEffortDays;
    if (typeof e === 'number' && e >= 0) effortDays = e;
    else if (typeof e === 'string' && e.trim() && !isNaN(Number(e))) effortDays = Number(e);
    else if (demand.estimatedEffortDays != null) effortDays = demand.estimatedEffortDays;
    if (effortDays === null) {
      return NextResponse.json(
        { error: 'estimatedEffortDays is required and must be a non-negative number' },
        { status: 400 },
      );
    }

    // estimatedCost: accept from body, else fall back to stored.
    let cost: number | null = null;
    if (body.estimatedCost !== undefined && body.estimatedCost !== null) {
      const c = body.estimatedCost;
      if (typeof c === 'number' && c >= 0) cost = c;
      else if (typeof c === 'string' && c.trim() && !isNaN(Number(c))) cost = Number(c);
      else {
        return NextResponse.json(
          { error: 'estimatedCost must be a non-negative number' },
          { status: 400 },
        );
      }
    } else if (demand.estimatedCost != null) {
      cost = demand.estimatedCost;
    }

    // quoteNotes: accept from body, else fall back to stored.
    const quoteNotes =
      typeof body.quoteNotes === 'string' && body.quoteNotes.trim()
        ? body.quoteNotes.trim()
        : demand.quoteNotes ?? null;

    const before = {
      status: demand.status,
      estimatedEffortDays: demand.estimatedEffortDays,
      estimatedCost: demand.estimatedCost,
      quoteNotes: demand.quoteNotes,
      quotedAt: demand.quotedAt,
    };

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'QUOTED',
        estimatedEffortDays: effortDays,
        estimatedCost: cost,
        quoteNotes,
        quotedAt: new Date(),
        // If SCM is unassigned, claim it.
        assignedScmWorkerId: demand.assignedScmWorkerId ?? (session.role === 'SCM_WORKER' ? session.id : undefined),
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'QUOTED',
        actorId: session.id,
        actorName: session.name,
        notes: `Quote submitted: ${effortDays} day(s)${cost !== null ? `, cost ${cost}` : ''}.${quoteNotes ? ` Notes: ${quoteNotes}` : ''}`,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_QUOTED',
      entityType: 'Demand',
      entityId: id,
      before,
      after: {
        status: 'QUOTED',
        estimatedEffortDays: effortDays,
        estimatedCost: cost,
        quoteNotes,
      },
    });

    // Notify the customer (submitter) — DemandQuoted.
    await db.notification.create({
      data: {
        userId: demand.submittedById,
        type: 'DemandQuoted',
        title: 'Quote ready for your demand',
        message: `A quote has been submitted for "${demand.title}" (${effortDays} day(s)). Please accept or decline.`,
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
