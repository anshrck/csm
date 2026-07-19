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

// POST /api/tickets/[id]/waiting
// Body: { comment: string (required, customer-visible), notes? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await requireAuthorizedAction(session, {
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

    // State-machine validation — requires a customer-visible `comment`.
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = ACTION_TO_STATUS.waiting;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const commentText = String(body.comment).trim();
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
      data: { status: targetStatus },
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

    // Post the customer-visible comment to the ticket's conversation thread.
    try {
      let conv = await db.conversation.findFirst({
        where: { entityType: 'TICKET', entityId: id },
      });
      if (!conv) {
        conv = await db.conversation.create({
          data: {
            entityType: 'TICKET',
            entityId: id,
            serviceCustomerId: ticket.serviceCustomerId,
          },
        });
      }
      await db.comment.create({
        data: {
          conversationId: conv.id,
          authorId: session.id,
          authorName: session.name,
          visibility: 'CUSTOMER_VISIBLE',
          body: commentText,
        },
      });
      await db.conversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      // Best-effort — the comment thread is secondary to the status transition.
      console.error('[tickets/waiting] failed to post comment to conversation:', e);
    }

    await auditLog({
      actor: session,
      action: 'TICKET_WAITING',
      entityType: 'Ticket',
      entityId: id,
      before: { status: currentStatus },
      after: { status: targetStatus, pausedClocks: clocks.length, comment: commentText.slice(0, 200) },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
