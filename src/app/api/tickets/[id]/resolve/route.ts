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

const VALID_CODES = ['FIXED', 'WORKAROUND', 'DUPLICATE', 'NOT_REPRODUCIBLE', 'OUT_OF_SCOPE'];

// POST /api/tickets/[id]/resolve
// Body: { resolutionCode: 'FIXED' | 'WORKAROUND' | 'DUPLICATE' | 'NOT_REPRODUCIBLE' | 'OUT_OF_SCOPE',
//         resolutionNotes: string (required) }
//
// Transition: any non-terminal status → RESOLVED.
// Marks all RUNNING/PAUSED SLA clocks as MET.
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
        { error: 'Only SCM Workers and CM Leaders can resolve tickets' },
        { status: 403 },
      );
    }
    const { id } = await params;

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (ticket.status === 'CLOSED' || ticket.status === 'CANCELED') {
      return NextResponse.json(
        { error: `Cannot resolve a ${ticket.status} ticket` },
        { status: 409 },
      );
    }
    if (ticket.status === 'RESOLVED') {
      return NextResponse.json({ error: 'Ticket is already resolved' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const resolutionCode =
      typeof body.resolutionCode === 'string' ? body.resolutionCode.toUpperCase() : '';
    if (!VALID_CODES.includes(resolutionCode)) {
      return NextResponse.json(
        { error: `resolutionCode must be one of: ${VALID_CODES.join(', ')}` },
        { status: 400 },
      );
    }
    const resolutionNotes =
      typeof body.resolutionNotes === 'string' ? body.resolutionNotes.trim() : '';
    if (!resolutionNotes) {
      return NextResponse.json({ error: 'resolutionNotes is required' }, { status: 400 });
    }

    const before = {
      status: ticket.status,
      resolutionCode: ticket.resolutionCode,
      resolutionNotes: ticket.resolutionNotes,
      resolvedAt: ticket.resolvedAt,
    };
    const now = new Date();

    // Mark all RUNNING/PAUSED SLA clocks as MET.
    const clocks = await db.slaClock.findMany({
      where: { ticketId: id, status: { in: ['RUNNING', 'PAUSED'] } },
    });
    let metCount = 0;
    for (const c of clocks) {
      await db.slaClock.update({
        where: { id: c.id },
        data: { status: 'MET', metAt: now, pausedAt: null },
      });
      metCount++;
    }

    const updated = await db.ticket.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolutionCode,
        resolutionNotes,
        resolvedAt: now,
      },
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'RESOLVED',
        actorId: session.id,
        actorName: session.name,
        notes: `Ticket resolved by ${session.name} (${resolutionCode}). ${resolutionNotes}`,
      },
    });

    // Notify the requester that their ticket is resolved.
    if (ticket.requesterId !== session.id) {
      await db.notification.create({
        data: {
          userId: ticket.requesterId,
          type: 'TicketResolved',
          title: `Ticket ${ticket.number} resolved`,
          message: `${ticket.title} — resolved as ${resolutionCode}. You can review and close.`,
          entityRef: `ticket:${id}`,
        },
      });
    }

    await auditLog({
      actor: session,
      action: 'TICKET_RESOLVE',
      entityType: 'Ticket',
      entityId: id,
      before,
      after: { status: 'RESOLVED', resolutionCode, resolutionNotes, resolvedAt: now.toISOString(), metClocks: metCount },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
