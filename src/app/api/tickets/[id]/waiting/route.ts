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

// POST /api/tickets/[id]/waiting
// Body: { notes? }
//
// Transition: IN_PROGRESS | ASSIGNED | TRIAGED → WAITING_CUSTOMER.
// Pauses all RUNNING SLA clocks.
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
        { error: 'Only SCM Workers and CM Leaders can set tickets to waiting' },
        { status: 403 },
      );
    }
    const { id } = await params;

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (ticket.status === 'WAITING_CUSTOMER') {
      return NextResponse.json({ error: 'Ticket is already waiting on customer' }, { status: 409 });
    }
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' || ticket.status === 'CANCELED') {
      return NextResponse.json(
        { error: `Cannot wait on a ${ticket.status} ticket` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const before = { status: ticket.status };
    const now = new Date();

    // Pause all RUNNING SLA clocks.
    const clocks = await db.slaClock.findMany({
      where: { ticketId: id, status: 'RUNNING' },
    });
    for (const c of clocks) {
      await db.slaClock.update({
        where: { id: c.id },
        data: { status: 'PAUSED', pausedAt: now },
      });
    }

    const updated = await db.ticket.update({
      where: { id },
      data: { status: 'WAITING_CUSTOMER' },
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'WAITING',
        actorId: session.id,
        actorName: session.name,
        notes: notes ?? `Ticket set to waiting on customer by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_WAITING',
      entityType: 'Ticket',
      entityId: id,
      before,
      after: { status: 'WAITING_CUSTOMER', pausedClocks: clocks.length },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
