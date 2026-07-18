import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DemandStatus, SlaHealth } from '@/lib/types';

export const runtime = 'nodejs';

const PIPELINE: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
  'FULFILLED',
];

const ACTIVE_DEMAND_STATUSES: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
];

interface PipelineEntry {
  status: DemandStatus;
  count: number;
}

interface SlaByServiceEntry {
  serviceId: string;
  serviceName: string;
  slaClass: string;
  health: SlaHealth;
  events: number;
}

interface WorkloadByWorkerEntry {
  workerId: string;
  workerName: string;
  activeDemands: number;
  slaRisk: number;
}

interface RecentActivityEntry {
  id: string;
  demandId: string;
  demandTitle: string;
  eventType: string;
  actorName: string;
  createdAt: string;
}

interface DashboardStatsResponse {
  totalDemands: number;
  byStatus: Record<string, number>;
  slaWarnings: number;
  slaBreaches: number;
  pendingApprovals: number;
  openChanges: number;
  pipeline: PipelineEntry[];
  slaByService: SlaByServiceEntry[];
  workloadByWorker: WorkloadByWorkerEntry[];
  recentActivity: RecentActivityEntry[];
}

function emptyStats(): DashboardStatsResponse {
  return {
    totalDemands: 0,
    byStatus: {},
    slaWarnings: 0,
    slaBreaches: 0,
    pendingApprovals: 0,
    openChanges: 0,
    pipeline: PIPELINE.map((status) => ({ status, count: 0 })),
    slaByService: [],
    workloadByWorker: [],
    recentActivity: [],
  };
}

