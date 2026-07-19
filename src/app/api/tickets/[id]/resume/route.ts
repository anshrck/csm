import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { requireAuthorizedAction } from '@/lib/permissions';
import { validateTransition, ACTION_TO_STATUS, type TicketStatus } from '@/lib/ticket-state';
import {
  TICKET_INCLUDE,
  serializeTicket,
  errorResponse,
  type TicketWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/tickets/[id]/resume
// Body: { notes? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    let session;
    try {
      session = await requireAuthorizedAction({
        resource: 'ticket',
        action: 'update',
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

    // State-machine validation.
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = ACTION_TO_STATUS.resume;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const before = { status: ticket.status };
    const now = new Date();

    // Resume all PAUSED SLA clocks.
    const clocks = await db.slaClock.findMany({
      where: { ticketId: id, status: 'PAUSED' },
    });
    let resumedCount = 0;
    for (const c of clocks) {
      if (!c.pausedAt) continue;
      const pausedMins = Math.max(
        0,
        Math.round((now.getTime() - c.pausedAt.getTime()) / 60_000),
      );
      const newDueAt = new Date(c.dueAt.getTime() + pausedMins * 60_000);
      await db.slaClock.update({
        where: { id: c.id },
        data: {
          status: 'RUNNING',
          pausedAt: null,
          totalPausedMins: c.totalPausedMins + pausedMins,
          dueAt: newDueAt,
        },
      });
      resumedCount++;
    }

    const updated = await db.ticket.update({
      where: { id },
      data: { status: targetStatus },
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'RESUMED',
        actorId: session.id,
        actorName: session.name,
        notes: notes ?? `Work resumed by ${session.name}. ${resumedCount} SLA clock(s) restarted.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_RESUMED',
      entityType: 'Ticket',
      entityId: id,
      before: { status: currentStatus },
      after: { status: targetStatus, resumedClocks: resumedCount },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
