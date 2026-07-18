// Enterprise Workflow Review — Stats compute layer.
//
// Pure data-aggregation functions for the six /api/stats/* endpoints. Each
// function takes a resolved `StatsScope` and returns the JSON-serialisable
// domain payload. The route handlers are thin wrappers that call these and
// return NextResponse.json(...).
//
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { db } from '@/lib/db';
import type { DemandStatus } from '@/lib/types';
import {
  type StatsScope,
  resolveStatsScope,
  ticketWhere,
  demandWhere,
  slaEventWhere,
  parseServiceIds,
} from './_scope';

/* -------------------------------------------------------------------------- */
/*  Shared constants & helpers                                                */
/* -------------------------------------------------------------------------- */

const OPEN_TICKET_STATUSES = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
];

const ACTIVE_DEMAND_STATUSES: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
];

const PIPELINE: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
  'FULFILLED',
];

const PRIORITY_KEYS = ['P1', 'P2', 'P3', 'P4'] as const;
const TYPE_KEYS = ['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT'] as const;
const TICKET_STATUS_KEYS = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'CANCELED',
] as const;

const DAY_MS = 86_400_000;

function ageBucket(createdAt: Date, now = Date.now()): keyof AgingBuckets {
  const days = Math.floor((now - createdAt.getTime()) / DAY_MS);
  if (days <= 1) return '0-1d';
  if (days <= 3) return '1-3d';
  if (days <= 7) return '3-7d';
  if (days <= 14) return '7-14d';
  return '14d+';
}

function avgMinsFromMs(totalMs: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round(totalMs / 60000 / count);
}

/* -------------------------------------------------------------------------- */
/*  Public response interfaces                                                */
/* -------------------------------------------------------------------------- */

export interface AgingBuckets {
  '0-1d': number;
  '1-3d': number;
  '3-7d': number;
  '7-14d': number;
  '14d+': number;
}

export interface TicketsStats {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  unassigned: number;
  waitingCustomer: number;
  reopened: number;
  avgResolutionMins: number | null;
  slaBreached: number;
  aging: AgingBuckets;
}

export interface PipelineEntry {
  status: DemandStatus;
  count: number;
}

export interface DemandsStats {
  byStatus: Record<string, number>;
  pipeline: PipelineEntry[];
  pendingApprovals: number;
  awaitingCustomer: number;
  inChange: number;
  fulfilled: number;
  avgCycleDays: number | null;
}

export interface SlaByServiceEntry {
  serviceId: string;
  serviceName: string;
  slaClass: string;
  compliancePct: number | null;
  breaches: number;
  warnings: number;
}

export interface SlaStats {
  compliancePct: number | null;
  activeBreaches: number;
  activeWarnings: number;
  byService: SlaByServiceEntry[];
  avgResponseMins: number | null;
  avgResolutionMins: number | null;
}

export interface WorkloadByWorkerEntry {
  workerId: string;
  workerName: string;
  avatarColor: string;
  activeTickets: number;
  activeDemands: number;
  slaRisk: number;
  openP1: number;
}

export interface WorkloadByGroupEntry {
  groupId: string;
  groupName: string;
  activeTickets: number;
}

export interface WorkloadStats {
  byWorker: WorkloadByWorkerEntry[];
  byGroup: WorkloadByGroupEntry[];
  unassignedCount: number;
  overdueCount: number;
}

export interface CustomerHealthEntry {
  orgNodeId: string;
  orgNodeName: string;
  openTickets: number;
  activeDemands: number;
  slaBreaches: number;
  avgCsat: number | null;
  healthScore: number;
  health: 'green' | 'amber' | 'red';
}

export interface CustomerHealthStats {
  byCustomer: CustomerHealthEntry[];
}

export interface OverviewStats {
  totalOpenTickets: number;
  totalActiveDemands: number;
  slaBreaches: number;
  slaWarnings: number;
  avgCsat: number | null;
  reopenRate: number | null;
  workloadByWorker: WorkloadByWorkerEntry[];
}

/* -------------------------------------------------------------------------- */
/*  Tickets stats                                                             */
/* -------------------------------------------------------------------------- */

