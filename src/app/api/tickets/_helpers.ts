// Shared ticket helpers used by the tickets API routes:
//   - role-scoped `where` clause builder for ticket list/detail visibility
//   - SLA policy resolution + SLA clock lifecycle transitions
//
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { db } from '@/lib/db';
import type { Role, SessionUser } from '@/lib/types';

// ---- Role scoping ----------------------------------------------------------

/**
 * Build the role-scoped Prisma `where` clause for Ticket list queries.
 *
 * Returns `null` when the caller has no scope at all (e.g. customer without
 * orgNode, or service owner who owns zero services) — callers should respond
 * with an empty list in that case.
 *
 * Scope rules (per task contract):
 *   - SERVICE_CUSTOMER: only tickets for their own orgNode (serviceCustomerId)
 *   - SCM_WORKER: assigned-to-me + unassigned + tickets on customer orgs they
 *                 serve (i.e. tickets whose serviceCustomerId matches one of
 *                 the orgNodes they currently serve as the assigned SCM). We
 *                 approximate "customer orgs they serve" as: every customer
 *                 orgNode that has at least one demand currently assigned to
 *                 this SCM Worker. This keeps the rule pragmatic without
 *                 requiring an explicit "SCM-to-customer" mapping table.
 *   - CM_LEADER: all tenant tickets
 *   - SERVICE_OWNER: tickets on services they own (serviceOwnerId = caller.id)
 */
export async function buildTicketScope(
  session: SessionUser,
): Promise<Record<string, unknown> | null> {
  if (session.role === ('CM_LEADER' as Role)) {
    return {};
  }
  if (session.role === ('SERVICE_CUSTOMER' as Role)) {
    if (!session.orgNodeId) return null;
    return { serviceCustomerId: session.orgNodeId };
  }
  if (session.role === ('SCM_WORKER' as Role)) {
    // Assigned-to-me OR unassigned OR customers I serve.
    // Resolve "customers I serve" via the demands currently assigned to me.
    const myCustomerOrgIds = await db.demand
      .findMany({
        where: { assignedScmWorkerId: session.id },
        select: { serviceCustomerId: true },
        distinct: ['serviceCustomerId'],
      })
      .then((rows) => rows.map((r) => r.serviceCustomerId));

    const orClauses: Record<string, unknown>[] = [
      { assignedUserId: session.id },
      { assignedUserId: null },
    ];
    if (myCustomerOrgIds.length > 0) {
      orClauses.push({ serviceCustomerId: { in: myCustomerOrgIds } });
    }
    return { OR: orClauses };
  }
  if (session.role === ('SERVICE_OWNER' as Role)) {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    if (owned.length === 0) {
      // Sentinel that forces an empty result set.
      return { id: '__none__' };
    }
    return { serviceId: { in: owned.map((s) => s.id) } };
  }
  return null;
}

/**
 * Verify the caller has read access to a single ticket, given its row.
 * Returns true if access is granted, false otherwise.
 *
 * Rules mirror `buildTicketScope` but applied to a single ticket row.
 */
export async function canReadTicket(
  session: SessionUser,
  ticket: {
    id: string;
    serviceCustomerId: string;
    serviceId: string | null;
    assignedUserId: string | null;
  },
): Promise<boolean> {
  if (session.role === 'CM_LEADER') return true;
  if (session.role === 'SERVICE_CUSTOMER') {
    return session.orgNodeId != null && session.orgNodeId === ticket.serviceCustomerId;
  }
  if (session.role === 'SCM_WORKER') {
    if (ticket.assignedUserId === session.id) return true;
    if (ticket.assignedUserId === null) return true;
    // Customers I serve
    const myCustomerOrgIds = await db.demand
      .findMany({
        where: { assignedScmWorkerId: session.id },
        select: { serviceCustomerId: true },
        distinct: ['serviceCustomerId'],
      })
      .then((rows) => rows.map((r) => r.serviceCustomerId));
    return myCustomerOrgIds.includes(ticket.serviceCustomerId);
  }
  if (session.role === 'SERVICE_OWNER') {
    if (!ticket.serviceId) return false;
    const owned = await db.service.findFirst({
      where: { id: ticket.serviceId, serviceOwnerId: session.id },
      select: { id: true },
    });
    return !!owned;
  }
  return false;
}

/**
 * Roles that can mutate ticket state (triage, assign, progress, etc.).
 * Customers and Service Owners have narrower, dedicated paths.
 */
export function isAgent(role: Role): boolean {
  return role === 'SCM_WORKER' || role === 'CM_LEADER';
}

// ---- SLA policy resolution -------------------------------------------------

/**
 * Resolve the SLA policy to apply to a new ticket.
 *
 * Search order:
 *   1. exact match on (serviceId, ticketType, priority)
 *   2. (serviceId, ticketType='ALL', priority)
 *   3. (serviceId, priority, ticketType='ALL') — both combos are checked
 *   4. (serviceId='null', ticketType, priority) — global service-wide policy
 *   5. priority-only fallback (any policy with the same priority)
 *
 * Returns the policy or null if none match.
 */
