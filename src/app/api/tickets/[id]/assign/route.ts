import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { requireEntityAccess } from '@/lib/entity-access';
import { validateTransition, ACTION_TO_STATUS, type TicketStatus } from '@/lib/ticket-state';
import { isAgent } from '../../_helpers';
import {
  TICKET_INCLUDE,
  serializeTicket,
  errorResponse,
  type TicketWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/tickets/[id]/assign
// Body: { assignedUserId?: string, assignmentGroupId?: string }
//
// Transition: NEW | TRIAGED → ASSIGNED. Requires assignedUserId or assignmentGroupId
// (state-machine enforced). For tickets already in ASSIGNED/IN_PROGRESS/etc.,
// the assignee is simply updated without a status flip (the route rejects via
// the state machine if the current status doesn't allow a transition to ASSIGNED).
//
// Roles: SCM_WORKER or CM_LEADER.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAgent(session.role)) {
      return NextResponse.json(
        { error: 'Only SCM Workers and CM Leaders can assign tickets' },
        { status: 403 },
      );
    }
    const { id } = await params;

    // Entity-access gate (write).
    try {
      await requireEntityAccess(session, 'TICKET', id, 'write');
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

    // State-machine validation — ASSIGNED requires assignedUserId or assignmentGroupId.
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = ACTION_TO_STATUS.assign;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const assignedUserId =
      typeof body.assignedUserId === 'string' && body.assignedUserId.trim()
        ? body.assignedUserId.trim()
        : null;
    const assignmentGroupId =
      typeof body.assignmentGroupId === 'string' && body.assignmentGroupId.trim()
        ? body.assignmentGroupId.trim()
        : null;

    let assigneeName: string | null = null;
    if (assignedUserId) {
      const u = await db.user.findUnique({
        where: { id: assignedUserId },
        select: { id: true, role: true, name: true },
      });
      if (!u) {
        return NextResponse.json({ error: 'assignedUserId does not reference a known user' }, { status: 400 });
      }
      if (u.role !== 'SCM_WORKER' && u.role !== 'CM_LEADER') {
        return NextResponse.json(
          { error: 'Assignee must be an SCM Worker or CM Leader' },
          { status: 400 },
        );
      }
      assigneeName = u.name;
    }
    if (assignmentGroupId) {
      const g = await db.assignmentGroup.findUnique({
        where: { id: assignmentGroupId },
        select: { id: true },
      });
      if (!g) {
        return NextResponse.json(
          { error: 'assignmentGroupId does not reference a known group' },
          { status: 400 },
        );
      }
    }

    const before = {
      assignedUserId: ticket.assignedUserId,
      assignmentGroupId: ticket.assignmentGroupId,
      status: ticket.status,
    };

    const data: Record<string, unknown> = {
      assignedUserId,
      assignmentGroupId,
      status: targetStatus,
    };

    const updated = await db.ticket.update({
      where: { id },
      data,
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'ASSIGNED',
        actorId: session.id,
        actorName: session.name,
        notes: assignedUserId
          ? `Ticket assigned to ${assigneeName}.`
          : assignmentGroupId
            ? `Ticket assigned to group ${assignmentGroupId}.`
            : `Ticket unassigned by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_ASSIGNED',
      entityType: 'Ticket',
      entityId: id,
      before: { ...before, status: currentStatus },
      after: { assignedUserId, assignmentGroupId, status: targetStatus },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
