import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { DemandStatus, SlaHealth } from '@/lib/types';
import {
  resolveStatsScope,
  computeOverview,
  computeTickets,
  computeDemands,
  computeSla,
  computeWorkload,
} from './_compute';
import { ticketWhere, demandWhere, slaEventWhere, parseServiceIds } from './_scope';

export const runtime = 'nodejs';

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
  avatarColor?: string;
  activeDemands: number;
  activeTickets?: number;
  slaRisk: number;
  openP1?: number;
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
  // New blended overview fields (from /api/stats/overview).
  totalOpenTickets?: number;
  totalActiveDemands?: number;
  avgCsat?: number | null;
  reopenRate?: number | null;
}

function emptyStats(): DashboardStatsResponse {
  return {
    totalDemands: 0,
    byStatus: {},
    slaWarnings: 0,
    slaBreaches: 0,
    pendingApprovals: 0,
    openChanges: 0,
    pipeline: [],
    slaByService: [],
    workloadByWorker: [],
    recentActivity: [],
  };
}

/**
 * GET /api/stats
 *
 * Legacy overview aggregator. Composes the same role-scoped compute logic
 * exposed by the six split endpoints (/api/stats/{overview,tickets,demands,
 * sla,workload,customer-health}) into the original demand-centric dashboard
 * shape so existing dashboards continue to work without modification.
 *
 * New blended overview fields (totalOpenTickets, totalActiveDemands, avgCsat,
 * reopenRate) are included as a superset — clients that ignore them are
 * unaffected.
 *
 * Scoping:
 *   SERVICE_CUSTOMER → their orgNode
 *   SCM_WORKER       → assigned customer orgs
 *   CM_LEADER        → all tenant
 *   SERVICE_OWNER    → services they own
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scope = await resolveStatsScope(session);

  // Run the four primary domain computations in parallel.
  const [overview, ticketStats, demandStats, slaStats] = await Promise.all([
    computeOverview(scope),
    computeTickets(scope),
    computeDemands(scope),
    computeSla(scope),
  ]);

  // workloadByWorker is only meaningful for CM_LEADER; for other roles the
  // compute helper returns empty arrays.
  const workload = scope.isAllTenant ? await computeWorkload(scope) : null;

  // ---- byStatus / totalDemands / pipeline (from demand stats) ----
  const byStatus: Record<string, number> = { ...demandStats.byStatus };
  const totalDemands = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const pipeline: PipelineEntry[] = demandStats.pipeline;

  // ---- pendingApprovals: role-specific ----
  // The shared computeDemands helper already counts UNDER_REVIEW demands with
  // quote fields filled but not yet CM-LEADER-approved — that's the canonical
  // CM_LEADER pending-approvals number. Override per-role:
  //   SERVICE_CUSTOMER → QUOTED count (waiting on customer)
  //   SERVICE_OWNER    → ACCEPTED count (commitment approval)
  //   SCM_WORKER       → 0 (no governance gate)
  let pendingApprovals = demandStats.pendingApprovals;
  if (session.role === 'SERVICE_CUSTOMER') {
    pendingApprovals = byStatus['QUOTED'] ?? 0;
  } else if (session.role === 'SERVICE_OWNER') {
    pendingApprovals = byStatus['ACCEPTED'] ?? 0;
  } else if (session.role === 'SCM_WORKER') {
    pendingApprovals = 0;
  }

  // ---- openChanges (count of in-flight changes for the caller's scope) ----
  let openChanges = 0;
  if (session.role === 'SERVICE_OWNER') {
    const candidates = await db.change.findMany({
      where: { status: { notIn: ['CLOSED', 'REJECTED'] } },
      select: { affectedServiceIds: true },
    });
    const owned = new Set(scope.ownedServiceIds);
    openChanges = candidates.filter((c) => {
      const ids = parseServiceIds(c.affectedServiceIds);
      return ids.some((id) => owned.has(id));
    }).length;
  } else if (scope.isAllTenant) {
    openChanges = await db.change.count({
      where: { status: { notIn: ['CLOSED', 'REJECTED'] } },
    });
  } else {
    // SERVICE_CUSTOMER / SCM_WORKER: open changes whose origin demand is in
    // scope. Compute the in-scope demand ids first.
    const scopeWhere = demandWhere(scope);
    const inScopeDemands = await db.demand.findMany({
      where: scopeWhere,
      select: { id: true, relatedServiceIds: true },
    });
    let scopedDemandIds = inScopeDemands.map((d) => d.id);
    if (scopedDemandIds.length > 0) {
      openChanges = await db.change.count({
        where: {
          originDemandId: { in: scopedDemandIds },
          status: { notIn: ['CLOSED', 'REJECTED'] },
        },
      });
    }
  }

  // ---- slaByService (legacy shape) ----
  // Convert the new SlaStats.byService array into the legacy {health, events}
  // shape. health derives from compliance + active breach/warning counts.
  const slaByService: SlaByServiceEntry[] = slaStats.byService.map((s) => {
    let health: SlaHealth = 'green';
    if (s.breaches > 0) health = 'red';
    else if (s.warnings > 0 || (s.compliancePct != null && s.compliancePct < 90)) {
      health = 'amber';
    }
    return {
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      slaClass: s.slaClass,
      health,
      events: s.breaches + s.warnings,
    };
  });

  // ---- workloadByWorker (legacy shape) ----
  // Map the new WorkloadStats.byWorker shape to the legacy shape (only
  // activeDemands + slaRisk were used by old consumers; activeTickets / openP1
  // are passed through as a superset).
  const workloadByWorker: WorkloadByWorkerEntry[] = (workload?.byWorker ?? []).map(
    (w) => ({
      workerId: w.workerId,
      workerName: w.workerName,
      avatarColor: w.avatarColor,
      activeDemands: w.activeDemands,
      activeTickets: w.activeTickets,
      slaRisk: w.slaRisk,
      openP1: w.openP1,
    }),
  );

  // ---- recentActivity (last 8 DemandEvent in scope) ----
  let recentActivity: RecentActivityEntry[] = [];
  const scopeDemandWhere = demandWhere(scope);
  const inScopeDemands = await db.demand.findMany({
    where: scopeDemandWhere,
    select: { id: true, relatedServiceIds: true },
  });
  let scopedDemandIds = inScopeDemands.map((d) => d.id);
  if (session.role === 'SERVICE_OWNER') {
    const owned = new Set(scope.ownedServiceIds);
    scopedDemandIds = inScopeDemands
      .filter((d) => {
        const ids = parseServiceIds(d.relatedServiceIds);
        return ids.some((id) => owned.has(id));
      })
      .map((d) => d.id);
  }
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

  // Suppress unused-var warnings for helpers reserved for future fine-grained
  // per-role overrides.
  void ticketWhere;
  void slaEventWhere;
  void ACTIVE_DEMAND_STATUSES;
  void ticketStats;
  void overview;
  void emptyStats;

  const result: DashboardStatsResponse = {
    totalDemands,
    byStatus,
    slaWarnings: overview.slaWarnings,
    slaBreaches: overview.slaBreaches,
    pendingApprovals,
    openChanges,
    pipeline,
    slaByService,
    workloadByWorker,
    recentActivity,
    // Blended overview fields (superset; ignored by legacy consumers).
    totalOpenTickets: overview.totalOpenTickets,
    totalActiveDemands: overview.totalActiveDemands,
    avgCsat: overview.avgCsat,
    reopenRate: overview.reopenRate,
  };

  return NextResponse.json(result);
}