export async function computeTickets(scope: StatsScope): Promise<TicketsStats> {
  const where = ticketWhere(scope);

  // Aggregate counts via parallel groupBy queries (single-column each — SQLite
  // can't group by multiple columns in one call reliably with Prisma).
  const [byStatusRows, byPriorityRows, byTypeRows, openTickets, allTickets] =
    await Promise.all([
      db.ticket.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.ticket.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      db.ticket.groupBy({ by: ['type'], where, _count: { _all: true } }),
      db.ticket.findMany({
        where: { ...where, status: { in: OPEN_TICKET_STATUSES } },
        select: { assignedUserId: true, status: true, createdAt: true, id: true },
      }),
      db.ticket.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          events: { where: { eventType: 'REOPENED' }, select: { id: true } },
        },
      }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r._count._all;
  for (const k of TICKET_STATUS_KEYS) if (!(k in byStatus)) byStatus[k] = 0;

  const byPriority: Record<string, number> = {};
  for (const r of byPriorityRows) byPriority[r.priority] = r._count._all;
  for (const k of PRIORITY_KEYS) if (!(k in byPriority)) byPriority[k] = 0;

  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.type] = r._count._all;
  for (const k of TYPE_KEYS) if (!(k in byType)) byType[k] = 0;

  const unassigned = openTickets.filter((t) => t.assignedUserId === null).length;
  const waitingCustomer = openTickets.filter(
    (t) => t.status === 'WAITING_CUSTOMER',
  ).length;

  const reopened = allTickets.filter((t) => t.events.length > 0).length;

  // Aging buckets — computed across ALL scoped tickets (not just open).
  const aging: AgingBuckets = {
    '0-1d': 0,
    '1-3d': 0,
    '3-7d': 0,
    '7-14d': 0,
    '14d+': 0,
  };
  for (const t of allTickets) {
    aging[ageBucket(t.createdAt)]++;
  }

  // SLA + resolution averages via SlaClock scoped to the same ticket set.
  const ticketIds = allTickets.map((t) => t.id);
  let avgResolutionMins: number | null = null;
  let slaBreached = 0;

  if (ticketIds.length > 0) {
    const [resolutionClocks, breachedTickets] = await Promise.all([
      db.slaClock.findMany({
        where: {
          ticketId: { in: ticketIds },
          type: 'RESOLUTION',
          metAt: { not: null },
        },
        select: { startedAt: true, metAt: true },
      }),
      db.ticket.findMany({
        where: { ...where, slaClocks: { some: { status: 'BREACHED' } } },
        select: { id: true },
      }),
    ]);
    slaBreached = breachedTickets.length;
    if (resolutionClocks.length > 0) {
      let total = 0;
      for (const c of resolutionClocks) {
        const start = c.startedAt.getTime();
        const met = c.metAt ? c.metAt.getTime() : start;
        total += Math.max(0, met - start);
      }
      avgResolutionMins = avgMinsFromMs(total, resolutionClocks.length);
    }
  }

  return {
    byStatus,
    byPriority,
    byType,
    unassigned,
    waitingCustomer,
    reopened,
    avgResolutionMins,
    slaBreached,
    aging,
  };
}

/* -------------------------------------------------------------------------- */
/*  Demands stats                                                             */
/* -------------------------------------------------------------------------- */

