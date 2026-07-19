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

// POST /api/tickets/[id]/reopen
// Body: { notes?, reopenReason? }
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
        action: 'reopen',
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

    // Reopening from CLOSED requires CM_LEADER or SERVICE_CUSTOMER role.
    const currentStatus = ticket.status as TicketStatus;
    if (currentStatus === 'CLOSED') {
      if (session.role !== 'CM_LEADER' && session.role !== 'SERVICE_CUSTOMER') {
        return NextResponse.json(
          { error: 'Only CM Leaders or Service Customers may reopen a CLOSED ticket' },
          { status: 403 },
        );
      }
    }

    // State-machine validation — reopen from CLOSED requires reopenReason.
    const targetStatus = ACTION_TO_STATUS.reopen;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const reopenReason =
      typeof body.reopenReason === 'string' && body.reopenReason.trim()
        ? body.reopenReason.trim()
        : null;

    const before = {
      status: ticket.status,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      resolutionCode: ticket.resolutionCode,
    };
    const now = new Date();

    // Restart SLA clocks: MET/BREACHED/PAUSED → RUNNING with fresh startedAt +
    // dueAt based on the original policy.
    const clocks = await db.slaClock.findMany({
      where: { ticketId: id, status: { in: ['MET', 'BREACHED', 'PAUSED'] } },
      include: { policy: true },
    });
    let restartedCount = 0;
    for (const c of clocks) {
      if (!c.policy) continue;
      const mins = c.type === 'RESPONSE' ? c.policy.responseMins : c.policy.resolutionMins;
      const dueAt = new Date(now.getTime() + mins * 60_000);
      await db.slaClock.update({
        where: { id: c.id },
        data: {
          status: 'RUNNING',
          startedAt: now,
          dueAt,
          pausedAt: null,
          totalPausedMins: 0,
          metAt: null,
          breachedAt: null,
        },
      });
      restartedCount++;
    }

    const updated = await db.ticket.update({
      where: { id },
      data: {
        status: targetStatus,
        resolvedAt: null,
        closedAt: null,
      },
      include: TICKET_INCLUDE,
    });

    const eventNotes = reopenReason
      ? `Ticket reopened by ${session.name}. Reason: ${reopenReason}. ${restartedCount} SLA clock(s) restarted.`
      : notes ?? `Ticket reopened by ${session.name}. ${restartedCount} SLA clock(s) restarted.`;

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'REOPENED',
        actorId: session.id,
        actorName: session.name,
        notes: eventNotes,
      },
    });

    // Notify the assignee (if any) that the ticket was reopened.
    if (ticket.assignedUserId && ticket.assignedUserId !== session.id) {
      await db.notification.create({
        data: {
          userId: ticket.assignedUserId,
          type: 'TicketReopened',
          title: `Ticket ${ticket.number} reopened`,
          message: `${session.name} reopened "${ticket.title}". Please re-engage.`,
          entityRef: `ticket:${id}`,
        },
      });
    }

    await auditLog({
      actor: session,
      action: 'TICKET_REOPENED',
      entityType: 'Ticket',
      entityId: id,
      before: { ...before, status: currentStatus },
      after: {
        status: targetStatus,
        restartedClocks: restartedCount,
        reopenReason,
      },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
