'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  StatCard,
  SectionCard,
  EmptyState,
  LoadingState,
  DemandStatusBadge,
  ChangeStatusBadge,
  SlaHealthBadge,
  UserAvatar,
  RelativeTime,
  Money,
  Days,
  Button,
  Badge,
} from '@/components/shared';
import { WorkloadBars } from '@/components/widgets';
import {
  AlertTriangle,
  ClipboardCheck,
  Clock,
  FileText,
  GitBranch,
  Inbox,
  ShieldCheck,
  UserPlus,
  ArrowRight,
  CheckCircle2,
  AlertOctagon,
  Activity,
  Hourglass,
  Star,
  Scale,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Demand, Change, SlaEvent, Service } from '@/lib/types';
import type { Ticket } from '@/lib/tickets';
import type { SatisfactionSurvey } from '@/app/api/surveys/_serialize';

/* ----------------------------- Stats response types ----------------------------- */

interface OverviewResponse {
  totalOpenTickets: number;
  totalActiveDemands: number;
  slaBreaches: number;
  slaWarnings: number;
  avgCsat: number | null;
  reopenRate: number | null;
  workloadByWorker: {
    workerId: string;
    workerName: string;
    avatarColor?: string;
    activeTickets: number;
    activeDemands: number;
    slaRisk: number;
    openP1: number;
  }[];
}

interface TicketsStatsResponse {
  byStatus: Record<string, number>;
  unassigned: number;
  waitingCustomer: number;
  reopened: number;
  slaBreached: number;
  aging: {
    '0-1d': number;
    '1-3d': number;
    '3-7d': number;
    '7-14d': number;
    '14d+': number;
  };
}

interface DemandsStatsResponse {
  byStatus: Record<string, number>;
  pendingApprovals: number;
  awaitingCustomer: number;
  inChange: number;
}

interface WorkloadStatsResponse {
  byWorker: {
    workerId: string;
    workerName: string;
    avatarColor: string;
    activeTickets: number;
    activeDemands: number;
    slaRisk: number;
    openP1: number;
  }[];
  byGroup: { groupId: string; groupName: string; activeTickets: number }[];
  unassignedCount: number;
  overdueCount: number;
}

interface SlaClockRow {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  ticketStatus: string;
  ticketPriority: string;
  ticketType: string;
  serviceName: string | null;
  serviceCustomerName: string | null;
  type: string;
  status: string;
  startedAt: string;
  dueAt: string;
  remainingMins: number | null;
  percentRemaining: number | null;
}

/* ----------------------------- Shared types ----------------------------- */

interface WorkloadItem {
  workerId: string;
  workerName: string;
  avatarColor?: string;
  activeDemands: number;
  slaRisk?: number;
  riskCount?: number;
  byStatus?: Record<string, number>;
}

export type { WorkloadItem };

interface LeaderStats {
  totalDemands: number;
  byStatus: Record<string, number>;
  slaWarnings: number;
  slaBreaches: number;
  pendingApprovals: number;
  openChanges: number;
  workloadByWorker?: WorkloadItem[];
  slaCompliance?: number;
}

/* ----------------------------- Hooks ----------------------------- */

export function useDemands(extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  const qs = params.toString();
  return useQuery<Demand[]>({
    queryKey: ['cm-leader', 'demands', extra ?? null],
    queryFn: () => apiGet(`/api/demands${qs ? `?${qs}` : ''}`),
  });
}

export function useLeaderStats() {
  return useQuery<LeaderStats>({
    queryKey: ['cm-leader', 'stats'],
    queryFn: () => apiGet('/api/stats'),
  });
}

export function useSlaEvents() {
  return useQuery<SlaEvent[]>({
    queryKey: ['cm-leader', 'sla-events'],
    queryFn: () => apiGet('/api/sla-events'),
  });
}

export function useChanges() {
  return useQuery<Change[]>({
    queryKey: ['cm-leader', 'changes'],
    queryFn: () => apiGet('/api/changes'),
  });
}

export function useServices() {
  return useQuery<Service[]>({
    queryKey: ['cm-leader', 'services'],
    queryFn: () => apiGet('/api/services'),
  });
}

/* ----------------------------- Mutations ----------------------------- */

