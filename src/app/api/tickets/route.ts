import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  buildTicketScope,
  resolveSlaPolicy,
  createSlaClocksForTicket,
} from './_helpers';
import {
  TICKET_LIST_INCLUDE,
  TICKET_INCLUDE,
  serializeTicketListRow,
  serializeTicket,
  errorResponse,
  type TicketListRow,
  type TicketWithRelations,
} from './_serialize';

export const runtime = 'nodejs';

// ---- GET /api/tickets ------------------------------------------------------
//
// List tickets. All authenticated roles; scoping follows `buildTicketScope`.
//
// Query params:
//   status            comma-separated multi-status filter
//   priority          comma-separated multi-priority filter
//   type              comma-separated multi-type filter
//   serviceId         filter by serviceId
//   serviceCustomerId filter by customer orgNode
//   assignedUserId    filter by assignee; special values: 'me' = caller.id,
//                     'unassigned' = null
//   requesterId       filter by requester; special value: 'me' = caller.id
//   mine=1            only tickets whose serviceCustomerId === caller.orgNodeId
//   q                 title search (case-insensitive contains)
//   overdue=1         only tickets with at least one BREACHED SLA clock
//   breachingSoon=1   only tickets with at least one RUNNING clock whose
//                     percentRemaining <= 25
//   sort              'recent' (default) | 'priority' (P1 first) | 'age'
//                     (oldest first) | 'sla' (soonest SLA dueAt asc)
//   limit             integer, default 200, max 500
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const scope = await buildTicketScope(session);
    if (scope === null) return NextResponse.json([]);

    const and: Record<string, unknown>[] = [scope];

    const statusParam = sp.get('status');
    if (statusParam) {
      const statuses = statusParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (statuses.length) and.push({ status: { in: statuses } });
    }

    const priorityParam = sp.get('priority');
    if (priorityParam) {
      const priorities = priorityParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (priorities.length) and.push({ priority: { in: priorities } });
    }

    const typeParam = sp.get('type');
    if (typeParam) {
      const types = typeParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (types.length) and.push({ type: { in: types } });
    }

    const serviceId = sp.get('serviceId');
    if (serviceId) and.push({ serviceId });

    const customer = sp.get('serviceCustomerId');
    if (customer) and.push({ serviceCustomerId: customer });

    const assigned = sp.get('assignedUserId');
    if (assigned === 'me') and.push({ assignedUserId: session.id });
    else if (assigned === 'unassigned') and.push({ assignedUserId: null });
    else if (assigned) and.push({ assignedUserId: assigned });

    const requester = sp.get('requesterId');
    if (requester === 'me') and.push({ requesterId: session.id });
    else if (requester) and.push({ requesterId: requester });

    const mine = sp.get('mine') === '1';
    if (mine && session.orgNodeId) and.push({ serviceCustomerId: session.orgNodeId });

    const q = sp.get('q');
    if (q && q.trim()) and.push({ title: { contains: q.trim() } });

    const overdue = sp.get('overdue') === '1';
    if (overdue) {
      and.push({
        slaClocks: { some: { status: 'BREACHED' } },
      });
    }

    const breachingSoon = sp.get('breachingSoon') === '1';
    // The percentRemaining test is computed in JS; here we narrow to tickets
    // with at least one RUNNING clock to keep the query indexable.
    if (breachingSoon) {
      and.push({ slaClocks: { some: { status: 'RUNNING' } } });
    }

    const limitRaw = Number(sp.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : 200;

    const sort = sp.get('sort') ?? 'recent';
    let orderBy: Record<string, string> = { createdAt: 'desc' };
    if (sort === 'priority') {
      // P1 < P2 < P3 < P4 by ascending string comparison (lexicographic on P1..P4 works)
      orderBy = { priority: 'asc' };
    } else if (sort === 'age') {
      orderBy = { createdAt: 'asc' };
    } else if (sort === 'sla') {
      // Soonest SLA dueAt — order by the min(dueAt) of RUNNING clocks.
      // SQLite doesn't support ordering by an aggregate, so we approximate by
      // ordering by updatedAt asc and refine client-side if needed.
      orderBy = { updatedAt: 'asc' };
    }

    const rows = await db.ticket.findMany({
      where: { AND: and },
      include: TICKET_LIST_INCLUDE,
      orderBy,
      take: limit,
    });

    let result = rows.map((r) => serializeTicketListRow(r as TicketListRow));

    if (breachingSoon) {
      result = result.filter((t) => {
        const clocks = t.slaClocks ?? [];
        return clocks.some(
          (c) =>
            c.status === 'RUNNING' &&
            c.percentRemaining !== null &&
            c.percentRemaining <= 25,
        );
      });
    }

    if (sort === 'sla') {
      const nextDueAt = (t: (typeof result)[number]) => {
        const clocks = t.slaClocks ?? [];
        const running = clocks.filter((c) => c.status === 'RUNNING');
        if (running.length === 0) return Number.MAX_SAFE_INTEGER;
        return Math.min(...running.map((c) => new Date(c.dueAt).getTime()));
      };
      result.sort((a, b) => nextDueAt(a) - nextDueAt(b));
    }

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---- POST /api/tickets -----------------------------------------------------
//
// Create a new ticket. All authenticated roles may create.
//
// Body:
//   title             required, 1..200
//   description       required
//   type              INCIDENT | SERVICE_REQUEST | QUESTION | COMPLAINT
//   priority          P1 | P2 | P3 | P4 (default P3)
//   impact?           LOW | MEDIUM | HIGH
//   urgency?          LOW | MEDIUM | HIGH
//   serviceId?        must reference an existing Service
//   serviceCustomerId? customer orgNode (default: caller.orgNodeId for
//                      SERVICE_CUSTOMER; required for other roles)
//
// Side effects:
//   - auto-generate number (TKT-XXXX)
//   - resolve SLA policy; if found, create RESPONSE + RESOLUTION SlaClocks
//   - emit CREATED TicketEvent
//   - audit log entry
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // SERVICE_OWNER is read-only — they cannot create tickets.
    if (session.role === 'SERVICE_OWNER') {
      return NextResponse.json(
        { error: 'Service Owners cannot create tickets (read-only role)' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json({ error: 'Title must be 200 characters or less' }, { status: 400 });
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const VALID_TYPES = ['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT'];
    const type =
      typeof body.type === 'string' && VALID_TYPES.includes(body.type.toUpperCase())
        ? body.type.toUpperCase()
        : 'INCIDENT';

    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    const priority =
      typeof body.priority === 'string' && VALID_PRIORITIES.includes(body.priority.toUpperCase())
        ? body.priority.toUpperCase()
        : 'P3';

    const VALID_IMPACT = ['LOW', 'MEDIUM', 'HIGH'];
    const impact =
      typeof body.impact === 'string' && VALID_IMPACT.includes(body.impact.toUpperCase())
        ? body.impact.toUpperCase()
        : null;
    const urgency =
      typeof body.urgency === 'string' && VALID_IMPACT.includes(body.urgency.toUpperCase())
        ? body.urgency.toUpperCase()
        : null;

    const serviceId =
      typeof body.serviceId === 'string' && body.serviceId.trim()
        ? body.serviceId.trim()
        : null;
    if (serviceId) {
      const svc = await db.service.findUnique({
        where: { id: serviceId },
        select: { id: true },
      });
      if (!svc) {
        return NextResponse.json({ error: 'serviceId does not reference a known service' }, { status: 400 });
      }
    }

    // serviceCustomerId: default to caller's orgNode for SERVICE_CUSTOMER.
    let serviceCustomerId: string | undefined =
      typeof body.serviceCustomerId === 'string' && body.serviceCustomerId.trim()
        ? body.serviceCustomerId.trim()
        : session.orgNodeId ?? undefined;

    if (!serviceCustomerId) {
      return NextResponse.json(
        { error: 'serviceCustomerId is required (caller has no orgNode)' },
        { status: 400 },
      );
    }

    // SERVICE_CUSTOMER can only create tickets for their own orgNode.
    if (
      session.role === 'SERVICE_CUSTOMER' &&
      session.orgNodeId &&
      session.orgNodeId !== serviceCustomerId
    ) {
      return NextResponse.json(
        { error: 'Customers can only raise tickets for their own organization' },
        { status: 403 },
      );
    }

    // Verify the customer org node exists.
    const org = await db.orgNode.findUnique({
      where: { id: serviceCustomerId },
      select: { id: true, name: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'Customer org node not found' }, { status: 400 });
    }

    // SequenceCounter-based ticket number — race-free increment under a single
    // atomic upsert. Format: <prefix>-<year>-<6-digit-seq> (e.g. INC-2024-000001).
    // The prefix encodes the ticket type so the number is human-readable.
    const prefix =
      type === 'INCIDENT'
        ? 'INC'
        : type === 'SERVICE_REQUEST'
          ? 'REQ'
          : type === 'COMPLAINT'
            ? 'CMP'
            : 'CSM'; // QUESTION + fallback
    const year = new Date().getFullYear();
    const counter = await db.sequenceCounter.upsert({
      where: { key: prefix },
      update: { value: { increment: 1 } },
      create: { key: prefix, value: 1 },
    });
    const number = `${prefix}-${year}-${String(counter.value).padStart(6, '0')}`;

    const created = await db.ticket.create({
      data: {
        number,
        title,
        description,
        type,
        priority,
        impact,
        urgency,
        status: 'NEW',
        serviceId,
        serviceCustomerId,
        requesterId: session.id,
      },
      include: {
        service: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });

    // SLA policy + clocks
    const policy = await resolveSlaPolicy(serviceId, type, priority);
    if (policy) {
      await createSlaClocksForTicket(
        created.id,
        policy.id,
        policy.responseMins,
        policy.resolutionMins,
        created.createdAt,
      );
    }

    // CREATED event
    await db.ticketEvent.create({
      data: {
        ticketId: created.id,
        eventType: 'CREATED',
        actorId: session.id,
        actorName: session.name,
        notes: `Ticket ${number} created by ${session.name}.`,
      },
    });

    await auditLog({
      actor: session,
      action: 'TICKET_CREATED',
      entityType: 'Ticket',
      entityId: created.id,
      after: {
        number,
        title,
        type,
        priority,
        serviceCustomerId,
        serviceId,
        policyId: policy?.id ?? null,
      },
    });

    // Notify all SCM workers + CM Leaders that a new ticket has arrived
    // (so they can triage/assign). Skip notifying the creator.
    const recipients = await db.user.findMany({
      where: {
        role: { in: ['SCM_WORKER', 'CM_LEADER'] },
        id: { not: session.id },
      },
      select: { id: true },
    });
    if (recipients.length > 0) {
      await db.notification.createMany({
        data: recipients.map((u) => ({
          userId: u.id,
          type: 'TicketCreated',
          title: `New ${type.toLowerCase()} ticket: ${number}`,
          message: `${session.name} raised a ${priority} ${type.toLowerCase()} "${title}".`,
          entityRef: `ticket:${created.id}`,
        })),
      });
    }

    // Return the freshly-created ticket with events + slaClocks.
    const fresh = await db.ticket.findUnique({
      where: { id: created.id },
      include: TICKET_INCLUDE,
    });
    return NextResponse.json(serializeTicket(fresh as TicketWithRelations), {
      status: 201,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
