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

// POST /api/tickets/[id]/triage
// Body: { priority?, impact?, urgency?, serviceId? }
//
// Transition: NEW → TRIAGED.
// The ticket-state machine validates that the transition is allowed.
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
        { error: 'Only SCM Workers and CM Leaders can triage tickets' },
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

    // State-machine validation.
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = ACTION_TO_STATUS.triage;
    const transition = validateTransition(currentStatus, targetStatus, body, session.role);
    if (!transition.valid) {
      return NextResponse.json({ error: transition.error }, { status: 409 });
    }

    const data: Record<string, unknown> = {};
    const changes: string[] = [];

    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    const VALID_IMPACT = ['LOW', 'MEDIUM', 'HIGH'];

    if (body.priority !== undefined) {
      const v = typeof body.priority === 'string' ? body.priority.toUpperCase() : '';
      if (!VALID_PRIORITIES.includes(v)) {
        return NextResponse.json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
      }
      if (v !== ticket.priority) {
        data.priority = v;
        changes.push(`priority: ${ticket.priority} → ${v}`);
      }
    }
    if (body.impact !== undefined) {
      const v = body.impact === null ? null : typeof body.impact === 'string' ? body.impact.toUpperCase() : '';
      if (v !== null && !VALID_IMPACT.includes(v)) {
        return NextResponse.json({ error: `impact must be one of: ${VALID_IMPACT.join(', ')}` }, { status: 400 });
      }
      if (v !== ticket.impact) {
        data.impact = v;
        changes.push(`impact: ${ticket.impact ?? '—'} → ${v ?? '—'}`);
      }
    }
    if (body.urgency !== undefined) {
      const v = body.urgency === null ? null : typeof body.urgency === 'string' ? body.urgency.toUpperCase() : '';
      if (v !== null && !VALID_IMPACT.includes(v)) {
        return NextResponse.json({ error: `urgency must be one of: ${VALID_IMPACT.join(', ')}` }, { status: 400 });
      }
      if (v !== ticket.urgency) {
        data.urgency = v;
        changes.push(`urgency: ${ticket.urgency ?? '—'} → ${v ?? '—'}`);
      }
    }
    if (body.serviceId !== undefined) {
      const v = body.serviceId === null ? null : typeof body.serviceId === 'string' ? body.serviceId : '';
      if (v) {
        const svc = await db.service.findUnique({ where: { id: v }, select: { id: true, name: true } });
        if (!svc) {
          return NextResponse.json({ error: 'serviceId does not reference a known service' }, { status: 400 });
        }
        changes.push(`service: ${ticket.serviceId ?? '—'} → ${svc.name}`);
      } else {
        changes.push('service cleared');
      }
      data.serviceId = v;
    }

    const before = { priority: ticket.priority, impact: ticket.impact, urgency: ticket.urgency, serviceId: ticket.serviceId, status: ticket.status };

    // Apply the state-machine transition (status flip).
    data.status = targetStatus;

    const updated = await db.ticket.update({
      where: { id },
      data,
      include: TICKET_INCLUDE,
    });

    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'TRIAGED',
        actorId: session.id,
        actorName: session.name,
        notes:
          changes.length > 0
            ? `Triage updated by ${session.name}: ${changes.join('; ')}.`
            : `Triage reviewed by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_TRIAGED',
      entityType: 'Ticket',
      entityId: id,
      before: { ...before, status: currentStatus },
      after: { ...data, status: targetStatus },
    });

    return NextResponse.json(serializeTicket(updated as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
