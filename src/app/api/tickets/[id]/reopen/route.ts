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

// POST /api/tickets/[id]/reopen
// Body: { notes? }
//
// Transition: RESOLVED | CLOSED → IN_PROGRESS.
// Restarts SLA clocks: clocks that were MET/BREACHED/PAUSED get a fresh
// `startedAt = now`, `dueAt = now + policy.{response|resolution}Mins`, and
// status RUNNING.
//
// Roles: SERVICE_CUSTOMER (own org), SCM_WORKER (in scope), CM_LEADER (all).
// Service Owners cannot reopen tickets (read-only).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'SERVICE_OWNER') {
      return NextResponse.json(
        { error: 'Service Owners cannot reopen tickets' },
        { status: 403 },
      );
    }
    const { id } = await params;

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Scope: SERVICE_CUSTOMER may reopen only their own org's tickets.
    if (session.role === 'SERVICE_CUSTOMER') {
      if (session.orgNodeId !== ticket.serviceCustomerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.role === 'SCM_WORKER') {
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

    if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') {
      return NextResponse.json(
        { error: `Ticket must be RESOLVED or CLOSED to reopen (current: ${ticket.status})` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

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
        status: 'IN_PROGRESS',
        // Keep resolutionCode/Notes as a historical record — the ticket is
        // being reopened because the resolution didn't stick.
        resolvedAt: null,
        closedAt: null,
      },
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'REOPENED',
        actorId: session.id,
        actorName: session.name,
        notes: notes ?? `Ticket reopened by ${session.name}. ${restartedCount} SLA clock(s) restarted.`,
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
      action: 'TICKET_REOPEN',
      entityType: 'Ticket',
      entityId: id,
      before,
      after: { status: 'IN_PROGRESS', restartedClocks: restartedCount },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
