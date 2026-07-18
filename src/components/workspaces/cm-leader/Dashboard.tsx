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
  Card,
  CardContent,
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

/* ----------------------------- Shared types ----------------------------- */

interface WorkloadItem {
  workerId: string;
  workerName: string;
  avatarColor?: string;
  activeDemands: number;
  // The /api/stats response uses `slaRisk`; `riskCount` is kept for resilience.
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
  const statsQ = useLeaderStats();
  const slaQ = useSlaEvents();
  const changesQ = useChanges();

  const demands = demandsQ.data ?? [];
  const stats = statsQ.data;
  const slaEvents = slaQ.data ?? [];
  const changes = changesQ.data ?? [];

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

  const isLoading = demandsQ.isLoading || statsQ.isLoading;

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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="Active Demands"
          value={stats?.totalDemands ?? activeDemands.length}
          hint="Across all service customers"
          icon={<FileText className="h-4 w-4" />}
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="Unassigned"
          value={unassigned.length}
          hint="Awaiting SCM assignment"
          tone="warning"
          icon={<Inbox className="h-4 w-4" />}
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="Pending Quote Approval"
          value={quoteQueue.length}
          hint="Your governance gate"
          tone="warning"
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <StatCard
          label="SLA Breaches"
          value={breaches.length}
          hint="Unresolved breach events"
          tone="danger"
          icon={<AlertTriangle className="h-4 w-4" />}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="Open Changes"
          value={openChanges.length}
          hint="In progress across tenant"
          icon={<GitBranch className="h-4 w-4" />}
          onClick={() => navigate('changes')}
        />
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quote Approval Queue — governance gate */}
          <div className="lg:col-span-2 space-y-6">
            <QuoteApprovalQueue demands={quoteQueue} onReview={(id) => navigate('demand-detail', { id })} />
            <AwaitingCustomerPanel demands={awaitingCustomer} onOpen={(id) => navigate('demand-detail', { id })} />
            <ChangeStatusFeed demands={inChange} changes={changes} onOpenChange={() => navigate('changes')} />
          </div>

          {/* Right column: unassigned + workload */}
          <div className="space-y-6">
            <UnassignedPanel
              demands={unassigned}
              workers={stats?.workloadByWorker ?? []}
              onOpen={(id) => navigate('demand-detail', { id })}
            />
            <WorkloadSnapshot workers={stats?.workloadByWorker ?? []} onOpenWorker={() => navigate('workers')} />
            <SlaHealthOverview slaEvents={slaEvents} services={[]} onOpenSla={() => navigate('sla')} breaches={breaches.length} />
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
  workers: WorkloadItem[];
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
                        .sort((a, b) => a.activeDemands - b.activeDemands)
                        .map((w) => (
                          <SelectItem key={w.workerId} value={w.workerId}>
                            {w.workerName} · {w.activeDemands} active
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

function WorkloadSnapshot({
  workers,
  onOpenWorker,
}: {
  workers: WorkloadItem[];
  onOpenWorker: () => void;
}) {
  const items = workers.map((w) => ({
    name: w.workerName,
    count: w.activeDemands,
    risk: w.slaRisk ?? w.riskCount,
  }));
  return (
    <SectionCard
      title="SCM Workload Snapshot"
      description="Active demands per SCM Worker."
      actions={
        <Button variant="ghost" size="sm" onClick={onOpenWorker}>
          Details <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {workers.length === 0 ? (
        <EmptyState title="No workload data" description="Workload metrics will appear here once demands are assigned." />
      ) : (
        <WorkloadBars items={items} />
      )}
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
            {breaches} unresolved breach{breaches !== 1 ? 's' : ''} require your governance attention.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