export async function resolveSlaPolicy(
  serviceId: string | null,
  ticketType: string,
  priority: string,
) {
  const candidates = [
    // 1. exact
    { serviceId: serviceId ?? undefined, ticketType, priority, active: true },
    // 2. service + ALL type + priority
    { serviceId: serviceId ?? undefined, ticketType: 'ALL', priority, active: true },
    // 3. global (no service) + type + priority
    { serviceId: null, ticketType, priority, active: true },
    // 4. global (no service) + ALL type + priority
    { serviceId: null, ticketType: 'ALL', priority, active: true },
  ];

  for (const c of candidates) {
    const policy = await db.slaPolicy.findFirst({ where: c });
    if (policy) return policy;
  }

  // 5. priority-only fallback
  return db.slaPolicy.findFirst({ where: { priority, active: true } });
}

/**
 * Create the two SlaClock rows (RESPONSE + RESOLUTION) for a newly-created
 * ticket, based on the resolved SlaPolicy. If no policy is found, no clocks
 * are created (the ticket still works, just without SLA tracking).
 *
 * `startedAt` defaults to now (ticket.createdAt); `dueAt` is computed as
 *   startedAt + responseMins  | resolutionMins.
 */
export async function createSlaClocksForTicket(
  ticketId: string,
  policyId: string,
  responseMins: number,
  resolutionMins: number,
  startedAt: Date = new Date(),
): Promise<void> {
  const responseDue = new Date(startedAt.getTime() + responseMins * 60_000);
  const resolutionDue = new Date(startedAt.getTime() + resolutionMins * 60_000);
  await db.slaClock.createMany({
    data: [
      {
        ticketId,
        policyId,
        type: 'RESPONSE',
        status: 'RUNNING',
        startedAt,
        dueAt: responseDue,
        totalPausedMins: 0,
      },
      {
        ticketId,
        policyId,
        type: 'RESOLUTION',
        status: 'RUNNING',
        startedAt,
        dueAt: resolutionDue,
        totalPausedMins: 0,
      },
    ],
  });
}

// ---- SLA clock lifecycle transitions ---------------------------------------

/**
 * Mark all RUNNING SLA clocks for a ticket as PAUSED, capturing `pausedAt`.
 * Idempotent: clocks already PAUSED/BREACHED/MET are left alone.
 */
export async function pauseSlaClocks(ticketId: string, now: Date = new Date()) {
  const clocks = await db.slaClock.findMany({
    where: { ticketId, status: 'RUNNING' },
  });
  for (const c of clocks) {
    await db.slaClock.update({
      where: { id: c.id },
      data: { status: 'PAUSED', pausedAt: now },
    });
  }
}

/**
 * Resume all PAUSED SLA clocks for a ticket: add the paused duration to
 * `totalPausedMins`, clear `pausedAt`, advance `dueAt` by the paused duration
 * (so the customer isn't penalised for the wait), and set status back to
 * RUNNING.
 *
 * Idempotent: RUNNING/BREACHED/MET clocks are untouched.
 */
export async function resumeSlaClocks(ticketId: string, now: Date = new Date()) {
  const clocks = await db.slaClock.findMany({
    where: { ticketId, status: 'PAUSED' },
  });
  for (const c of clocks) {
    if (!c.pausedAt) continue;
    const pausedMins = Math.max(
      0,
      Math.round((now.getTime() - c.pausedAt.getTime()) / 60_000),
    );
    const newDueAt = new Date(c.dueAt.getTime() + pausedMins * 60_000);
    await db.slaClock.update({
      where: { id: c.id },
      data: {
        status: 'RUNNING',
        pausedAt: null,
        totalPausedMins: c.totalPausedMins + pausedMins,
        dueAt: newDueAt,
      },
    });
  }
}

/**
 * Mark all running/paused SLA clocks for a ticket as MET, setting `metAt`.
 * Used when the ticket is RESOLVED.
 *
 * Clocks that are already BREACHED remain BREACHED (a breach cannot be undone
 * by resolution) — they simply don't transition.
 */
export async function metSlaClocks(ticketId: string, now: Date = new Date()) {
  const clocks = await db.slaClock.findMany({
    where: { ticketId, status: { in: ['RUNNING', 'PAUSED'] } },
  });
  for (const c of clocks) {
    await db.slaClock.update({
      where: { id: c.id },
      data: { status: 'MET', metAt: now, pausedAt: null },
    });
  }
}

/**
 * Restart SLA clocks for a ticket that has been reopened.
 *
 * Strategy: clocks that were MET (or BREACHED) when the ticket was previously
 * resolved/closed are reset back to RUNNING with a fresh `startedAt` = now and
 * a new `dueAt` = now + original policy minutes. The original policy is read
 * from each clock's `policyId`.
 */
export async function restartSlaClocks(ticketId: string, now: Date = new Date()) {
  const clocks = await db.slaClock.findMany({
    where: { ticketId, status: { in: ['MET', 'BREACHED', 'PAUSED'] } },
    include: { policy: true },
  });
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
  }
}

// ---- Ticket number generator -----------------------------------------------

/**
 * Generate the next human-readable ticket number, formatted as `TKT-XXXX`
 * (zero-padded to 4 digits, growing beyond if needed).
 *
 * Uses a count-based scheme rather than a `max(number)` lookup so that any
 * deleted or gap-creating rows don't collide. The `number` column has a
 * unique constraint — on the off chance of a collision we retry a few times.
 */
export async function generateTicketNumber(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.ticket.count();
    const next = count + 1 + attempt;
    const candidate = `TKT-${String(next).padStart(4, '0')}`;
    const existing = await db.ticket.findUnique({
      where: { number: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Fallback — use a timestamp-suffixed number if we still can't get a slot.
  return `TKT-${Date.now().toString().slice(-6)}`;
}
