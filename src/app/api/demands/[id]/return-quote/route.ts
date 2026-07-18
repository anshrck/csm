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

// POST /api/demands/[id]/return-quote
// CM_LEADER returns the quote draft to the SCM Worker for revision.
// Body: { notes } (required)
// Side effects: creates a COMMENT event + notification to the assigned SCM Worker.
// Does not change demand status (stays UNDER_REVIEW); the quoteApprovedByCmLeader flag
// stays false (or is reset to false if it was somehow set).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('CM_LEADER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (demand.status !== 'UNDER_REVIEW') {
      return NextResponse.json(
        { error: `Demand is in ${demand.status} status; quote can only be returned from UNDER_REVIEW` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

    if (!notes) {
      return NextResponse.json(
        { error: 'Notes are required when returning a quote for revision' },
        { status: 400 },
      );
    }

    // Reset the approval flag (in case it was set previously and is now being revoked)
    if (demand.quoteApprovedByCmLeader || demand.quoteApprovedAt) {
      await db.demand.update({
        where: { id },
        data: {
          quoteApprovedByCmLeader: false,
          quoteApprovedAt: null,
        },
      });
    }

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'COMMENT',
        actorId: session.id,
        actorName: session.name,
        notes: `Quote returned by CM Leader for revision: ${notes}`,
      },
    });

    await auditLog({
      actor: session,
      action: 'DEMAND_QUOTE_RETURNED',
      entityType: 'Demand',
      entityId: id,
      before: {
        status: demand.status,
        quoteApprovedByCmLeader: demand.quoteApprovedByCmLeader,
      },
      after: {
        status: 'UNDER_REVIEW',
        quoteApprovedByCmLeader: false,
        notes,
      },
    });

    // Notify the assigned SCM Worker (or all SCM workers if unassigned)
    let recipients: { id: string }[] = [];
    if (demand.assignedScmWorkerId) {
      recipients = [{ id: demand.assignedScmWorkerId }];
    } else {
      recipients = await db.user.findMany({
        where: { role: 'SCM_WORKER' },
        select: { id: true },
      });
    }
    if (recipients.length > 0) {
      await db.notification.createMany({
        data: recipients.map((u) => ({
          userId: u.id,
          type: 'QuoteApprovalRequested', // re-use: indicates action needed on quote
          title: `Quote returned for revision: ${demand.title}`,
          message: `${session.name} returned your quote for revision. Notes: ${notes.slice(0, 200)}`,
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