export async function computeDemands(scope: StatsScope): Promise<DemandsStats> {
  const baseWhere = demandWhere(scope);

  // Fetch scoped demands (slim projection). SERVICE_OWNER needs client-side
  // filter on relatedServiceIds — handled below.
  let demands = await db.demand.findMany({
    where: baseWhere,
    select: {
      id: true,
      status: true,
      estimatedEffortDays: true,
      estimatedCost: true,
      quoteApprovedByCmLeader: true,
      createdAt: true,
      closedAt: true,
      relatedServiceIds: true,
    },
  });

  if (scope.role === 'SERVICE_OWNER') {
    const owned = new Set(scope.ownedServiceIds);
    demands = demands.filter((d) => {
      const ids = parseServiceIds(d.relatedServiceIds);
      return ids.some((id) => owned.has(id));
    });
  }

  const byStatus: Record<string, number> = {};
  for (const d of demands) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

  const pipeline: PipelineEntry[] = PIPELINE.map((status) => ({
    status,
    count: byStatus[status] ?? 0,
  }));

  // Pending approvals: UNDER_REVIEW with quote fields filled but not yet
  // approved by CM Leader. (Quote fields are considered "filled" when
  // estimatedEffortDays or estimatedCost is non-null.)
  const pendingApprovals = demands.filter(
    (d) =>
      d.status === 'UNDER_REVIEW' &&
      !d.quoteApprovedByCmLeader &&
      (d.estimatedEffortDays != null || d.estimatedCost != null),
  ).length;

  const awaitingCustomer = byStatus['QUOTED'] ?? 0;
  const inChange = byStatus['IN_CHANGE'] ?? 0;
  const fulfilled = byStatus['FULFILLED'] ?? 0;

  // Average cycle days for CLOSED demands (createdAt → closedAt).
  const closed = demands.filter((d) => d.status === 'CLOSED' && d.closedAt);
  let avgCycleDays: number | null = null;
  if (closed.length > 0) {
    let totalDays = 0;
    for (const d of closed) {
      const created = d.createdAt.getTime();
      const closedMs = d.closedAt ? d.closedAt.getTime() : created;
      totalDays += Math.max(0, (closedMs - created) / DAY_MS);
    }
    avgCycleDays = Math.round((totalDays / closed.length) * 10) / 10;
  }

  return {
    byStatus,
    pipeline,
    pendingApprovals,
    awaitingCustomer,
    inChange,
    fulfilled,
    avgCycleDays,
  };
}

/* -------------------------------------------------------------------------- */
/*  SLA stats                                                                 */
/* -------------------------------------------------------------------------- */

export async function computeSla(scope: StatsScope): Promise<SlaStats> {
  // SlaClock scoping follows ticket visibility — use the ticket where clause
  // to filter clock.ticket.
  const tWhere = ticketWhere(scope);

  // Pull all scoped clocks with ticket + service context (single query).
  const clocks = await db.slaClock.findMany({
    where: { ticket: tWhere },
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      metAt: true,
      ticket: {
        select: {
          id: true,
          serviceId: true,
          service: { select: { id: true, name: true, slaClass: true } },
        },
      },
    },
  });

  // Aggregate compliance across all clocks.
  const met = clocks.filter((c) => c.status === 'MET').length;
  const breached = clocks.filter((c) => c.status === 'BREACHED').length;
  const compliancePct =
    met + breached > 0 ? Math.round((met / (met + breached)) * 1000) / 10 : null;

  // Active breaches = currently BREACHED clocks (no resolution).
  const activeBreaches = breached;

  // Active warnings = unresolved SlaEvent WARNING entries (scoped).
  const activeWarningEvents = await db.slaEvent.findMany({
    where: { ...slaEventWhere(scope), eventType: 'WARNING', resolvedAt: null },
    select: { id: true, serviceId: true },
  });
  const activeWarnings = activeWarningEvents.length;

  // Avg response / resolution mins (from MET clocks only).
  let totalResponseMs = 0;
  let responseCount = 0;
  let totalResolutionMs = 0;
  let resolutionCount = 0;
  for (const c of clocks) {
    if (!c.metAt) continue;
    const dur = Math.max(0, c.metAt.getTime() - c.startedAt.getTime());
    if (c.type === 'RESPONSE') {
      totalResponseMs += dur;
      responseCount += 1;
    } else if (c.type === 'RESOLUTION') {
      totalResolutionMs += dur;
      resolutionCount += 1;
    }
  }
  const avgResponseMins = avgMinsFromMs(totalResponseMs, responseCount);
  const avgResolutionMins = avgMinsFromMs(totalResolutionMs, resolutionCount);

  // Per-service breakdown — group clocks by serviceId.
  const serviceMap = new Map<
    string,
    {
      serviceId: string;
      serviceName: string;
      slaClass: string;
      met: number;
      breached: number;
    }
  >();

  for (const c of clocks) {
    const svc = c.ticket?.service;
    if (!svc) continue;
    const cur =
      serviceMap.get(svc.id) ??
      {
        serviceId: svc.id,
        serviceName: svc.name,
        slaClass: svc.slaClass,
        met: 0,
        breached: 0,
      };
    if (c.status === 'MET') cur.met += 1;
    else if (c.status === 'BREACHED') cur.breached += 1;
    serviceMap.set(svc.id, cur);
  }

  // Active breach/warning event counts per service — join to enrich.
  const allActiveEvents = await db.slaEvent.findMany({
    where: { ...slaEventWhere(scope), resolvedAt: null },
    select: { serviceId: true, eventType: true },
  });
  const warningByService = new Map<string, number>();
  const breachByService = new Map<string, number>();
  for (const e of allActiveEvents) {
    if (e.eventType === 'WARNING') {
      warningByService.set(e.serviceId, (warningByService.get(e.serviceId) ?? 0) + 1);
    } else if (e.eventType === 'BREACHED') {
      breachByService.set(e.serviceId, (breachByService.get(e.serviceId) ?? 0) + 1);
    }
  }

  const byService: SlaByServiceEntry[] = Array.from(serviceMap.values())
    .map((s) => {
      const denom = s.met + s.breached;
      const compliancePct =
        denom > 0 ? Math.round((s.met / denom) * 1000) / 10 : null;
      return {
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        slaClass: s.slaClass,
        compliancePct,
        breaches: breachByService.get(s.serviceId) ?? 0,
        warnings: warningByService.get(s.serviceId) ?? 0,
      };
    })
    .sort((a, b) => {
      // Worst compliance first; null compliance (no clocks) sorts last.
      const aRank = a.compliancePct == null ? 999 : a.compliancePct;
      const bRank = b.compliancePct == null ? 999 : b.compliancePct;
      if (aRank !== bRank) return aRank - bRank;
      return b.breaches - a.breaches;
    })
    .slice(0, 12);

  return {
    compliancePct,
    activeBreaches,
    activeWarnings,
    byService,
    avgResponseMins,
    avgResolutionMins,
  };
}

