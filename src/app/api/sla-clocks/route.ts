import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Role, SessionUser } from '@/lib/types';

export const runtime = 'nodejs';

interface SlaClockRow {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  ticketStatus: string;
  ticketPriority: string;
  ticketType: string;
  serviceId: string | null;
  serviceName: string | null;
  serviceCustomerId: string;
  serviceCustomerName: string | null;
  policyId: string;
  policyName: string;
  type: string;
  status: string;
  startedAt: string;
  dueAt: string;
  pausedAt: string | null;
  totalPausedMins: number;
  metAt: string | null;
  breachedAt: string | null;
  // Derived display helpers
  remainingMins: number | null; // minutes remaining until dueAt (negative if overdue), null if not RUNNING
  elapsedMins: number; // minutes elapsed since startedAt (excluding paused), capped to now
  percentRemaining: number | null; // 0..100 of clock time remaining (null if not RUNNING or dueAt<=startedAt)
}

// Prisma payload type for a SlaClock with ticket + policy relations included.
type ClockWithRelations = Prisma.SlaClockGetPayload<{
  include: {
    ticket: {
      select: {
        id: true;
        number: true;
        title: true;
        status: true;
        priority: true;
        type: true;
        serviceId: true;
        serviceCustomerId: true;
        service: { select: { id: true; name: true } };
        customer: { select: { id: true; name: true } };
      };
    };
    policy: { select: { id: true; name: true } };
  };
}>;

function serializeClock(c: ClockWithRelations): SlaClockRow {
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
    ticketNumber: c.ticket?.number ?? '',
    ticketTitle: c.ticket?.title ?? '',
    ticketStatus: c.ticket?.status ?? '',
    ticketPriority: c.ticket?.priority ?? '',
    ticketType: c.ticket?.type ?? '',
    serviceId: c.ticket?.serviceId ?? null,
    serviceName: c.ticket?.service?.name ?? null,
    serviceCustomerId: c.ticket?.serviceCustomerId ?? '',
    serviceCustomerName: c.ticket?.customer?.name ?? null,
    policyId: c.policyId,
    policyName: c.policy?.name ?? '',
    type: c.type,
    status: c.status,
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

/**
 * Resolve the role-scoped `where` clause for ticket-scoped queries.
 *
 * SlaClock scoping follows the ticket visibility rules:
 *   - SERVICE_CUSTOMER: only tickets for their own orgNode (serviceCustomerId)
 *   - SCM_WORKER: tickets assigned to them
 *   - SERVICE_OWNER: tickets on services they own
 *   - CM_LEADER: all tickets
 *
 * Returns null if the caller has no scope at all (e.g. customer without orgNode).
 */
async function buildTicketScope(session: SessionUser): Promise<Record<string, unknown> | null> {
  if (session.role === 'CM_LEADER' as Role) {
    return {};
  }
  if (session.role === 'SERVICE_CUSTOMER' as Role) {
    if (!session.orgNodeId) return null;
    return { serviceCustomerId: session.orgNodeId };
  }
  if (session.role === 'SCM_WORKER' as Role) {
    return { assignedUserId: session.id };
  }
  if (session.role === 'SERVICE_OWNER' as Role) {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    if (owned.length === 0) return { id: '__none__' }; // forces empty result
    return { serviceId: { in: owned.map((s) => s.id) } };
  }
  return null;
}

/**
 * GET /api/sla-clocks
 *
 * List SLA clocks. All authenticated roles; scoping follows ticket visibility.
 *
 * Query params:
 *   ticketId — restrict to a single ticket
 *   status   — RUNNING | PAUSED | MET | BREACHED | CANCELED (comma-separated multi)
 *   type     — RESPONSE | RESOLUTION
 *   policyId — restrict to a single policy
 *   serviceId — restrict to clocks on tickets for a specific service
 *   customerId — restrict to clocks on tickets for a specific customer orgNode
 *   overdue=1 — only RUNNING clocks with dueAt < now
 *   atRisk=1  — only RUNNING clocks within 30% of dueAt (≤ 30% time remaining)
 *
 * Response: SlaClockRow[] ordered by dueAt asc, with ticket + policy + service
 *           + customer relations joined.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ticketScope = await buildTicketScope(session);
  if (ticketScope === null) {
    return NextResponse.json([]);
  }

  const sp = req.nextUrl.searchParams;

  // Build the SlaClock where clause
  const where: Record<string, unknown> = {};

  const ticketId = sp.get('ticketId');
  if (ticketId) where.ticketId = ticketId;

  const policyId = sp.get('policyId');
  if (policyId) where.policyId = policyId;

  const type = sp.get('type');
  if (type) where.type = type.toUpperCase();

  const statusParam = sp.get('status');
  if (statusParam) {
    const statuses = statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };
  }

  // Ticket relation filters (combine with role scope)
  const ticketWhere: Record<string, unknown> = { ...ticketScope };
  const serviceIdParam = sp.get('serviceId');
  if (serviceIdParam) ticketWhere.serviceId = serviceIdParam;

  const customerIdParam = sp.get('customerId');
  if (customerIdParam) ticketWhere.serviceCustomerId = customerIdParam;

  if (Object.keys(ticketWhere).length > 0) {
    where.ticket = ticketWhere;
  }

  const now = new Date();

  // overdue=1: only RUNNING clocks with dueAt < now
  const overdue = sp.get('overdue') === '1';
  // atRisk=1: RUNNING clocks with ≤30% time remaining — handled in JS post-filter
  const atRisk = sp.get('atRisk') === '1';

  if (overdue) {
    where.status = 'RUNNING';
    where.dueAt = { lt: now };
  }

  const rows = await db.slaClock.findMany({
    where,
    include: {
      ticket: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priority: true,
          type: true,
          serviceId: true,
          serviceCustomerId: true,
          service: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      },
      policy: { select: { id: true, name: true } },
    },
    orderBy: [{ dueAt: 'asc' }, { startedAt: 'desc' }],
    take: 300,
  });

  let result = rows.map(serializeClock);

  if (atRisk) {
    result = result.filter(
      (c) =>
        c.status === 'RUNNING' &&
        c.percentRemaining !== null &&
        c.percentRemaining <= 30,
    );
  }

  return NextResponse.json(result);
}
