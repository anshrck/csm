import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { getSession } from '@/lib/auth';
import { requireAuthorizedAction } from '@/lib/permissions';
import { validateTransition, ACTION_TO_STATUS, type TicketStatus } from '@/lib/ticket-state';
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
//         resolutionNotes: string (required, ≥5 chars) }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const resolutionCode =
      typeof body.resolutionCode === 'string' ? body.resolutionCode.toUpperCase() : '';
    if (!VALID_CODES.includes(resolutionCode)) {
      return NextResponse.json(
        { error: `resolutionCode must be one of: ${VALID_CODES.join(', ')}` },
        { status: 400 },
      );
    }
    body.resolutionCode = resolutionCode; // normalize for state-machine validation

    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await requireAuthorizedAction(session, {
        resource: 'ticket',
        action: 'resolve',
        recordId: id,
        requestedChanges: body,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // State-machine validation — RESOLVED requires resolutionCode + resolutionNotes (≥5 chars).
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = ACTION_TO_STATUS.resolve;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const resolutionNotes =
      typeof body.resolutionNotes === 'string' ? body.resolutionNotes.trim() : '';

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
        status: targetStatus,
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
      action: 'TICKET_RESOLVED',
      entityType: 'Ticket',
      entityId: id,
      before: { ...before, status: currentStatus },
      after: {
        status: targetStatus,
        resolutionCode,
        resolutionNotes,
        resolvedAt: now.toISOString(),
        metClocks: metCount,
      },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
