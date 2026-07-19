// Shared helpers for the tickets API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import type {
  Ticket,
  TicketEventRow,
  SlaClockRow,
  TicketType,
  TicketPriority,
  Impact,
  TicketStatus,
  ResolutionCode,
  SlaClockType,
  SlaClockStatus,
} from '@/lib/tickets';

// Prisma include shape used by every ticket fetch so the serializer can rely
// on the relations being present.
export const TICKET_INCLUDE = {
  service: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  events: { orderBy: { createdAt: 'desc' as const } },
  slaClocks: {
    include: { policy: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'asc' as const },
  },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

// ---- Serializers ----

export function serializeTicketEvent(
  e: Prisma.TicketEventGetPayload<Record<string, never>>,
): TicketEventRow {
  return {
    id: e.id,
    ticketId: e.ticketId,
    eventType: e.eventType,
    actorId: e.actorId,
    actorName: e.actorName,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeSlaClock(
  c: Prisma.SlaClockGetPayload<{
    include: { policy: { select: { id: true; name: true } } };
  }>,
): SlaClockRow {
  const now = Date.now();
  const startedMs = c.startedAt.getTime();
  const dueMs = c.dueAt.getTime();
  const totalDurationMins = Math.max(1, Math.round((dueMs - startedMs) / 60000));
  const elapsedMins = Math.max(
    0,
    Math.round((now - startedMs) / 60000) - c.totalPausedMins,
  );

  let remainingMins: number | null = null;
  let percentRemaining: number | null = null;
  if (c.status === 'RUNNING') {
    remainingMins = Math.round((dueMs - now) / 60000);
    percentRemaining = Math.max(
      0,
      Math.min(100, Math.round((remainingMins / totalDurationMins) * 100)),
    );
  }

  return {
    id: c.id,
    ticketId: c.ticketId,
    policyId: c.policyId,
    policyName: c.policy?.name,
    type: c.type as SlaClockType,
    status: c.status as SlaClockStatus,
    startedAt: c.startedAt.toISOString(),
    dueAt: c.dueAt.toISOString(),
    pausedAt: c.pausedAt ? c.pausedAt.toISOString() : null,
    totalPausedMins: c.totalPausedMins,
    metAt: c.metAt ? c.metAt.toISOString() : null,
    breachedAt: c.breachedAt ? c.breachedAt.toISOString() : null,
    remainingMins,
    elapsedMins,
    percentRemaining,
  };
}

export function serializeTicket(t: TicketWithRelations): Ticket {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    type: t.type as TicketType,
    priority: t.priority as TicketPriority,
    impact: (t.impact as Impact | null) ?? null,
    urgency: (t.urgency as Impact | null) ?? null,
    status: t.status as TicketStatus,
    serviceId: t.serviceId,
    serviceName: t.service?.name ?? null,
    serviceCustomerId: t.serviceCustomerId,
    serviceCustomerName: t.customer?.name ?? null,
    requesterId: t.requesterId,
    requesterName: t.requester?.name ?? null,
    assignedUserId: t.assignedUserId,
    assignedUserName: t.assignee?.name ?? null,
    assignmentGroupId: t.assignmentGroupId,
    resolutionCode: (t.resolutionCode as ResolutionCode | null) ?? null,
    resolutionNotes: t.resolutionNotes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    events: t.events?.map(serializeTicketEvent),
    slaClocks: t.slaClocks?.map(serializeSlaClock),
  };
}

// ---- Light serializer for list view (no events, but with SLA summary) ----

export const TICKET_LIST_INCLUDE = {
  service: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  slaClocks: {
    select: {
      id: true,
      ticketId: true,
      policyId: true,
      type: true,
      status: true,
      dueAt: true,
      startedAt: true,
      totalPausedMins: true,
      metAt: true,
      breachedAt: true,
      pausedAt: true,
      tenantId: true,
    },
    orderBy: { startedAt: 'asc' as const },
  },
} satisfies Prisma.TicketInclude;

export type TicketListRow = Prisma.TicketGetPayload<{ include: typeof TICKET_LIST_INCLUDE }>;

export function serializeTicketListRow(t: TicketListRow): Ticket {
  // Reuse serializeSlaClock by adding the (empty) policy relation it expects.
  const clocks = t.slaClocks.map((c) =>
    serializeSlaClock({ ...c, policy: { id: '', name: '' } }),
  );
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    type: t.type as TicketType,
    priority: t.priority as TicketPriority,
    impact: (t.impact as Impact | null) ?? null,
    urgency: (t.urgency as Impact | null) ?? null,
    status: t.status as TicketStatus,
    serviceId: t.serviceId,
    serviceName: t.service?.name ?? null,
    serviceCustomerId: t.serviceCustomerId,
    serviceCustomerName: t.customer?.name ?? null,
    requesterId: t.requesterId,
    requesterName: t.requester?.name ?? null,
    assignedUserId: t.assignedUserId,
    assignedUserName: t.assignee?.name ?? null,
    assignmentGroupId: t.assignmentGroupId,
    resolutionCode: (t.resolutionCode as ResolutionCode | null) ?? null,
    resolutionNotes: t.resolutionNotes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    slaClocks: clocks,
  };
}

// ---- Error helper ----

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      err.message.startsWith('INVALID_') ||
      err.message === 'NOT_FOUND' ||
      err.message === 'CONFLICT'
    ) {
      const status =
        err.message === 'NOT_FOUND' ? 404 : err.message === 'CONFLICT' ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
