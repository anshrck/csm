import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

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
 * GET /api/sla-policies/[id]
 *
 * Read a single SLA policy. All authenticated roles may read.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const row = await db.slaPolicy.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true } },
      businessCalendar: { select: { id: true, name: true } },
    },
  });
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(serializePolicy(row));
}

/**
 * PATCH /api/sla-policies/[id]
 *
 * Update an existing SLA policy. CM_LEADER only.
 *
 * All body fields optional; only provided fields are updated.
 * Validates foreign keys (serviceId / businessCalendarId) when supplied.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const existing = await db.slaPolicy.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true } },
      businessCalendar: { select: { id: true, name: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (typeof body.name === 'string' && body.name.trim()) {
    data.name = body.name.trim();
  }

  if (body.ticketType !== undefined) {
    const ticketType = typeof body.ticketType === 'string' ? body.ticketType.toUpperCase() : '';
    if (!TICKET_TYPES.includes(ticketType as TicketType)) {
      return NextResponse.json(
        { error: `ticketType must be one of: ${TICKET_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    data.ticketType = ticketType;
  }

  if (body.priority !== undefined) {
    const priority = typeof body.priority === 'string' ? body.priority.toUpperCase() : '';
    if (!PRIORITIES.includes(priority as Priority)) {
      return NextResponse.json(
        { error: `priority must be one of: ${PRIORITIES.join(', ')}` },
        { status: 400 },
      );
    }
    data.priority = priority;
  }

  if (body.responseMins !== undefined) {
    const v = Number(body.responseMins);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      return NextResponse.json(
        { error: 'responseMins must be a non-negative integer' },
        { status: 400 },
      );
    }
    data.responseMins = v;
  }

  if (body.resolutionMins !== undefined) {
    const v = Number(body.resolutionMins);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      return NextResponse.json(
        { error: 'resolutionMins must be a non-negative integer' },
        { status: 400 },
      );
    }
    data.resolutionMins = v;
  }

  if (body.serviceId !== undefined) {
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
        return NextResponse.json(
          { error: 'serviceId does not reference a known service' },
          { status: 400 },
        );
      }
    }
    data.serviceId = serviceId;
  }

  if (body.businessCalendarId !== undefined) {
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
    data.businessCalendarId = businessCalendarId;
  }

  if (body.active !== undefined) {
    data.active = Boolean(body.active);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await db.slaPolicy.update({
    where: { id },
    data,
    include: {
      service: { select: { id: true, name: true } },
      businessCalendar: { select: { id: true, name: true } },
    },
  });

  await auditLog({
    actor: session,
    action: 'SLA_POLICY_UPDATE',
    entityType: 'SlaPolicy',
    entityId: id,
    before: serializePolicy(existing),
    after: serializePolicy(updated),
  });

  return NextResponse.json(serializePolicy(updated));
}
