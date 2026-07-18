import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { isAgent } from '../../_helpers';
import {
  TICKET_INCLUDE,
  serializeTicket,
  errorResponse,
  type TicketWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/tickets/[id]/assign
// Body: { assignedUserId: string | null }
//
// Transition: NEW | TRIAGED → ASSIGNED (or stays in current state if already
// IN_PROGRESS/etc. — we just update the assignee and emit an event).
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

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const assignedUserId =
      typeof body.assignedUserId === 'string' && body.assignedUserId.trim()
        ? body.assignedUserId.trim()
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

    const before = { assignedUserId: ticket.assignedUserId, status: ticket.status };

    // If the ticket was NEW or TRIAGED, advance to ASSIGNED. Otherwise keep
    // the existing status (the user is re-assigning mid-flight).
    const nextStatus =
      ticket.status === 'NEW' || ticket.status === 'TRIAGED' ? 'ASSIGNED' : ticket.status;

    const updated = await db.ticket.update({
      where: { id },
      data: { assignedUserId, status: nextStatus },
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
          : `Ticket unassigned by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_ASSIGN',
      entityType: 'Ticket',
      entityId: id,
      before,
      after: { assignedUserId, status: nextStatus },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