/* -------------------------------------------------------------------------- */
/*  Workload stats (CM_LEADER primarily)                                      */
/* -------------------------------------------------------------------------- */

export async function computeWorkload(scope: StatsScope): Promise<WorkloadStats> {
  // Workload is a CM Leader / oversight view — return zeros for other roles
  // (they don't have tenant-wide visibility).
  if (!scope.isAllTenant) {
    return { byWorker: [], byGroup: [], unassignedCount: 0, overdueCount: 0 };
  }

  // All SCM workers.
  const workers = await db.user.findMany({
    where: { role: 'SCM_WORKER' },
    select: { id: true, name: true, avatarColor: true },
  });

  // Open tickets per worker (assignedUserId + open status).
  const openTicketRows = await db.ticket.findMany({
    where: { status: { in: OPEN_TICKET_STATUSES } },
    select: { id: true, assignedUserId: true, priority: true },
  });

  // Active demands per worker.
  const activeDemandRows = await db.demand.findMany({
    where: {
      assignedScmWorkerId: { not: null },
      status: { in: ACTIVE_DEMAND_STATUSES as string[] },
    },
    select: { id: true, assignedScmWorkerId: true },
  });

  // Breached SLA clocks → set of ticketIds currently breached.
  const breachedClocks = await db.slaClock.findMany({
    where: { status: 'BREACHED' },
    select: { ticketId: true },
  });
  const breachedTicketIds = new Set(breachedClocks.map((c) => c.ticketId));

  // Per-worker aggregation.
  const byWorker: WorkloadByWorkerEntry[] = workers.map((w) => {
    const myOpenTickets = openTicketRows.filter((t) => t.assignedUserId === w.id);
    const myActiveDemands = activeDemandRows.filter(
      (d) => d.assignedScmWorkerId === w.id,
    );
    const openP1 = myOpenTickets.filter((t) => t.priority === 'P1').length;
    // slaRisk = count of my open tickets that have at least one BREACHED clock.
    const slaRisk = myOpenTickets.filter((t) => breachedTicketIds.has(t.id)).length;
    return {
      workerId: w.id,
      workerName: w.name,
      avatarColor: w.avatarColor,
      activeTickets: myOpenTickets.length,
      activeDemands: myActiveDemands.length,
      slaRisk,
      openP1,
    };
  });

  // Sort: most SLA risk first, then most active tickets.
  byWorker.sort(
    (a, b) =>
      b.slaRisk - a.slaRisk ||
      b.activeTickets - a.activeTickets ||
      b.activeDemands - a.activeDemands,
  );

  // Assignment groups with active ticket counts.
  const groups = await db.assignmentGroup.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  const groupRows = await db.ticket.findMany({
    where: {
      status: { in: OPEN_TICKET_STATUSES },
      assignmentGroupId: { not: null },
    },
    select: { assignmentGroupId: true },
  });
  const byGroup: WorkloadByGroupEntry[] = groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    activeTickets: groupRows.filter((t) => t.assignmentGroupId === g.id).length,
  }));
  byGroup.sort((a, b) => b.activeTickets - a.activeTickets);

  const unassignedCount = openTicketRows.filter(
    (t) => t.assignedUserId === null,
  ).length;

  const overdueCount = breachedTicketIds.size;

  return { byWorker, byGroup, unassignedCount, overdueCount };
}

