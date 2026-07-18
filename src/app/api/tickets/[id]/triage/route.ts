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

// POST /api/tickets/[id]/triage
// Body: { priority?, impact?, urgency?, serviceId? }
//
// Transition: NEW → TRIAGED (idempotent if already TRIAGED/ASSIGNED/IN_PROGRESS).
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

    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
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

    // Transition status if appropriate
    let nextStatus = ticket.status;
    if (ticket.status === 'NEW') {
      nextStatus = 'TRIAGED';
      data.status = nextStatus;
    }

    if (Object.keys(data).length === 0) {
      // No-op triage — still emit a COMMENT event so the audit trail records
      // that triage was attempted.
      await db.ticketEvent.create({
        data: {
          ticketId: id,
          eventType: 'TRIAGED',
          actorId: session.id,
          actorName: session.name,
          notes: `Triage reviewed by ${session.name} (no field changes).`,
        },
      });
    } else {
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
        action: 'TICKET_TRIAGE',
        entityType: 'Ticket',
        entityId: id,
        before,
        after: data,
      });
      return NextResponse.json(serializeTicket(updated as TicketWithRelations));
    }

    // Re-fetch with relations to return the consistent shape
    const fresh = await db.ticket.findUnique({ where: { id }, include: TICKET_INCLUDE });
    return NextResponse.json(serializeTicket(fresh as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
