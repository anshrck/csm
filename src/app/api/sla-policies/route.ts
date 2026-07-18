import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

// Allowed enum values for SlaPolicy rows. We validate against these on write.
const TICKET_TYPES = ['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT', 'ALL'] as const;
const PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'ALL'] as const;
type TicketType = (typeof TICKET_TYPES)[number];
type Priority = (typeof PRIORITIES)[number];

interface SlaPolicyRow {
  id: string;
  name: string;
  serviceId: string | null;
  serviceName: string | null;
  ticketType: string;
  priority: string;
  responseMins: number;
  resolutionMins: number;
  businessCalendarId: string | null;
  businessCalendarName: string | null;
  active: boolean;
  createdAt: string;
}

// Prisma payload type that includes the service + businessCalendar relations.
type SlaPolicyWithRelations = Prisma.SlaPolicyGetPayload<{
  include: {
    service: { select: { id: true; name: true } };
    businessCalendar: { select: { id: true; name: true } };
  };
}>;

function serializePolicy(row: SlaPolicyWithRelations): SlaPolicyRow {
  return {
    id: row.id,
    name: row.name,
    serviceId: row.serviceId,
    serviceName: row.service?.name ?? null,
    ticketType: row.ticketType,
    priority: row.priority,
    responseMins: row.responseMins,
    resolutionMins: row.resolutionMins,
    businessCalendarId: row.businessCalendarId,
    businessCalendarName: row.businessCalendar?.name ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /api/sla-policies
 *
 * List SLA policies. All authenticated roles may read.
 *
 * Query params:
 *   serviceId  — filter by service (or "null" to find policies with no service)
 *   priority   — P1 | P2 | P3 | P4 | ALL
 *   ticketType — INCIDENT | SERVICE_REQUEST | QUESTION | COMPLAINT | ALL
 *   active     — "1" / "true" to restrict to active policies
 *   businessCalendarId — filter by calendar
 *
 * Response: SlaPolicyRow[] ordered by name asc, with serviceName + businessCalendarName joined.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = {};

  const serviceIdParam = sp.get('serviceId');
  if (serviceIdParam) {
    if (serviceIdParam === 'null') {
      where.serviceId = null;
    } else {
      where.serviceId = serviceIdParam;
    }
  }

  const priority = sp.get('priority');
  if (priority) where.priority = priority.toUpperCase();

  const ticketType = sp.get('ticketType');
  if (ticketType) where.ticketType = ticketType.toUpperCase();

  const active = sp.get('active');
  if (active === '1' || active === 'true') where.active = true;
  if (active === '0' || active === 'false') where.active = false;

  const businessCalendarId = sp.get('businessCalendarId');
  if (businessCalendarId) where.businessCalendarId = businessCalendarId;

  const rows = await db.slaPolicy.findMany({
    where,
    include: {
      service: { select: { id: true, name: true } },
      businessCalendar: { select: { id: true, name: true } },
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });

  return NextResponse.json(rows.map(serializePolicy));
}

/**
 * POST /api/sla-policies
 *
 * Create a new SLA policy. CM_LEADER only.
 *
 * Body:
 *   name                (required, non-empty)
 *   serviceId           (optional — omit / null for a global policy)
 *   ticketType          (required, one of TICKET_TYPES)
 *   priority            (required, one of PRIORITIES)
 *   responseMins        (required, int >= 0)
 *   resolutionMins      (required, int >= 0)
 *   businessCalendarId  (optional — must exist if provided)
 *   active              (optional, default true)
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole('CM_LEADER' as Role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const ticketType = typeof body.ticketType === 'string' ? body.ticketType.toUpperCase() : '';
  if (!TICKET_TYPES.includes(ticketType as TicketType)) {
    return NextResponse.json(
      { error: `ticketType must be one of: ${TICKET_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  const priority = typeof body.priority === 'string' ? body.priority.toUpperCase() : '';
  if (!PRIORITIES.includes(priority as Priority)) {
    return NextResponse.json(
      { error: `priority must be one of: ${PRIORITIES.join(', ')}` },
      { status: 400 },
    );
  }

  const responseMins = Number(body.responseMins);
  const resolutionMins = Number(body.resolutionMins);
  if (!Number.isFinite(responseMins) || responseMins < 0 || !Number.isInteger(responseMins)) {
    return NextResponse.json(
      { error: 'responseMins must be a non-negative integer' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(resolutionMins) || resolutionMins < 0 || !Number.isInteger(resolutionMins)) {
    return NextResponse.json(
      { error: 'resolutionMins must be a non-negative integer' },
      { status: 400 },
    );
  }

  const serviceId =
    typeof body.serviceId === 'string' && body.serviceId.trim()
      ? body.serviceId.trim()
      : null;
  if (serviceId) {
    const svc = await db.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!svc) {
      return NextResponse.json({ error: 'serviceId does not reference a known service' }, { status: 400 });
    }
  }

  const businessCalendarId =
    typeof body.businessCalendarId === 'string' && body.businessCalendarId.trim()
      ? body.businessCalendarId.trim()
      : null;
  if (businessCalendarId) {
    const cal = await db.businessCalendar.findUnique({
      where: { id: businessCalendarId },
      select: { id: true },
    });
    if (!cal) {
      return NextResponse.json(
        { error: 'businessCalendarId does not reference a known calendar' },
        { status: 400 },
      );
    }
  }

  const active = body.active === undefined ? true : Boolean(body.active);

  const created = await db.slaPolicy.create({
    data: {
      name,
      serviceId,
      ticketType,
      priority,
      responseMins,
      resolutionMins,
      businessCalendarId,
      active,
    },
    include: {
      service: { select: { id: true, name: true } },
      businessCalendar: { select: { id: true, name: true } },
    },
  });

  await auditLog({
    actor: session,
    action: 'SLA_POLICY_CREATE',
    entityType: 'SlaPolicy',
    entityId: created.id,
    after: serializePolicy(created),
  });

  return NextResponse.json(serializePolicy(created), { status: 201 });
}