/* -------------------------------------------------------------------------- */
/*  Customer health (CM_LEADER, SERVICE_OWNER)                                */
/* -------------------------------------------------------------------------- */

export async function computeCustomerHealth(
  scope: StatsScope,
): Promise<CustomerHealthStats> {
  // Resolve the customer orgNode set in scope for this caller.
  let customerOrgIds: string[] = [];
  if (scope.isAllTenant) {
    const all = await db.orgNode.findMany({
      where: { type: 'CUSTOMER_ORG' },
      select: { id: true },
    });
    customerOrgIds = all.map((o) => o.id);
  } else if (scope.role === 'SERVICE_CUSTOMER') {
    customerOrgIds = scope.customerOrgId ? [scope.customerOrgId] : [];
  } else if (scope.role === 'SCM_WORKER') {
    customerOrgIds = scope.scmCustomerOrgIds;
  } else if (scope.role === 'SERVICE_OWNER') {
    // SERVICE_OWNER sees only customers that consume their services — i.e.
    // customers that have a ticket on one of their owned services OR a demand
    // touching one of their owned services.
    const [tickets, demands] = await Promise.all([
      db.ticket.findMany({
        where: { serviceId: { in: scope.ownedServiceIds } },
        select: { serviceCustomerId: true },
        distinct: ['serviceCustomerId'],
      }),
      db.demand.findMany({
        select: { serviceCustomerId: true, relatedServiceIds: true },
      }),
    ]);
    const set = new Set<string>();
    for (const t of tickets) set.add(t.serviceCustomerId);
    const owned = new Set(scope.ownedServiceIds);
    for (const d of demands) {
      const ids = parseServiceIds(d.relatedServiceIds);
      if (ids.some((id) => owned.has(id))) set.add(d.serviceCustomerId);
    }
    customerOrgIds = Array.from(set);
  }

  if (customerOrgIds.length === 0) return { byCustomer: [] };

  const orgs = await db.orgNode.findMany({
    where: { id: { in: customerOrgIds } },
    select: { id: true, name: true },
  });

  // Open tickets per customer.
  const ticketRows = await db.ticket.findMany({
    where: {
      serviceCustomerId: { in: customerOrgIds },
      status: { in: OPEN_TICKET_STATUSES },
    },
    select: { id: true, serviceCustomerId: true },
  });
  const openTicketsByCust = new Map<string, number>();
  for (const t of ticketRows) {
    openTicketsByCust.set(
      t.serviceCustomerId,
      (openTicketsByCust.get(t.serviceCustomerId) ?? 0) + 1,
    );
  }

  // Active demands per customer.
  const demandRows = await db.demand.findMany({
    where: {
      serviceCustomerId: { in: customerOrgIds },
      status: { in: ACTIVE_DEMAND_STATUSES as string[] },
    },
    select: { id: true, serviceCustomerId: true },
  });
  const activeDemandsByCust = new Map<string, number>();
  for (const d of demandRows) {
    activeDemandsByCust.set(
      d.serviceCustomerId,
      (activeDemandsByCust.get(d.serviceCustomerId) ?? 0) + 1,
    );
  }

  // SLA breaches per customer — count tickets with a BREACHED clock, scoped
  // to the customer's org.
  const breachRows = await db.slaClock.findMany({
    where: {
      status: 'BREACHED',
      ticket: { serviceCustomerId: { in: customerOrgIds } },
    },
    select: { ticket: { select: { serviceCustomerId: true } } },
  });
  const breachesByCust = new Map<string, number>();
  for (const c of breachRows) {
    const cid = c.ticket.serviceCustomerId;
    breachesByCust.set(cid, (breachesByCust.get(cid) ?? 0) + 1);
  }

  // CSAT per customer — average across all SatisfactionSurvey entries
  // authored by users belonging to the customer's org.
  const surveysWithOrg = await db.satisfactionSurvey.findMany({
    where: { customer: { orgNodeId: { in: customerOrgIds } } },
    select: { rating: true, customer: { select: { orgNodeId: true } } },
  });
  const csatByCust = new Map<string, { sum: number; count: number }>();
  for (const s of surveysWithOrg) {
    const oid = s.customer.orgNodeId;
    if (!oid) continue;
    const cur = csatByCust.get(oid) ?? { sum: 0, count: 0 };
    cur.sum += s.rating;
    cur.count += 1;
    csatByCust.set(oid, cur);
  }

  // Compute health score per customer.
  // Formula:
  //   slaScore      = 100 - min(100, breaches * 10)        // 0..100 (each breach -10)
  //   csatScore     = (avgCsat == null) ? 75 : avgCsat/5*100  // 0..100 (null → neutral 75)
  //   healthScore   = round(slaScore * 0.6 + csatScore * 0.4)
  //   Green >=80, Amber 60-80, Red <60.
  const byCustomer: CustomerHealthEntry[] = orgs.map((o) => {
    const openTickets = openTicketsByCust.get(o.id) ?? 0;
    const activeDemands = activeDemandsByCust.get(o.id) ?? 0;
    const slaBreaches = breachesByCust.get(o.id) ?? 0;
    const csatAgg = csatByCust.get(o.id);
    const avgCsat =
      csatAgg && csatAgg.count > 0
        ? Math.round((csatAgg.sum / csatAgg.count) * 10) / 10
        : null;

    const slaScore = Math.max(0, 100 - slaBreaches * 10);
    const csatScore = avgCsat == null ? 75 : (avgCsat / 5) * 100;
    const healthScore = Math.round(slaScore * 0.6 + csatScore * 0.4);
    const health: 'green' | 'amber' | 'red' =
      healthScore >= 80 ? 'green' : healthScore >= 60 ? 'amber' : 'red';

    return {
      orgNodeId: o.id,
      orgNodeName: o.name,
      openTickets,
      activeDemands,
      slaBreaches,
      avgCsat,
      healthScore,
      health,
    };
  });

  byCustomer.sort(
    (a, b) => a.healthScore - b.healthScore || b.slaBreaches - a.slaBreaches,
  );

  return { byCustomer };
}

