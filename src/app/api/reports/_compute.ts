// Shared operational-report computation used by both the operational GET
// endpoint and the export GET endpoint. Factored out so the export route
// can render the same data as CSV / JSON without duplicating the scoping
// and aggregation logic.

import { db } from '@/lib/db';
import type { Role, SessionUser } from '@/lib/types';
import { buildEntityQueryScope } from '@/lib/entity-access';

export interface VolumeBucket {
  key: string | null;
  label: string;
  count: number;
}

export interface SlaComplianceEntry {
  serviceId: string;
  serviceName: string | null;
  total: number;
  met: number;
  breached: number;
  compliancePct: number;
}

export interface CsatWeekEntry {
  week: string;
  avgRating: number;
  responses: number;
}

export interface BacklogBucket {
  bucket: string;
  count: number;
}

export interface WorkerWorkloadEntry {
  workerId: string;
  workerName: string;
  activeTickets: number;
  activeDemands: number;
}

export interface OperationalReport {
  range: { from: string | null; to: string | null };
  ticketVolume: {
    byCustomer: VolumeBucket[];
    byService: VolumeBucket[];
    byPriority: VolumeBucket[];
  };
  slaCompliance: SlaComplianceEntry[];
  avgResponseTimeMins: number | null;
  avgResolutionTimeMins: number | null;
  backlogAging: BacklogBucket[];
  reopenRate: {
    reopened: number;
    totalClosed: number;
    ratePct: number;
  };
  csatTrend: CsatWeekEntry[];
  workerWorkload: WorkerWorkloadEntry[];
  demandConversion: {
    total: number;
    reachedInChange: number;
    conversionPct: number;
  };
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

const ACTIVE_TICKET_STATUSES = ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER'];
const CLOSED_TICKET_STATUSES = ['CLOSED', 'RESOLVED', 'CANCELED'];
const BACKLOG_BUCKETS = ['0-1d', '1-3d', '3-7d', '7-14d', '14d+'] as const;

export function parseRange(sp: URLSearchParams): DateRange {
  const from = sp.get('from');
  const to = sp.get('to');
  const range: DateRange = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.from = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) range.to = d;
  }
  return range;
}

