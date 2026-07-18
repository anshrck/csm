import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { requireEntityAccess } from '@/lib/entity-access';
import { isAgent } from '../_helpers';
import {
  TICKET_INCLUDE,
  serializeTicket,
  errorResponse,
  type TicketWithRelations,
} from '../_serialize';

export const runtime = 'nodejs';

// ---- GET /api/tickets/[id] -------------------------------------------------
//
// Fetch a single ticket with events, slaClocks, service, customer, assignee.
// All authenticated roles; scoping enforced via the entity-access helper.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const ticket = await db.ticket.findUnique({
      where: { id },
      include: TICKET_INCLUDE,
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
      await requireEntityAccess(session, 'TICKET', id, 'read');
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(serializeTicket(ticket as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}

// ---- PATCH /api/tickets/[id] -----------------------------------------------
//
// Update editable fields. Direct `status` writes are FORBIDDEN — transitions
// must go through the dedicated action routes (/assign, /triage, /progress,
// /waiting, /resume, /resolve, /close, /reopen). Role gating:
//   - title, description, priority, impact, urgency, serviceId,
//     assignedUserId, assignmentGroupId, resolutionCode, resolutionNotes:
//     SCM_WORKER (must be in scope) or CM_LEADER.
//   - SERVICE_CUSTOMER: cannot PATCH tickets.
//   - SERVICE_OWNER: cannot PATCH tickets (read-only).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAgent(session.role)) {
      return NextResponse.json(
        { error: 'Only SCM Workers and CM Leaders can edit tickets' },
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

    const existingTicket = await db.ticket.findUnique({ where: { id } });
    if (!existingTicket) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

    // Direct status writes are forbidden — transitions must go through the
    // dedicated action routes.
    if (body.status !== undefined) {
      return NextResponse.json(
        {
          error:
            'Direct status changes are forbidden — use the dedicated transition endpoints (/assign, /triage, /progress, /waiting, /resume, /resolve, /close, /reopen).',
        },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    const VALID_TYPES = ['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT'];
    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    const VALID_IMPACT = ['LOW', 'MEDIUM', 'HIGH'];
    const VALID_RESOLUTION_CODES = [
      'FIXED',
      'WORKAROUND',
      'DUPLICATE',
      'NOT_REPRODUCIBLE',
      'OUT_OF_SCOPE',
    ];

    if (body.title !== undefined) {
      const v = typeof body.title === 'string' ? body.title.trim() : '';
      if (!v) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
      if (v.length > 200)
        return NextResponse.json({ error: 'title must be ≤200 chars' }, { status: 400 });
      before.title = existingTicket.title;
      data.title = v;
    }
    if (body.description !== undefined) {
      const v = typeof body.description === 'string' ? body.description : '';
      before.description = existingTicket.description;
      data.description = v;
    }
    if (body.type !== undefined) {
      const v = typeof body.type === 'string' ? body.type.toUpperCase() : '';
      if (!VALID_TYPES.includes(v)) {
        return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
      }
      before.type = existingTicket.type;
      data.type = v;
    }
    if (body.priority !== undefined) {
      const v = typeof body.priority === 'string' ? body.priority.toUpperCase() : '';
      if (!VALID_PRIORITIES.includes(v)) {
        return NextResponse.json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
      }
      before.priority = existingTicket.priority;
      data.priority = v;
    }
    if (body.impact !== undefined) {
      const v = body.impact === null ? null : typeof body.impact === 'string' ? body.impact.toUpperCase() : '';
      if (v !== null && !VALID_IMPACT.includes(v)) {
        return NextResponse.json({ error: `impact must be one of: ${VALID_IMPACT.join(', ')}` }, { status: 400 });
      }
      before.impact = existingTicket.impact;
      data.impact = v;
    }
    if (body.urgency !== undefined) {
      const v = body.urgency === null ? null : typeof body.urgency === 'string' ? body.urgency.toUpperCase() : '';
      if (v !== null && !VALID_IMPACT.includes(v)) {
        return NextResponse.json({ error: `urgency must be one of: ${VALID_IMPACT.join(', ')}` }, { status: 400 });
      }
      before.urgency = existingTicket.urgency;
      data.urgency = v;
    }
    if (body.serviceId !== undefined) {
      const v = body.serviceId === null ? null : typeof body.serviceId === 'string' ? body.serviceId : '';
      if (v) {
        const svc = await db.service.findUnique({ where: { id: v }, select: { id: true } });
        if (!svc) {
          return NextResponse.json({ error: 'serviceId does not reference a known service' }, { status: 400 });
        }
      }
      before.serviceId = existingTicket.serviceId;
      data.serviceId = v;
    }
    if (body.assignedUserId !== undefined) {
      const v = body.assignedUserId === null ? null : typeof body.assignedUserId === 'string' ? body.assignedUserId : '';
      if (v) {
        const u = await db.user.findUnique({ where: { id: v }, select: { id: true, role: true } });
        if (!u) {
          return NextResponse.json({ error: 'assignedUserId does not reference a known user' }, { status: 400 });
        }
        if (u.role !== 'SCM_WORKER' && u.role !== 'CM_LEADER') {
          return NextResponse.json(
            { error: 'Assignee must be an SCM Worker or CM Leader' },
            { status: 400 },
          );
        }
      }
      before.assignedUserId = existingTicket.assignedUserId;
      data.assignedUserId = v;
    }
    if (body.assignmentGroupId !== undefined) {
      const v =
        body.assignmentGroupId === null
          ? null
          : typeof body.assignmentGroupId === 'string'
            ? body.assignmentGroupId
            : '';
      if (v) {
        const g = await db.assignmentGroup.findUnique({ where: { id: v }, select: { id: true } });
        if (!g) {
          return NextResponse.json({ error: 'assignmentGroupId does not reference a known group' }, { status: 400 });
        }
      }
      before.assignmentGroupId = existingTicket.assignmentGroupId;
      data.assignmentGroupId = v;
    }
    if (body.resolutionCode !== undefined) {
      const v =
        body.resolutionCode === null
          ? null
          : typeof body.resolutionCode === 'string'
            ? body.resolutionCode.toUpperCase()
            : '';
      if (v !== null && !VALID_RESOLUTION_CODES.includes(v)) {
        return NextResponse.json(
          { error: `resolutionCode must be one of: ${VALID_RESOLUTION_CODES.join(', ')}` },
          { status: 400 },
        );
      }
      before.resolutionCode = existingTicket.resolutionCode;
      data.resolutionCode = v;
    }
    if (body.resolutionNotes !== undefined) {
      const v =
        body.resolutionNotes === null
          ? null
          : typeof body.resolutionNotes === 'string'
            ? body.resolutionNotes
            : '';
      before.resolutionNotes = existingTicket.resolutionNotes;
      data.resolutionNotes = v;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const updatedTicket = await db.ticket.update({
      where: { id },
      data,
      include: TICKET_INCLUDE,
    });

    // COMMENT event recording the edit
    const fields = Object.keys(data);
    await db.ticketEvent.create({
      data: {
        ticketId: id,
        eventType: 'COMMENT',
        actorId: session.id,
        actorName: session.name,
        notes: `Ticket fields updated by ${session.name}: ${fields.join(', ')}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_UPDATED',
      entityType: 'Ticket',
      entityId: id,
      before: { ...before, id: existingTicket.id, number: existingTicket.number },
      after: { ...data, id: existingTicket.id, number: existingTicket.number },
    });

    return NextResponse.json(serializeTicket(updatedTicket as TicketWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