/* -------------------------------------------------------------------------- */
/*  Overview (blended snapshot)                                               */
/* -------------------------------------------------------------------------- */

export async function computeOverview(scope: StatsScope): Promise<OverviewStats> {
  const tWhere = ticketWhere(scope);

  // Open tickets count for this scope.
  const totalOpenTickets = await db.ticket.count({
    where: { ...tWhere, status: { in: OPEN_TICKET_STATUSES } },
  });

  // Active demands count for this scope.
  const baseDemandWhere = demandWhere(scope);
  let demands = await db.demand.findMany({
    where: baseDemandWhere,
    select: { status: true, relatedServiceIds: true },
  });
  if (scope.role === 'SERVICE_OWNER') {
    const owned = new Set(scope.ownedServiceIds);
    demands = demands.filter((d) => {
      const ids = parseServiceIds(d.relatedServiceIds);
      return ids.some((id) => owned.has(id));
    });
  }
  const totalActiveDemands = demands.filter((d) =>
    (ACTIVE_DEMAND_STATUSES as string[]).includes(d.status),
  ).length;

  // SLA — active warnings + breaches via SlaEvent scoped to the caller.
  const slaWhere = slaEventWhere(scope);
  const [warningRows, breachRows] = await Promise.all([
    db.slaEvent.findMany({
      where: { ...slaWhere, eventType: 'WARNING', resolvedAt: null },
      select: { id: true },
    }),
    db.slaEvent.findMany({
      where: { ...slaWhere, eventType: 'BREACHED', resolvedAt: null },
      select: { id: true },
    }),
  ]);
  const slaWarnings = warningRows.length;
  const slaBreaches = breachRows.length;

  // CSAT — average across surveys authored by users belonging to scoped
  // customer orgs (or all tenant surveys for CM_LEADER).
  let avgCsat: number | null = null;
  if (scope.isAllTenant) {
    const agg = await db.satisfactionSurvey.aggregate({
      _avg: { rating: true },
      _count: { _all: true },
    });
    if (agg._count._all > 0 && agg._avg.rating != null) {
      avgCsat = Math.round(agg._avg.rating * 10) / 10;
    }
  } else {
    // Resolve the customer org set in scope for the caller.
    let orgIds: string[] = [];
    if (scope.role === 'SERVICE_CUSTOMER') {
      orgIds = scope.customerOrgId ? [scope.customerOrgId] : [];
    } else if (scope.role === 'SCM_WORKER') {
      orgIds = scope.scmCustomerOrgIds;
    } else if (scope.role === 'SERVICE_OWNER') {
      // customers consuming owned services (tickets + demands)
      const [tickets, allDemands] = await Promise.all([
        db.ticket.findMany({
          where: { serviceId: { in: scope.ownedServiceIds } },
          select: { serviceCustomerId: true },
          distinct: ['serviceCustomerId'],
        }),
        db.demand.findMany({
          select: { serviceCustomerId: true, relatedServiceIds: true },
        }),
      ]);
      const set = new Set<string>();
      for (const t of tickets) set.add(t.serviceCustomerId);
      const owned = new Set(scope.ownedServiceIds);
      for (const d of allDemands) {
        const ids = parseServiceIds(d.relatedServiceIds);
        if (ids.some((id) => owned.has(id))) set.add(d.serviceCustomerId);
      }
      orgIds = Array.from(set);
    }

    if (orgIds.length > 0) {
      const rows = await db.satisfactionSurvey.findMany({
        where: { customer: { orgNodeId: { in: orgIds } } },
        select: { rating: true },
      });
      if (rows.length > 0) {
        const sum = rows.reduce((acc, r) => acc + r.rating, 0);
        avgCsat = Math.round((sum / rows.length) * 10) / 10;
      }
    }
  }

  // Reopen rate — reopened tickets / total closed tickets.
  let reopenRate: number | null = null;
  const closedTickets = await db.ticket.count({
    where: { ...tWhere, status: { in: ['RESOLVED', 'CLOSED'] } },
  });
  if (closedTickets > 0) {
    const reopenedTickets = await db.ticket.count({
      where: {
        ...tWhere,
        events: { some: { eventType: 'REOPENED' } },
      },
    });
    reopenRate = Math.round((reopenedTickets / closedTickets) * 1000) / 10;
  }

  // Workload by worker — top 5 (only meaningful for CM_LEADER; others get []).
  const workload =
    scope.isAllTenant ? await computeWorkload(scope) : { byWorker: [] as WorkloadByWorkerEntry[] };
  const workloadByWorker = workload.byWorker.slice(0, 5);

  return {
    totalOpenTickets,
    totalActiveDemands,
    slaBreaches,
    slaWarnings,
    avgCsat,
    reopenRate,
    workloadByWorker,
  };
}

/* -------------------------------------------------------------------------- */
/*  Re-export scope resolver so route handlers don't need to import _scope    */
/* -------------------------------------------------------------------------- */

export { resolveStatsScope, type StatsScope };