function ageBucket(ageDays: number): string {
  if (ageDays < 1) return '0-1d';
  if (ageDays < 3) return '1-3d';
  if (ageDays < 7) return '3-7d';
  if (ageDays < 14) return '7-14d';
  return '14d+';
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function buildOrgMap(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return {};
  const rows = await db.orgNode.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const m: Record<string, string> = {};
  for (const r of rows) m[r.id] = r.name;
  return m;
}

async function buildServiceMap(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return {};
  const rows = await db.service.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const m: Record<string, string> = {};
  for (const r of rows) m[r.id] = r.name;
  return m;
}

interface ReportScope {
  ticketWhere: Record<string, unknown>;
  demandWhere: Record<string, unknown>;
  clockTicketWhere: Record<string, unknown>;
  workloadScope: 'all' | 'self';
  surveyTicketWhere: Record<string, unknown> | null;
}

async function buildScope(session: SessionUser): Promise<ReportScope | null> {
  const role = session.role as Role;

  const ticketWhere = await buildEntityQueryScope(session, 'TICKET');
  const demandWhere = await buildEntityQueryScope(session, 'DEMAND');
  const clockTicketWhere = await buildEntityQueryScope(session, 'TICKET');
  const surveyTicketWhere = await buildEntityQueryScope(session, 'TICKET');

  if (ticketWhere.id === '__none__' || demandWhere.id === '__none__') {
    return null;
  }

  const workloadScope = (role === 'CM_LEADER' || role === 'SERVICE_OWNER') ? 'all' : 'self';

  return {
    ticketWhere,
    demandWhere,
    clockTicketWhere,
    workloadScope,
    surveyTicketWhere,
  };
}

export function emptyReport(range: DateRange): OperationalReport {
  return {
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    ticketVolume: { byCustomer: [], byService: [], byPriority: [] },
    slaCompliance: [],
    avgResponseTimeMins: null,
    avgResolutionTimeMins: null,
    backlogAging: BACKLOG_BUCKETS.map((b) => ({ bucket: b, count: 0 })),
    reopenRate: { reopened: 0, totalClosed: 0, ratePct: 0 },
    csatTrend: [],
    workerWorkload: [],
    demandConversion: { total: 0, reachedInChange: 0, conversionPct: 0 },
  };
}

/** Compute the full operational report for the given session + date range. */
export async function computeOperationalReport(
  session: SessionUser,
  range: DateRange,
): Promise<OperationalReport> {
  const scope = await buildScope(session);
  if (scope === null) return emptyReport(range);

  const rangeFrom = range.from;
  const rangeTo = range.to;

  const createdAtRange: Record<string, unknown> = {};
  if (rangeFrom) createdAtRange.gte = rangeFrom;
  if (rangeTo) createdAtRange.lte = rangeTo;

  // ----------------------------------------------------------------------
  // 1. ticketVolume — by customer / service / priority
  // ----------------------------------------------------------------------
  const ticketWhere: Record<string, unknown> = { ...scope.ticketWhere };
  if (rangeFrom || rangeTo) ticketWhere.createdAt = createdAtRange;

  const [byCustomer, byService, byPriority] = await Promise.all([
    db.ticket.groupBy({
      by: ['serviceCustomerId'],
      _count: { _all: true },
      where: ticketWhere,
    }),
    db.ticket.groupBy({
      by: ['serviceId'],
      _count: { _all: true },
      where: ticketWhere,
    }),
    db.ticket.groupBy({
      by: ['priority'],
      _count: { _all: true },
      where: ticketWhere,
    }),
  ]);

  const customerIds = byCustomer.map((r) => r.serviceCustomerId);
  const serviceIdsFromTickets = byService
    .map((r) => r.serviceId)
    .filter((x): x is string => Boolean(x));
  const [orgMap, svcMap] = await Promise.all([
    buildOrgMap(customerIds),
    buildServiceMap(serviceIdsFromTickets),
  ]);

  const ticketVolume = {
    byCustomer: byCustomer
      .map((r) => ({
        key: r.serviceCustomerId,
        label: orgMap[r.serviceCustomerId] ?? 'Unknown customer',
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    byService: byService
      .map((r) => ({
        key: r.serviceId,
        label: (r.serviceId && svcMap[r.serviceId]) || 'Unassigned',
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    byPriority: byPriority
      .map((r) => ({
        key: r.priority,
        label: r.priority || 'Unknown',
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
  };

  // ----------------------------------------------------------------------
  // 2. slaCompliance — MET / (MET + BREACHED) per service
  // ----------------------------------------------------------------------
  const clocksForCompliance = await db.slaClock.findMany({
    where: {
      status: { in: ['MET', 'BREACHED'] },
      ticket: scope.clockTicketWhere,
      ...(rangeFrom || rangeTo ? { startedAt: createdAtRange } : {}),
    },
    select: {
      status: true,
      ticket: { select: { serviceId: true } },
    },
  });

  const complianceByService = new Map<
    string,
    { total: number; met: number; breached: number }
  >();
  for (const c of clocksForCompliance) {
    const svcId = c.ticket.serviceId;
    if (!svcId) continue;
    const entry = complianceByService.get(svcId) ?? { total: 0, met: 0, breached: 0 };
    entry.total += 1;
    if (c.status === 'MET') entry.met += 1;
    else if (c.status === 'BREACHED') entry.breached += 1;
    complianceByService.set(svcId, entry);
  }
  const complianceServiceIds = Array.from(complianceByService.keys());
  const complianceSvcMap = await buildServiceMap(complianceServiceIds);

  const slaCompliance: SlaComplianceEntry[] = complianceServiceIds
    .map((serviceId) => {
      const e = complianceByService.get(serviceId)!;
      return {
        serviceId,
        serviceName: complianceSvcMap[serviceId] ?? null,
        total: e.total,
        met: e.met,
        breached: e.breached,
        compliancePct: e.total === 0 ? 0 : round2((e.met / e.total) * 100),
      };
    })
    .sort((a, b) => a.compliancePct - b.compliancePct);

  // ----------------------------------------------------------------------
  // 3 & 4. avgResponseTime / avgResolutionTime
  // ----------------------------------------------------------------------
  const metClocksWhere = {
    status: 'MET',
    metAt: { not: null },
    ticket: scope.clockTicketWhere,
    ...(rangeFrom || rangeTo ? { metAt: createdAtRange } : {}),
  };
  const [metResponseClocks, metResolutionClocks] = await Promise.all([
    db.slaClock.findMany({
      where: { ...metClocksWhere, type: 'RESPONSE' },
      select: { startedAt: true, metAt: true },
    }),
    db.slaClock.findMany({
      where: { ...metClocksWhere, type: 'RESOLUTION' },
      select: { startedAt: true, metAt: true },
    }),
  ]);

  function avgMins(rows: { startedAt: Date; metAt: Date | null }[]): number | null {
    const valid = rows.filter((r) => r.metAt);
    if (valid.length === 0) return null;
    const sum = valid.reduce(
      (acc, r) => acc + (r.metAt!.getTime() - r.startedAt.getTime()) / 60000,
      0,
    );
    return round2(sum / valid.length);
  }

  const avgResponseTimeMins = avgMins(metResponseClocks);
  const avgResolutionTimeMins = avgMins(metResolutionClocks);

  // ----------------------------------------------------------------------
  // 5. backlogAging — active tickets grouped by age bucket
  // ----------------------------------------------------------------------
  const backlogWhere: Record<string, unknown> = {
    ...scope.ticketWhere,
    status: { in: ACTIVE_TICKET_STATUSES },
  };
  const backlogTickets = await db.ticket.findMany({
    where: backlogWhere,
    select: { createdAt: true },
  });
  const nowMs = Date.now();
  const bucketCounts: Record<string, number> = {
    '0-1d': 0,
    '1-3d': 0,
    '3-7d': 0,
    '7-14d': 0,
    '14d+': 0,
  };
  for (const t of backlogTickets) {
    const ageDays = (nowMs - t.createdAt.getTime()) / 86400000;
    bucketCounts[ageBucket(ageDays)] += 1;
  }
  const backlogAging: BacklogBucket[] = BACKLOG_BUCKETS.map((b) => ({
    bucket: b,
    count: bucketCounts[b] ?? 0,
  }));

  // ----------------------------------------------------------------------
  // 6. reopenRate — reopened tickets / total closed
  // ----------------------------------------------------------------------
  const scopeTickets = await db.ticket.findMany({
    where: scope.ticketWhere,
    select: { id: true },
  });
  const scopeTicketIds = scopeTickets.map((t) => t.id);

  let reopenedCount = 0;
  let totalClosedCount = 0;
  if (scopeTicketIds.length > 0) {
    const [reopenedEvents, closedTickets] = await Promise.all([
      db.ticketEvent.findMany({
        where: { ticketId: { in: scopeTicketIds }, eventType: 'REOPENED' },
        select: { ticketId: true },
        distinct: ['ticketId'],
      }),
      db.ticket.count({
        where: {
          ...scope.ticketWhere,
          status: { in: CLOSED_TICKET_STATUSES },
        },
      }),
    ]);
    reopenedCount = reopenedEvents.length;
    totalClosedCount = closedTickets;
  }
  const reopenRate = {
    reopened: reopenedCount,
    totalClosed: totalClosedCount,
    ratePct:
      totalClosedCount === 0 ? 0 : round2((reopenedCount / totalClosedCount) * 100),
  };

  // ----------------------------------------------------------------------
  // 7. csatTrend — avg survey rating by ISO week
  // ----------------------------------------------------------------------
  let csatTrend: CsatWeekEntry[] = [];
  if (scope.surveyTicketWhere !== null) {
    const surveyTickets = await db.ticket.findMany({
      where: scope.surveyTicketWhere,
      select: { id: true },
    });
    const ticketIdSet = new Set(surveyTickets.map((t) => t.id));

    const surveyWhere: Record<string, unknown> = { entityType: 'TICKET' };
    if (rangeFrom || rangeTo) surveyWhere.createdAt = createdAtRange;

    const surveys = await db.satisfactionSurvey.findMany({
      where: surveyWhere,
      select: { rating: true, createdAt: true, entityId: true },
    });
    const inScope = surveys.filter((s) => ticketIdSet.has(s.entityId));

    const byWeek = new Map<string, { sum: number; count: number }>();
    for (const s of inScope) {
      const w = isoWeek(s.createdAt);
      const entry = byWeek.get(w) ?? { sum: 0, count: 0 };
      entry.sum += s.rating;
      entry.count += 1;
      byWeek.set(w, entry);
    }
    csatTrend = Array.from(byWeek.entries())
      .map(([week, e]) => ({
        week,
        avgRating: round2(e.sum / e.count),
        responses: e.count,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }

  // ----------------------------------------------------------------------
  // 8. workerWorkload — active ticket counts per SCM worker
  // ----------------------------------------------------------------------
  const workers = await db.user.findMany({
    where: { role: 'SCM_WORKER' as Role },
    select: { id: true, name: true },
  });
  let workerWorkload: WorkerWorkloadEntry[] = [];
  if (workers.length > 0) {
    const workerIds = workers.map((w) => w.id);
    const visibleWorkerIds =
      scope.workloadScope === 'self' ? [session.id] : workerIds;
    const visibleWorkers = workers.filter((w) => visibleWorkerIds.includes(w.id));

    const [activeTicketsByWorker, activeDemandsByWorker] = await Promise.all([
      db.ticket.groupBy({
        by: ['assignedUserId'],
        _count: { _all: true },
        where: {
          assignedUserId: { in: visibleWorkerIds },
          status: { in: ACTIVE_TICKET_STATUSES },
        },
      }),
      db.demand.groupBy({
        by: ['assignedScmWorkerId'],
        _count: { _all: true },
        where: {
          assignedScmWorkerId: { in: visibleWorkerIds },
          status: { in: ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE'] },
        },
      }),
    ]);

    const ticketMap = new Map<string, number>();
    for (const r of activeTicketsByWorker) {
      if (r.assignedUserId) ticketMap.set(r.assignedUserId, r._count._all);
    }
    const demandMap = new Map<string, number>();
    for (const r of activeDemandsByWorker) {
      if (r.assignedScmWorkerId) demandMap.set(r.assignedScmWorkerId, r._count._all);
    }

    workerWorkload = visibleWorkers.map((w) => ({
      workerId: w.id,
      workerName: w.name,
      activeTickets: ticketMap.get(w.id) ?? 0,
      activeDemands: demandMap.get(w.id) ?? 0,
    }));
  }

  // ----------------------------------------------------------------------
  // 9. demandConversion — demands that reached IN_CHANGE / total demands
  // ----------------------------------------------------------------------
  const demandWhere: Record<string, unknown> = { ...scope.demandWhere };
  if (rangeFrom || rangeTo) demandWhere.createdAt = createdAtRange;

  const [totalDemands, demandsReachedInChange] = await Promise.all([
    db.demand.count({ where: demandWhere }),
    db.demand.count({
      where: { ...demandWhere, status: { in: ['IN_CHANGE', 'FULFILLED', 'CLOSED'] } },
    }),
  ]);
  const demandConversion = {
    total: totalDemands,
    reachedInChange: demandsReachedInChange,
    conversionPct:
      totalDemands === 0 ? 0 : round2((demandsReachedInChange / totalDemands) * 100),
  };

  return {
    range: {
      from: rangeFrom ? rangeFrom.toISOString() : null,
      to: rangeTo ? rangeTo.toISOString() : null,
    },
    ticketVolume,
    slaCompliance,
    avgResponseTimeMins,
    avgResolutionTimeMins,
    backlogAging,
    reopenRate,
    csatTrend,
    workerWorkload,
    demandConversion,
  };
}
