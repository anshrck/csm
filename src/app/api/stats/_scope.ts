// Enterprise Workflow Review — Stats domain scope resolver.
//
// Shared by the six role-scoped /api/stats/* endpoints. Resolves the caller's
// visibility into the four operational domains (tickets, demands, SLA events,
// SLA clocks, customers) and exposes ready-to-use Prisma `where` clauses.
//
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { db } from '@/lib/db';
import { getAssignedCustomerOrgIds } from '@/lib/entity-access';
import type { SessionUser } from '@/lib/types';

export interface StatsScope {
  role: SessionUser['role'];
  userId: string;
  /** SERVICE_CUSTOMER: own orgNode id (or null when missing). */
  customerOrgId: string | null;
  /** SCM_WORKER: customer orgNode ids they currently serve. */
  scmCustomerOrgIds: string[];
  /** SERVICE_OWNER: services they own. */
  ownedServiceIds: string[];
  /** True for CM_LEADER (everything in scope) or any role with empty scope. */
  isAllTenant: boolean;
}

/**
 * Resolve the role-scoped stats context for the calling session.
 *
 *   SERVICE_CUSTOMER → their orgNode
 *   SCM_WORKER       → assigned customer orgs (via CustomerAssignment)
 *   CM_LEADER        → all tenant
 *   SERVICE_OWNER    → services they own
 */
export async function resolveStatsScope(session: SessionUser): Promise<StatsScope> {
  const role = session.role;
  if (role === 'CM_LEADER') {
    return {
      role,
      userId: session.id,
      customerOrgId: null,
      scmCustomerOrgIds: [],
      ownedServiceIds: [],
      isAllTenant: true,
    };
  }
  if (role === 'SERVICE_CUSTOMER') {
    return {
      role,
      userId: session.id,
      customerOrgId: session.orgNodeId ?? null,
      scmCustomerOrgIds: [],
      ownedServiceIds: [],
      isAllTenant: false,
    };
  }
  if (role === 'SCM_WORKER') {
    const scmCustomerOrgIds = await getAssignedCustomerOrgIds(session.id);
    return {
      role,
      userId: session.id,
      customerOrgId: null,
      scmCustomerOrgIds,
      ownedServiceIds: [],
      isAllTenant: false,
    };
  }
  // SERVICE_OWNER
  const owned = await db.service.findMany({
    where: { serviceOwnerId: session.id },
    select: { id: true },
  });
  return {
    role,
    userId: session.id,
    customerOrgId: null,
    scmCustomerOrgIds: [],
    ownedServiceIds: owned.map((s) => s.id),
    isAllTenant: false,
  };
}

/**
 * Build the role-scoped `where` clause for Ticket queries.
 *
 *   SERVICE_CUSTOMER: own orgNode tickets
 *   SCM_WORKER:       assigned-to-me + unassigned + tickets on assigned customer orgs
 *   CM_LEADER:        all tenant tickets
 *   SERVICE_OWNER:    tickets on owned services
 *
 * Returns `{ id: '__none__' }` (a sentinel that forces an empty result set)
 * if the caller has no scope at all.
 */
export function ticketWhere(scope: StatsScope): Record<string, unknown> {
  if (scope.isAllTenant) return {};
  if (scope.role === 'SERVICE_CUSTOMER') {
    if (!scope.customerOrgId) return { id: '__none__' };
    return { serviceCustomerId: scope.customerOrgId };
  }
  if (scope.role === 'SCM_WORKER') {
    const orClauses: Record<string, unknown>[] = [
      { assignedUserId: scope.userId },
      { assignedUserId: null },
    ];
    if (scope.scmCustomerOrgIds.length > 0) {
      orClauses.push({ serviceCustomerId: { in: scope.scmCustomerOrgIds } });
    }
    return { OR: orClauses };
  }
  if (scope.role === 'SERVICE_OWNER') {
    if (scope.ownedServiceIds.length === 0) return { id: '__none__' };
    return { serviceId: { in: scope.ownedServiceIds } };
  }
  return { id: '__none__' };
}

/**
 * Build the role-scoped `where` clause for Demand queries.
 *
 *   SERVICE_CUSTOMER: own orgNode demands
 *   SCM_WORKER:       assigned-to-me + unassigned demands + assigned customer orgs
 *   CM_LEADER:        all tenant demands
 *   SERVICE_OWNER:    demands touching owned services (server-side filter on the
 *                     JSON-encoded relatedServiceIds is impractical in SQLite —
 *                     caller should filter client-side after fetching).
 */
export function demandWhere(scope: StatsScope): Record<string, unknown> {
  if (scope.isAllTenant) return {};
  if (scope.role === 'SERVICE_CUSTOMER') {
    if (!scope.customerOrgId) return { id: '__none__' };
    return { serviceCustomerId: scope.customerOrgId };
  }
  if (scope.role === 'SCM_WORKER') {
    const orClauses: Record<string, unknown>[] = [
      { assignedScmWorkerId: scope.userId },
      { assignedScmWorkerId: null },
    ];
    if (scope.scmCustomerOrgIds.length > 0) {
      orClauses.push({ serviceCustomerId: { in: scope.scmCustomerOrgIds } });
    }
    return { OR: orClauses };
  }
  // SERVICE_OWNER: returns empty where — caller must filter client-side by
  // relatedServiceIds intersecting scope.ownedServiceIds.
  return {};
}

/**
 * Build the role-scoped `where` clause for SlaEvent queries.
 *
 *   SERVICE_CUSTOMER: events tied to their customer org
 *   SCM_WORKER:       events for their assigned customer orgs (or all-tenant
 *                     events when SCM has no customer assignments yet)
 *   CM_LEADER:        all events
 *   SERVICE_OWNER:    events on owned services
 */
export function slaEventWhere(scope: StatsScope): Record<string, unknown> {
  if (scope.isAllTenant) return {};
  if (scope.role === 'SERVICE_CUSTOMER') {
    if (!scope.customerOrgId) return { id: '__none__' };
    return { serviceCustomerId: scope.customerOrgId };
  }
  if (scope.role === 'SCM_WORKER') {
    if (scope.scmCustomerOrgIds.length === 0) return {};
    return { serviceCustomerId: { in: scope.scmCustomerOrgIds } };
  }
  if (scope.role === 'SERVICE_OWNER') {
    if (scope.ownedServiceIds.length === 0) return { id: '__none__' };
    return { serviceId: { in: scope.ownedServiceIds } };
  }
  return { id: '__none__' };
}

/**
 * Build the role-scoped `where` clause for SlaClock queries (via the
 * ticket relation). Mirrors `ticketWhere` semantics.
 */
export function slaClockTicketWhere(scope: StatsScope): Record<string, unknown> {
  return ticketWhere(scope);
}

/**
 * Parse the JSON-encoded service id array stored on Demand/Change rows.
 */
export function parseServiceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Sentinel where clause that guarantees an empty result set (used by callers
 * to short-circuit when the caller has no scope at all).
 */
export const NONE_WHERE: Record<string, unknown> = { id: '__none__' };