// Safely parse the JSON-encoded service id arrays stored on Demand/Change rows.
function parseServiceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/stats
 *
 * Role-scoped dashboard statistics.
 *
 * Scoping:
 *   - SERVICE_CUSTOMER → their orgNode demands/events/SLA
 *   - SCM_WORKER       → their assigned demands + unassigned demands (all-tenant SLA)
 *   - CM_LEADER        → all tenant data (plus workloadByWorker for SCM workers)
 *   - SERVICE_OWNER    → services they own (with their demands/events/SLA)
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // -------- Scope resolution --------
  // Determine the set of in-scope demand IDs (null = all demands in tenant).
  let scopedDemandIds: string[] | null = null;
  let ownedServiceIds: string[] | null = null;
  let customerOrgId: string | null = null;

  if (session.role === 'SERVICE_CUSTOMER') {
    if (!session.orgNodeId) return NextResponse.json(emptyStats());
    customerOrgId = session.orgNodeId;
  } else if (session.role === 'SERVICE_OWNER') {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    ownedServiceIds = owned.map((s) => s.id);
    if (ownedServiceIds.length === 0) return NextResponse.json(emptyStats());
  }
  // SCM_WORKER and CM_LEADER fall through with null scope (all-tenant).

  // -------- Fetch in-scope demands (slim projection) --------
  let demands: {
    id: string;
    status: string;
    assignedScmWorkerId: string | null;
    relatedServiceIds: string;
  }[] = [];

  if (session.role === 'SERVICE_CUSTOMER') {
    demands = await db.demand.findMany({
      where: { serviceCustomerId: customerOrgId! },
      select: {
        id: true,
        status: true,
        assignedScmWorkerId: true,
        relatedServiceIds: true,
      },
    });
  } else if (session.role === 'SCM_WORKER') {
    demands = await db.demand.findMany({
      where: {
        OR: [
          { assignedScmWorkerId: session.id },
          { assignedScmWorkerId: null },
        ],
      },
      select: {
        id: true,
        status: true,
        assignedScmWorkerId: true,
        relatedServiceIds: true,
      },
    });
  } else if (session.role === 'SERVICE_OWNER') {
    // Fetch all demands and filter to those touching owned services.
    const all = await db.demand.findMany({
      select: {
        id: true,
        status: true,
        assignedScmWorkerId: true,
        relatedServiceIds: true,
      },
    });
    const owned = new Set(ownedServiceIds!);
    demands = all.filter((d) => {
      const ids = parseServiceIds(d.relatedServiceIds);
      return ids.some((id) => owned.has(id));
    });
  } else {
    // CM_LEADER: all tenant demands.
    demands = await db.demand.findMany({
      select: {
        id: true,
        status: true,
        assignedScmWorkerId: true,
        relatedServiceIds: true,
      },
    });
  }

  scopedDemandIds = demands.map((d) => d.id);

  // -------- Demand status aggregates --------
  const byStatus: Record<string, number> = {};
  for (const d of demands) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  }
  const totalDemands = demands.length;
  const pipeline: PipelineEntry[] = PIPELINE.map((status) => ({
    status,
    count: byStatus[status] ?? 0,
  }));

  // -------- Pending approvals (role-specific) --------
  let pendingApprovals = 0;
  if (session.role === 'SERVICE_CUSTOMER') {
    pendingApprovals = byStatus['QUOTED'] ?? 0;
  } else if (session.role === 'CM_LEADER') {
    // APPROXIMATION: UNDER_REVIEW demands awaiting CM Leader gate.
    pendingApprovals = byStatus['UNDER_REVIEW'] ?? 0;
  } else if (session.role === 'SERVICE_OWNER') {
    pendingApprovals = byStatus['ACCEPTED'] ?? 0;
  }
  // SCM_WORKER: no explicit pending-approval semantics — left at 0.

  // -------- Open changes --------
  let openChanges = 0;
  if (session.role === 'SERVICE_OWNER') {
    // Changes touching any owned service (affectedServiceIds is a JSON string array).
    const candidates = await db.change.findMany({
      where: { status: { notIn: ['CLOSED', 'REJECTED'] } },
      select: { affectedServiceIds: true },
    });
    const owned = new Set(ownedServiceIds!);
    openChanges = candidates.filter((c) => {
      const ids = parseServiceIds(c.affectedServiceIds);
      return ids.some((id) => owned.has(id));
    }).length;
  } else if (scopedDemandIds.length > 0) {
    // SERVICE_CUSTOMER / SCM_WORKER / CM_LEADER: open changes whose origin demand is in scope.
    openChanges = await db.change.count({
      where: {
        originDemandId: { in: scopedDemandIds },
        status: { notIn: ['CLOSED', 'REJECTED'] },
      },
    });
  }

  // -------- Active SLA events (warnings / breaches) --------
  let slaWhere: Record<string, unknown> = { resolvedAt: null };
  if (session.role === 'SERVICE_CUSTOMER') {
    slaWhere = { resolvedAt: null, serviceCustomerId: customerOrgId };
  } else if (session.role === 'SERVICE_OWNER') {
    slaWhere = {
      resolvedAt: null,
      serviceId: { in: ownedServiceIds! },
    };
  }
  const activeSlaEvents = await db.slaEvent.findMany({
    where: slaWhere,
    select: { serviceId: true, eventType: true },
  });
  const slaWarnings = activeSlaEvents.filter((e) => e.eventType === 'WARNING').length;
  const slaBreaches = activeSlaEvents.filter((e) => e.eventType === 'BREACHED').length;

  // -------- SLA by service --------
  // Show services in scope that have any SLA events (resolved or active),
  // with current health derived from active events.
  let slaServices: {
    id: string;
    name: string;
    slaClass: string;
    slaEvents: { eventType: string; resolvedAt: Date | null }[];
  }[] = [];

  if (session.role === 'SERVICE_CUSTOMER') {
    slaServices = await db.service.findMany({
      where: { slaEvents: { some: { serviceCustomerId: customerOrgId } } },
      select: {
        id: true,
        name: true,
        slaClass: true,
        slaEvents: {
          where: { serviceCustomerId: customerOrgId },
          select: { eventType: true, resolvedAt: true },
        },
      },
    });
  } else if (session.role === 'SERVICE_OWNER') {
    slaServices = await db.service.findMany({
      where: { id: { in: ownedServiceIds! } },
      select: {
        id: true,
        name: true,
        slaClass: true,
        slaEvents: { select: { eventType: true, resolvedAt: true } },
      },
    });
  } else {
    // SCM_WORKER & CM_LEADER: every service with at least one SLA event.
    slaServices = await db.service.findMany({
      where: { slaEvents: { some: {} } },
      select: {
        id: true,
        name: true,
        slaClass: true,
        slaEvents: { select: { eventType: true, resolvedAt: true } },
      },
    });
  }

  const slaByService: SlaByServiceEntry[] = slaServices
    .map((s) => {
      let health: SlaHealth = 'green';
      let events = 0;
      for (const e of s.slaEvents) {
        if (!e.resolvedAt) {
          events += 1;
          if (e.eventType === 'BREACHED') {
            health = 'red';
          } else if (e.eventType === 'WARNING' && health !== 'red') {
            health = 'amber';
          }
        }
      }
      return {
        serviceId: s.id,
        serviceName: s.name,
        slaClass: s.slaClass,
        health,
        events,
      };
    })
    .sort((a, b) => {
      // Red first, then amber, then green; tie-break by active event count desc.
      const rank = (h: SlaHealth) => (h === 'red' ? 0 : h === 'amber' ? 1 : 2);
      const r = rank(a.health) - rank(b.health);
      if (r !== 0) return r;
      return b.events - a.events;
    })
    .slice(0, 10);

  // -------- Workload by SCM worker (CM_LEADER only) --------
  let workloadByWorker: WorkloadByWorkerEntry[] = [];
  if (session.role === 'CM_LEADER') {
    const workers = await db.user.findMany({
      where: { role: 'SCM_WORKER' },
      select: { id: true, name: true },
    });

    // Active demands per worker (single query, aggregate in code).
    const workerDemands = await db.demand.findMany({
      where: {
        assignedScmWorkerId: { not: null },
        status: { in: ACTIVE_DEMAND_STATUSES as string[] },
      },
      select: {
        id: true,
        assignedScmWorkerId: true,
        relatedServiceIds: true,
      },
    });

    // Active breaches (one query) — used to compute per-worker SLA risk.
    const activeBreaches = await db.slaEvent.findMany({
      where: { eventType: 'BREACHED', resolvedAt: null },
      select: { serviceId: true },
    });
    const breachedServiceIds = new Set(activeBreaches.map((e) => e.serviceId));

    workloadByWorker = workers.map((w) => {
      const mine = workerDemands.filter((d) => d.assignedScmWorkerId === w.id);
      const myServiceIds = new Set<string>();
      for (const d of mine) {
        for (const id of parseServiceIds(d.relatedServiceIds)) {
          myServiceIds.add(id);
        }
      }
      const slaRisk = Array.from(myServiceIds).filter((id) =>
        breachedServiceIds.has(id),
      ).length;
      return {
        workerId: w.id,
        workerName: w.name,
        activeDemands: mine.length,
        slaRisk,
      };
    });
  }

  // -------- Recent activity (last 8 DemandEvent in scope) --------
  let recentActivity: RecentActivityEntry[] = [];
  if (scopedDemandIds.length > 0) {
    const events = await db.demandEvent.findMany({
      where: { demandId: { in: scopedDemandIds } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        demandId: true,
        eventType: true,
        actorName: true,
        createdAt: true,
        demand: { select: { title: true } },
      },
    });
    recentActivity = events.map((e) => ({
      id: e.id,
      demandId: e.demandId,
      demandTitle: e.demand?.title ?? '',
      eventType: e.eventType,
      actorName: e.actorName,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  const result: DashboardStatsResponse = {
    totalDemands,
    byStatus,
    slaWarnings,
    slaBreaches,
    pendingApprovals,
    openChanges,
    pipeline,
    slaByService,
    workloadByWorker,
    recentActivity,
  };

  return NextResponse.json(result);
}
