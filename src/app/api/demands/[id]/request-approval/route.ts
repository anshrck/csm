import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import {
  DEMAND_INCLUDE,
  serializeDemand,
  errorResponse,
  type DemandWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/request-approval
// SCM_WORKER submits their quote draft for CM Leader approval.
// Validates: caller is SCM_WORKER, demand is UNDER_REVIEW, quote fields are filled.
// Side effects: creates a COMMENT event + notifications to all CM_LEADER users.
// Note: the PATCH /api/demands/[id] endpoint already saves the quote fields; this route
// is the explicit "request approval" action that creates the audit trail + notifications.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // SCM must be the assigned worker (or a CM Leader acting on their behalf — but this
    // route is SCM_WORKER-only per spec)
    if (demand.assignedScmWorkerId && demand.assignedScmWorkerId !== session.id) {
      return NextResponse.json(
        { error: 'Only the assigned SCM Worker can request quote approval' },
        { status: 403 },
      );
    }

    if (demand.status !== 'UNDER_REVIEW') {
      return NextResponse.json(
        { error: `Demand is in ${demand.status} status; quote approval can only be requested from UNDER_REVIEW` },
        { status: 409 },
      );
    }

    // Validate quote fields are filled
    if (
      demand.estimatedEffortDays == null ||
      demand.estimatedEffortDays <= 0 ||
      !demand.quoteNotes ||
      !demand.quoteNotes.trim()
    ) {
      return NextResponse.json(
        {
          error:
            'Quote fields must be filled (estimatedEffortDays and quoteNotes) before requesting approval',
        },
        { status: 400 },
      );
    }

    // Already approved? Return current demand without re-notifying
    if (demand.quoteApprovedByCmLeader) {
      const fresh = await db.demand.findUnique({
        where: { id },
        include: DEMAND_INCLUDE,
      });
      return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
    }

    // Create COMMENT event for the audit trail
    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'COMMENT',
        actorId: session.id,
        actorName: session.name,
        notes: `Quote submitted for CM Leader approval — effort: ${demand.estimatedEffortDays} days, cost: $${demand.estimatedCost ?? 0}. Notes: ${demand.quoteNotes.slice(0, 200)}`,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_QUOTE_APPROVAL_REQUESTED',
      entityType: 'Demand',
      entityId: id,
      before: { status: demand.status, quoteApprovedByCmLeader: demand.quoteApprovedByCmLeader },
      after: {
        status: demand.status,
        estimatedEffortDays: demand.estimatedEffortDays,
        estimatedCost: demand.estimatedCost,
      },
    });

    // Notify all CM_LEADER users
    const cmLeaders = await db.user.findMany({
      where: { role: 'CM_LEADER' },
      select: { id: true },
    });
    if (cmLeaders.length > 0) {
      await db.notification.createMany({
        data: cmLeaders.map((u) => ({
          userId: u.id,
          type: 'QuoteApprovalRequested',
          title: `Quote approval requested: ${demand.title}`,
          message: `${session.name} requested CM Leader approval for the quote on "${demand.title}".`,
          entityRef: `demand:${id}`,
        })),
      });
    }

    const fresh = await db.demand.findUnique({
      where: { id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