export function useAssignDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workerId }: { id: string; workerId: string | null }) =>
      apiPatch(`/api/demands/${id}`, { assignedScmWorkerId: workerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cm-leader'] });
      toast.success('Demand assigned');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to assign'),
  });
}

export function useApproveQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/api/demands/${id}/approve-quote`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cm-leader'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Quote approved — issued to customer');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to approve quote'),
  });
}

/* ----------------------------- Helpers ----------------------------- */

const ACTIVE_STATUSES = ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED'];

export function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / 86400000));
}

/* ----------------------------- Dashboard ----------------------------- */

export default function Dashboard() {
  const { navigate } = useApp();
  const demandsQ = useDemands();
  const slaQ = useSlaEvents();
  const changesQ = useChanges();

  // New split-endpoint stats.
  const overviewQ = useQuery<OverviewResponse>({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiGet<OverviewResponse>('/api/stats/overview'),
    staleTime: 30_000,
  });
  const ticketStatsQ = useQuery<TicketsStatsResponse>({
    queryKey: ['stats', 'tickets'],
    queryFn: () => apiGet<TicketsStatsResponse>('/api/stats/tickets'),
    staleTime: 30_000,
  });
  const demandStatsQ = useQuery<DemandsStatsResponse>({
    queryKey: ['stats', 'demands'],
    queryFn: () => apiGet<DemandsStatsResponse>('/api/stats/demands'),
    staleTime: 30_000,
  });
  const workloadQ = useQuery<WorkloadStatsResponse>({
    queryKey: ['stats', 'workload'],
    queryFn: () => apiGet<WorkloadStatsResponse>('/api/stats/workload'),
    staleTime: 30_000,
  });

  // Breach-risk SLA clocks (BREACHED + RUNNING with low percent remaining).
  const breachClocksQ = useQuery<SlaClockRow[]>({
    queryKey: ['sla-clocks', 'cm-leader', 'breach-risk'],
    queryFn: () =>
      apiGet<SlaClockRow[]>('/api/sla-clocks?status=BREACHED,RUNNING&overdue=1'),
    staleTime: 30_000,
  });

  // Aging backlog — open tickets older than 3 days.
  const agingTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'cm-leader', 'aging'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER&sort=age&limit=300',
      ),
    staleTime: 30_000,
  });

  // CSAT follow-ups — surveys with rating <= 3 (detractors).
  const surveysQ = useQuery<SatisfactionSurvey[]>({
    queryKey: ['surveys', 'cm-leader', 'all'],
    queryFn: () => apiGet<SatisfactionSurvey[]>('/api/surveys'),
    staleTime: 60_000,
  });

  const demands = demandsQ.data ?? [];
  const slaEvents = slaQ.data ?? [];
  const changes = changesQ.data ?? [];
  const overview = overviewQ.data;
  const ticketStats = ticketStatsQ.data;
  const demandStats = demandStatsQ.data;
  const workload = workloadQ.data;
  const breachClocks = breachClocksQ.data ?? [];
  const agingTickets = agingTicketsQ.data ?? [];
  const surveys = surveysQ.data ?? [];

  const unassigned = useMemo(
    () => demands.filter((d) => !d.assignedScmWorkerId && d.status === 'NEW'),
    [demands],
  );
  const quoteQueue = useMemo(
    () =>
      demands.filter(
        (d) =>
          d.status === 'UNDER_REVIEW' &&
          d.estimatedEffortDays != null &&
          !d.quoteApprovedByCmLeader,
      ),
    [demands],
  );
  const awaitingCustomer = useMemo(
    () => demands.filter((d) => d.status === 'QUOTED'),
    [demands],
  );
  const inChange = useMemo(
    () => demands.filter((d) => d.status === 'IN_CHANGE'),
    [demands],
  );
  const activeDemands = useMemo(
    () => demands.filter((d) => ACTIVE_STATUSES.includes(d.status)),
    [demands],
  );
  const breaches = slaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt);
  const openChanges = changes.filter((c) => c.status !== 'CLOSED' && c.status !== 'REJECTED');

  // Aging buckets — from the new tickets stats endpoint (covers all scoped
  // tickets, not just the first 300 fetched above).
  const agingBuckets = ticketStats?.aging;
  const agingBacklogTotal = agingBuckets
    ? (agingBuckets['3-7d'] ?? 0) +
      (agingBuckets['7-14d'] ?? 0) +
      (agingBuckets['14d+'] ?? 0)
    : 0;

  // CSAT follow-ups — detractor surveys (rating <= 3).
  const detractorSurveys = useMemo(
    () => surveys.filter((s) => s.rating <= 3).slice(0, 10),
    [surveys],
  );

  // Workload imbalance — workers with slaRisk > 0 OR activeTickets > 8.
  const workloadImbalanceCount = useMemo(() => {
    return (workload?.byWorker ?? []).filter(
      (w) => w.slaRisk > 0 || w.activeTickets > 8,
    ).length;
  }, [workload]);

  const isLoading = demandsQ.isLoading || overviewQ.isLoading;

  // Workload items for the WorkloadBars widget.
  const workloadItems = useMemo(() => {
    return (workload?.byWorker ?? []).map((w) => ({
      name: w.workerName,
      count: w.activeTickets,
      risk: w.slaRisk,
    }));
  }, [workload]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CM Leader — Governance Overview"
        description="Sofia Reyes · Hold governance gates, monitor workload, and steer the customer management practice across the tenant."
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('analytics')}>
            <Activity className="h-4 w-4" /> Analytics
          </Button>
        }
      />

      {/* Operational stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="Breach Risk"
          value={overviewQ.isLoading ? '—' : overview?.slaBreaches ?? breaches.length}
          hint={`${overview?.slaWarnings ?? 0} active warnings`}
          tone="danger"
          icon={<AlertTriangle className="h-4 w-4" />}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="Aging Backlog"
          value={ticketStatsQ.isLoading ? '—' : agingBacklogTotal}
          hint="Open tickets older than 3 days"
          tone={agingBacklogTotal > 0 ? 'warning' : 'success'}
          icon={<Hourglass className="h-4 w-4" />}
          onClick={() => navigate('tickets')}
        />
        <StatCard
          label="Workload Imbalance"
          value={workloadQ.isLoading ? '—' : workloadImbalanceCount}
          hint="Workers with SLA risk or >8 tickets"
          tone={workloadImbalanceCount > 0 ? 'warning' : 'success'}
          icon={<Scale className="h-4 w-4" />}
          onClick={() => navigate('workers')}
        />
        <StatCard
          label="Quote Approvals"
          value={quoteQueue.length}
          hint="Awaiting your governance gate"
          tone="warning"
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <StatCard
          label="CSAT Follow-ups"
          value={detractorSurveys.length}
          hint="Surveys rated ≤ 3 (detractors)"
          tone={detractorSurveys.length > 0 ? 'danger' : 'success'}
          icon={<Star className="h-4 w-4" />}
        />
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: governance queues */}
          <div className="lg:col-span-2 space-y-6">
            <QuoteApprovalQueue
              demands={quoteQueue}
              onReview={(id) => navigate('demand-detail', { id })}
            />

            {/* Breach Risk panel */}
            <SectionCard
              title="Breach Risk"
              description="Tickets with breached or near-breach SLA clocks. Steer remediation before customer escalation."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('sla')} className="gap-1.5 text-xs">
                  Open SLM <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {breachClocksQ.isLoading ? (
                <LoadingState rows={3} />
              ) : breachClocks.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
                  title="No breach risk right now"
                  description="No SLA clocks are breached or overdue."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-96 overflow-y-auto scrollbar-thin">
                  {breachClocks.slice(0, 8).map((c) => {
                    const isBreached = c.status === 'BREACHED';
                    return (
                      <li
                        key={c.id}
                        className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors cursor-pointer"
                        onClick={() => navigate('ticket-detail', { id: c.ticketId })}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">
                                {c.ticketNumber}
                              </span>
                              <PriorityDot priority={c.ticketPriority} />
                              <span className="text-sm font-medium truncate">{c.ticketTitle}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground truncate">
                              {c.serviceCustomerName ?? '—'} · {c.serviceName ?? 'General'} ·{' '}
                              {c.type.toLowerCase()}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              isBreached
                                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 text-[10px] shrink-0'
                                : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px] shrink-0'
                            }
                          >
                            {isBreached ? 'Breached' : 'Overdue'}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            {/* Aging Backlog panel */}
            <SectionCard
              title="Aging Backlog"
              description="Open tickets older than 3 days, grouped by age bucket."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('tickets')}
                  className="gap-1.5 text-xs"
                >
                  Open queue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {agingBuckets ? (
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {(
                    [
                      { key: '0-1d', label: '0-1d', tone: 'emerald' },
                      { key: '1-3d', label: '1-3d', tone: 'teal' },
                      { key: '3-7d', label: '3-7d', tone: 'amber' },
                      { key: '7-14d', label: '7-14d', tone: 'orange' },
                      { key: '14d+', label: '14d+', tone: 'rose' },
                    ] as const
                  ).map((b) => {
                    const count = agingBuckets[b.key as keyof typeof agingBuckets] ?? 0;
                    const cls = {
                      emerald: 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
                      teal: 'border-teal-200 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300',
                      amber: 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
                      orange: 'border-orange-200 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
                      rose: 'border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
                    }[b.tone];
                    return (
                      <div key={b.key} className={`rounded-md border p-2 text-center ${cls}`}>
                        <div className="text-lg font-semibold tabular-nums">{count}</div>
                        <div className="text-[10px] uppercase tracking-wide opacity-80">{b.label}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <LoadingState rows={1} />
              )}

              {/* Oldest tickets beyond the 3-day threshold */}
              {(() => {
                const threeDaysAgo = Date.now() - 3 * 86_400_000;
                const old = agingTickets
                  .filter((t) => new Date(t.createdAt).getTime() < threeDaysAgo)
                  .slice(0, 6);
                if (old.length === 0) {
                  return (
                    <EmptyState
                      icon={<CheckCircle2 className="h-7 w-7 text-emerald-500" />}
                      title="No tickets older than 3 days"
                      description="Backlog is well-managed."
                    />
                  );
                }
                return (
                  <ul className="divide-y -mx-2">
                    {old.map((t) => {
                      const ageDays = Math.floor(
                        (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000,
                      );
                      return (
                        <li
                          key={t.id}
                          className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors cursor-pointer"
                          onClick={() => navigate('ticket-detail', { id: t.id })}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-muted-foreground">
                                  {t.number}
                                </span>
                                <PriorityDot priority={t.priority} />
                                <span className="text-sm font-medium truncate">{t.title}</span>
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                                {t.serviceCustomerName ?? '—'} · {t.serviceName ?? 'General'}
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/50 shrink-0"
                            >
                              {ageDays}d old
                            </Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </SectionCard>

            <AwaitingCustomerPanel
              demands={awaitingCustomer}
              onOpen={(id) => navigate('demand-detail', { id })}
            />
            <ChangeStatusFeed demands={inChange} changes={changes} onOpenChange={() => navigate('changes')} />
          </div>

          {/* Right column: workload + CSAT */}
          <div className="space-y-6">
            <UnassignedPanel
              demands={unassigned}
              workers={workload?.byWorker ?? []}
              onOpen={(id) => navigate('demand-detail', { id })}
            />

            {/* Workload by Worker — WorkloadBars widget */}
            <SectionCard
              title="Workload by Worker"
              description="Active tickets per SCM worker (risk = SLA breaches on assigned tickets)."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('workers')}
                  className="gap-1.5 text-xs"
                >
                  Details <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {workloadQ.isLoading ? (
                <LoadingState rows={3} />
              ) : workloadItems.length === 0 ? (
                <EmptyState
                  title="No workload data"
                  description="Worker workload will appear here once tickets are assigned."
                />
              ) : (
                <>
                  <WorkloadBars items={workloadItems} />
                  <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-center text-xs">
                    <div>
                      <div className="text-base font-semibold tabular-nums">
                        {workload?.unassignedCount ?? 0}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Unassigned
                      </div>
                    </div>
                    <div>
                      <div className="text-base font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                        {workload?.overdueCount ?? 0}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Overdue
                      </div>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>

            {/* CSAT Low-Score Follow-ups */}
            <SectionCard
              title="CSAT Low-Score Follow-ups"
              description="Detractor surveys (rating ≤ 3). Reach out and recover the relationship."
            >
              {surveysQ.isLoading ? (
                <LoadingState rows={3} />
              ) : detractorSurveys.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
                  title="No detractors"
                  description="All recent CSAT ratings are 4★ or higher."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-80 overflow-y-auto scrollbar-thin">
                  {detractorSurveys.map((s) => (
                    <li
                      key={s.id}
                      className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors cursor-pointer"
                      onClick={() => {
                        if (s.entityType === 'TICKET') {
                          navigate('ticket-detail', { id: s.entityId });
                        } else {
                          navigate('demand-detail', { id: s.entityId });
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Star className="h-3.5 w-3.5 text-rose-500 fill-rose-500 shrink-0" />
                            <span className="text-sm font-medium">{s.rating}/5</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {s.customerName ?? 'Customer'}
                            </span>
                          </div>
                          {s.comment && (
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-2 italic">
                              “{s.comment}”
                            </p>
                          )}
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {s.entityType.toLowerCase()} · <RelativeTime date={s.createdAt} />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SlaHealthOverview
              slaEvents={slaEvents}
              services={[]}
              onOpenSla={() => navigate('sla')}
              breaches={breaches.length}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

function QuoteApprovalQueue({
  demands,
  onReview,
}: {
  demands: Demand[];
  onReview: (id: string) => void;
}) {
  const approve = useApproveQuote();
  return (
    <SectionCard
      title="Quote Approval Queue"
      description="Demands where the SCM Worker has drafted a quote. Your approval is required before the quote reaches the customer — this is the primary governance gate."
      actions={
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {demands.length} pending
        </Badge>
      }
    >
      {demands.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="No quotes awaiting your approval"
          description="Quotes that SCM Workers submit for governance review will appear here."
        />
      ) : (
        <div className="divide-y -mx-2">
          {demands.map((d) => (
            <div
              key={d.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 px-2 py-3 hover:bg-muted/30 rounded-md transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="font-medium text-sm hover:text-primary text-left truncate"
                    onClick={() => onReview(d.id)}
                  >
                    {d.title}
                  </button>
                  <DemandStatusBadge status={d.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">{d.serviceCustomerName ?? 'Customer'}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <UserAvatar name={d.assignedScmWorkerName ?? 'Unassigned'} size="sm" />
                    {d.assignedScmWorkerName ?? 'Unassigned'}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Effort: <Days value={d.estimatedEffortDays} />
                  </span>
                  <span>·</span>
                  <span className="font-medium text-foreground">
                    <Money value={d.estimatedCost} />
                  </span>
                </div>
                {d.quoteNotes && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{d.quoteNotes}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="default"
                  disabled={approve.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    approve.mutate(d.id);
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReview(d.id)}>
                  Review <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function UnassignedPanel({
  demands,
  workers,
  onOpen,
}: {
  demands: Demand[];
  workers: WorkloadStatsResponse['byWorker'];
  onOpen: (id: string) => void;
}) {
  const assign = useAssignDemand();
  const [picker, setPicker] = useState<Record<string, string>>({});

  return (
    <SectionCard
      title="Unassigned Demands"
      description="NEW demands with no SCM Worker assigned. Assign to balance workload."
      actions={
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {demands.length} open
        </Badge>
      }
    >
      {demands.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="All demands are assigned"
          description="No NEW demands are waiting for an SCM Worker."
        />
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto scrollbar-thin pr-1">
          {demands.map((d) => (
            <div key={d.id} className="rounded-md border p-3 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <button
                  className="text-sm font-medium hover:text-primary text-left flex-1 min-w-0 truncate"
                  onClick={() => onOpen(d.id)}
                >
                  {d.title}
                </button>
                <DemandStatusBadge status={d.status} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{d.serviceCustomerName ?? 'Customer'}</span>
                <span>·</span>
                <RelativeTime date={d.createdAt} /> since submission
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Select
                  value={picker[d.id] ?? ''}
                  onValueChange={(v) => setPicker((p) => ({ ...p, [d.id]: v }))}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Assign to SCM Worker…" />
                  </SelectTrigger>
                  <SelectContent>
                    {workers.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No workers available
                      </SelectItem>
                    ) : (
                      workers
                        .sort((a, b) => a.activeTickets - b.activeTickets)
                        .map((w) => (
                          <SelectItem key={w.workerId} value={w.workerId}>
                            {w.workerName} · {w.activeTickets} tickets · {w.activeDemands} demands
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8"
                  disabled={!picker[d.id] || assign.isPending}
                  onClick={() => {
                    if (!picker[d.id]) return;
                    assign.mutate({ id: d.id, workerId: picker[d.id] });
                    setPicker((p) => ({ ...p, [d.id]: '' }));
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Assign
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AwaitingCustomerPanel({
  demands,
  onOpen,
}: {
  demands: Demand[];
  onOpen: (id: string) => void;
}) {
  const overdueThreshold = 7;
  return (
    <SectionCard
      title="Awaiting Customer Action"
      description="Demands with a quote issued and approved, awaiting customer acceptance or decline."
      actions={<Badge variant="outline">{demands.length} waiting</Badge>}
    >
      {demands.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-8 w-8 text-muted-foreground/50" />}
          title="No demands awaiting customer action"
        />
      ) : (
        <div className="divide-y -mx-2">
          {demands.map((d) => {
            const days = daysSince(d.quotedAt) ?? 0;
            const overdue = days > overdueThreshold;
            return (
              <button
                key={d.id}
                onClick={() => onOpen(d.id)}
                className="w-full text-left px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="truncate">{d.serviceCustomerName}</span>
                    <span>·</span>
                    <span>Quoted <RelativeTime date={d.quotedAt!} /></span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    overdue
                      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  }
                >
                  {days}d {overdue ? '· overdue' : ''}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function ChangeStatusFeed({
  demands,
  changes,
  onOpenChange,
}: {
  demands: Demand[];
  changes: Change[];
  onOpenChange: () => void;
}) {
  if (demands.length === 0) {
    return (
      <SectionCard title="Change Status Feed" description="Demands currently in change implementation.">
        <EmptyState
          icon={<GitBranch className="h-8 w-8 text-muted-foreground/50" />}
          title="No active changes"
          description="Demands handed to Change Enablement will appear here."
        />
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Change Status Feed"
      description="Demands currently in change implementation, with linked change status."
      actions={
        <Button variant="ghost" size="sm" onClick={onOpenChange}>
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="divide-y -mx-2">
        {demands.map((d) => {
          const chg = changes.find((c) => c.id === d.changeRequestId);
          return (
            <div key={d.id} className="px-2 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  <span className="truncate">{d.serviceCustomerName}</span>
                  <span>·</span>
                  <span>{chg ? chg.title : 'No linked change'}</span>
                </div>
              </div>
              {chg ? <ChangeStatusBadge status={chg.status} /> : <Badge variant="outline">No change</Badge>}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function SlaHealthOverview({
  slaEvents,
  services,
  breaches,
  onOpenSla,
}: {
  slaEvents: SlaEvent[];
  services: Service[];
  breaches: number;
  onOpenSla: () => void;
}) {
  const warnings = slaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt).length;
  const closed = slaEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
  const total = slaEvents.length;
  const compliance = total > 0 ? Math.round((closed / total) * 100) : 100;
  const health: 'green' | 'amber' | 'red' = breaches > 0 ? 'red' : warnings > 0 ? 'amber' : 'green';

  return (
    <SectionCard
      title="SLA Health Overview"
      description="Tenant-wide SLA posture."
      actions={
        <Button variant="ghost" size="sm" onClick={onOpenSla}>
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="flex items-center justify-between mb-3">
        <SlaHealthBadge health={health} />
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{compliance}%</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">compliance</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 p-2">
          <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">{warnings}</div>
          <div className="text-[10px] text-muted-foreground">Warnings</div>
        </div>
        <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 p-2">
          <div className="text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-300">{breaches}</div>
          <div className="text-[10px] text-muted-foreground">Breaches</div>
        </div>
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-2">
          <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{closed}</div>
          <div className="text-[10px] text-muted-foreground">Closed in time</div>
        </div>
      </div>
      {breaches > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-2.5">
          <AlertOctagon className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-700 dark:text-rose-300">
            {breaches} unresolved breach{breaches !== 1 ? 'es' : ''} require your governance attention.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

/* ----------------------------- Inline helpers ----------------------------- */

function PriorityDot({ priority }: { priority: string }) {
  const cls =
    priority === 'P1'
      ? 'bg-rose-500'
      : priority === 'P2'
        ? 'bg-amber-500'
        : priority === 'P3'
          ? 'bg-teal-500'
          : 'bg-sky-500';
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${cls}`}
      title={priority}
      aria-label={`Priority ${priority}`}
    />
  );
}
