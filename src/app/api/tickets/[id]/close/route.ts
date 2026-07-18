import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  TICKET_INCLUDE,
  serializeTicket,
  errorResponse,
  type TicketWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/tickets/[id]/close
// Body: { notes? }
//
// Transition: RESOLVED | NEW | TRIAGED | ASSIGNED | IN_PROGRESS | WAITING_CUSTOMER → CLOSED.
// Customers can close their own tickets (typically after RESOLVED). SCM/CM
// can close any ticket they can read.
// Service Owners cannot close tickets (read-only role).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'SERVICE_OWNER') {
      return NextResponse.json(
        { error: 'Service Owners cannot close tickets' },
        { status: 403 },
      );
    }
    const { id } = await params;

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Scope: SERVICE_CUSTOMER may close only their own org's tickets.
    if (session.role === 'SERVICE_CUSTOMER') {
      if (session.orgNodeId !== ticket.serviceCustomerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.role === 'SCM_WORKER') {
      // SCM must be in scope (assigned or serves the customer)
      const allowed =
        ticket.assignedUserId === session.id ||
        ticket.assignedUserId === null ||
        (await db.demand.findFirst({
          where: { assignedScmWorkerId: session.id, serviceCustomerId: ticket.serviceCustomerId },
          select: { id: true },
        })) !== null;
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    // CM_LEADER: all tenant tickets.

    if (ticket.status === 'CLOSED') {
      return NextResponse.json({ error: 'Ticket is already closed' }, { status: 409 });
    }
    if (ticket.status === 'CANCELED') {
      return NextResponse.json({ error: 'Cannot close a canceled ticket' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const before = { status: ticket.status, closedAt: ticket.closedAt };
    const now = new Date();

    const updated = await db.ticket.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: now },
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'CLOSED',
        actorId: session.id,
        actorName: session.name,
        notes: notes ?? `Ticket closed by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_CLOSE',
      entityType: 'Ticket',
      entityId: id,
      before,
      after: { status: 'CLOSED', closedAt: now.toISOString() },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
