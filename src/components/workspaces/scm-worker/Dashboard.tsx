'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '@/lib/api';
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
  SlaClassBadge,
  UserAvatar,
  RelativeTime,
  Badge,
  Button,
} from '@/components/shared';
import { DemandPipelineLanes, WorkloadBars } from '@/components/widgets';
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  GitBranch,
  Inbox,
  PlusCircle,
  ArrowRight,
  Activity,
  ShieldAlert,
  TimerReset,
  UserPlus,
} from 'lucide-react';
import type {
  Demand,
  Change,
  SlaEvent,
  Service,
  DemandStatus,
} from '@/lib/types';
import type { Ticket } from '@/lib/tickets';

/* ----------------------------- Stats response types ----------------------------- */

interface OverviewResponse {
  totalOpenTickets: number;
  totalActiveDemands: number;
  slaBreaches: number;
  slaWarnings: number;
}

interface TicketsStatsResponse {
  byStatus: Record<string, number>;
  unassigned: number;
  waitingCustomer: number;
  reopened: number;
  slaBreached: number;
}

interface DemandsStatsResponse {
  byStatus: Record<string, number>;
  pendingApprovals: number;
  awaitingCustomer: number;
  inChange: number;
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

/* ----------------------------- Constants ----------------------------- */

const ACTIVE_STATUSES: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
];

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  return Math.max(0, Math.floor((Date.now() - d) / 86400000));
}

/* ----------------------------- Component ----------------------------- */

export default function Dashboard() {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  // Stats from split endpoints.
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

  // Existing demand-level data (for the kanban + queues).
  const { data: myDemands, isLoading: myLoading } = useQuery<Demand[]>({
    queryKey: ['demands', 'assigned', 'me'],
    queryFn: () => apiGet('/api/demands?assigned=me'),
  });
  const { data: unassignedDemands } = useQuery<Demand[]>({
    queryKey: ['demands', 'unassigned'],
    queryFn: () => apiGet('/api/demands?unassigned=1'),
  });
  const { data: slaEvents } = useQuery<SlaEvent[]>({
    queryKey: ['sla-events'],
    queryFn: () => apiGet('/api/sla-events'),
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });
  const { data: changes } = useQuery<Change[]>({
    queryKey: ['changes', 'all'],
    queryFn: () => apiGet('/api/changes'),
  });

  // Tickets — assigned to me, sorted by SLA due date.
  const myTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'scm-dashboard', 'mine'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?assignedUserId=me&status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER&sort=sla',
    ),
    staleTime: 30_000,
  });

  // Unassigned tickets for my customers (server scope handles SCM_WORKER
  // visibility — assigned-to-me + unassigned + assigned customer orgs).
  const unassignedTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'scm-dashboard', 'unassigned'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?assignedUserId=unassigned&status=NEW,TRIAGED&sort=sla',
      ),
    staleTime: 30_000,
  });

  // SLA clocks — RUNNING clocks sorted by dueAt (soonest first).
  const slaClocksQ = useQuery<SlaClockRow[]>({
    queryKey: ['sla-clocks', 'scm-dashboard', 'running'],
    queryFn: () => apiGet<SlaClockRow[]>('/api/sla-clocks?status=RUNNING'),
    staleTime: 30_000,
  });

  const assignMe = useMutation({
    mutationFn: (id: string) =>
      apiPatch(`/api/demands/${id}`, { assignedScmWorkerId: session?.id }),
    onSuccess: () => {
      toast.success('Demand assigned to you');
      qc.invalidateQueries({ queryKey: ['demands'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not assign demand'),
  });

  const assignTicketMe = useMutation({
    mutationFn: (id: string) =>
      apiPatch(`/api/tickets/${id}/assign`, { assignedUserId: session?.id }),
    onSuccess: () => {
      toast.success('Ticket taken — assigned to you');
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not take ticket'),
  });

  const myActive = (myDemands ?? []).filter((d) => ACTIVE_STATUSES.includes(d.status));
  const myQuoted = (myDemands ?? []).filter((d) => d.status === 'QUOTED');
  const breaches = (slaEvents ?? []).filter((e) => e.eventType === 'BREACHED');
  const warnings = (slaEvents ?? []).filter((e) => e.eventType === 'WARNING');
  const openChanges = (changes ?? []).filter(
    (c) => c.status !== 'CLOSED' && c.status !== 'REJECTED',
  );
  const inChangeDemands = (myDemands ?? []).filter((d) => d.status === 'IN_CHANGE');

  // My tickets (sorted by SLA due already from the API; defensive sort here).
  const myTickets = React.useMemo(() => {
    return (myTicketsQ.data ?? []).slice().sort((a, b) => {
      const aDue = earliestDue(a);
      const bDue = earliestDue(b);
      if (aDue == null && bDue == null) return 0;
      if (aDue == null) return 1;
      if (bDue == null) return -1;
      return aDue - bDue;
    });
  }, [myTicketsQ.data]);

  const unassignedTickets = unassignedTicketsQ.data ?? [];

  // SLA Due Soon = RUNNING clocks with dueAt within the next 2 hours.
  const slaDueSoon = React.useMemo(() => {
    const now = Date.now();
    const twoHours = 2 * 3_600_000;
    return (slaClocksQ.data ?? [])
      .filter((c) => {
        const due = new Date(c.dueAt).getTime();
        return due - now <= twoHours; // already-due (negative diff) counts too
      })
      .slice(0, 8);
  }, [slaClocksQ.data]);

  // SLA health snapshot — services with active warnings/breaches.
  const serviceById = React.useMemo(() => {
    const m = new Map<string, Service>();
    (services ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);
  const slaByService = React.useMemo(() => {
    const m = new Map<string, { warnings: number; breaches: number }>();
    for (const e of slaEvents ?? []) {
      if (e.eventType === 'CLOSED_IN_TIME') continue;
      const cur = m.get(e.serviceId) ?? { warnings: 0, breaches: 0 };
      if (e.eventType === 'WARNING') cur.warnings += 1;
      if (e.eventType === 'BREACHED') cur.breaches += 1;
      m.set(e.serviceId, cur);
    }
    return m;
  }, [slaEvents]);
  const slaHotspots = Array.from(slaByService.entries())
    .map(([sid, counts]) => ({ service: serviceById.get(sid), counts, sid }))
    .filter((x) => x.service)
    .sort(
      (a, b) =>
        b.counts.breaches - a.counts.breaches || b.counts.warnings - a.counts.warnings,
    )
    .slice(0, 6);

  // Workload for WorkloadBars (group my active demands by status).
  const workload = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const overdue: Record<string, number> = {};
    for (const d of myActive) {
      counts[d.status] = (counts[d.status] ?? 0) + 1;
      if (d.status === 'QUOTED') {
        const days = daysSince(d.quotedAt);
        if (days !== null && days > 5) overdue[d.status] = (overdue[d.status] ?? 0) + 1;
      }
    }
    return ([
      'NEW',
      'UNDER_REVIEW',
      'QUOTED',
      'ACCEPTED',
      'IN_CHANGE',
      'FULFILLED',
    ] as DemandStatus[])
      .filter((s) => counts[s])
      .map((s) => ({
        name: s
          .replace('_', ' ')
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        count: counts[s],
        risk: overdue[s] ?? 0,
      }));
  }, [myActive]);

  // Stat card values — prefer new endpoints, fall back to legacy aggregates.
  const myAssignedTickets = overviewQ.data
    ? myTickets.length
    : myTickets.length;
  const unassignedForMyCustomers = ticketStatsQ.data?.unassigned ?? unassignedTickets.length;
  const slaDueSoonCount = slaDueSoon.length;
  const waitingCustomerCount = ticketStatsQ.data?.waitingCustomer ?? 0;
  const demandsPendingAction =
    (demandStatsQ.data?.pendingApprovals ?? 0) +
    (demandStatsQ.data?.awaitingCustomer ?? 0) +
    (demandStatsQ.data?.inChange ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Workspace"
        description="Own the demand lifecycle — assess, quote, hand to CE, fulfill, and communicate."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <Button onClick={() => navigate('demands')} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Demand on behalf
          </Button>
        }
      />

      {/* Top operational stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="My Assigned Tickets"
          value={overviewQ.isLoading ? '—' : myAssignedTickets}
          hint="Open tickets assigned to you"
          icon={<Inbox className="h-4 w-4" />}
          tone={myAssignedTickets > 0 ? 'warning' : 'default'}
          onClick={() => navigate('tickets')}
        />
        <StatCard
          label="Unassigned for My Customers"
          value={ticketStatsQ.isLoading ? '—' : unassignedForMyCustomers}
          hint="Awaiting triage in your customer scope"
          icon={<UserPlus className="h-4 w-4" />}
          tone={unassignedForMyCustomers > 0 ? 'warning' : 'default'}
          onClick={() => navigate('tickets')}
        />
        <StatCard
          label="SLA Due Soon"
          value={slaClocksQ.isLoading ? '—' : slaDueSoonCount}
          hint="Clocks expiring within 2 hours"
          icon={<TimerReset className="h-4 w-4" />}
          tone={slaDueSoonCount > 0 ? 'danger' : 'success'}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="Waiting Customer"
          value={ticketStatsQ.isLoading ? '—' : waitingCustomerCount}
          hint="Tickets paused on customer reply"
          icon={<Clock className="h-4 w-4" />}
          tone={waitingCustomerCount > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Demands Pending Action"
          value={demandStatsQ.isLoading ? '—' : demandsPendingAction}
          hint="Quotes + approvals + changes in flight"
          icon={<ClipboardList className="h-4 w-4" />}
          tone={demandsPendingAction > 0 ? 'warning' : 'default'}
          onClick={() => navigate('demands')}
        />
      </div>

      {/* My Ticket Queue + SLA Due Soon */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="My Ticket Queue"
          description="Tickets assigned to you — sorted by SLA due date."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('tickets')}
              className="gap-1.5 text-xs"
            >
              Open queue <ArrowRight className="h-3 w-3" />
            </Button>
          }
        >
          {myTicketsQ.isLoading ? (
            <LoadingState rows={3} />
          ) : myTickets.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="No tickets assigned to you"
              description="Take an unassigned ticket from the panel beside."
            />
          ) : (
            <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
              {myTickets.slice(0, 8).map((t) => (
                <li
                  key={t.id}
                  className="py-2.5 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                  onClick={() => navigate('ticket-detail', { id: t.id })}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">{t.number}</span>
                        <PriorityDot priority={t.priority} />
                        <span className="text-sm font-medium truncate">{t.title}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        {t.serviceCustomerName ?? '—'} · {t.serviceName ?? 'General'}
                      </div>
                    </div>
                    <SlaStatusPill ticket={t} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="SLA Due Soon"
          description="Running SLA clocks expiring within 2 hours. Pick these up first."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('sla')}
              className="gap-1.5 text-xs"
            >
              Open SLM <ArrowRight className="h-3 w-3" />
            </Button>
          }
        >
          {slaClocksQ.isLoading ? (
            <LoadingState rows={3} />
          ) : slaDueSoon.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-7 w-7" />}
              title="No SLA due in the next 2 hours"
              description="You're on top of the clock."
            />
          ) : (
            <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
              {slaDueSoon.map((c) => {
                const due = new Date(c.dueAt).getTime();
                const diffMin = Math.round((due - Date.now()) / 60000);
                const overdue = diffMin < 0;
                return (
                  <li
                    key={c.id}
                    className="py-2.5 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
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
                          {c.serviceCustomerName ?? '—'} · {c.serviceName ?? 'General'} · {c.type.toLowerCase()}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          overdue
                            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 text-[10px] shrink-0'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px] shrink-0'
                        }
                      >
                        {overdue ? `${Math.abs(diffMin)}m over` : `${diffMin}m left`}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* My queue (kanban) + workload */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="My Queue"
            description="Demands assigned to you, grouped by lifecycle stage."
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('demands')}
                className="gap-1.5 text-xs"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Button>
            }
          >
            {myLoading ? (
              <LoadingState rows={3} />
            ) : myActive.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title="No active demands"
                description="Pick up an unassigned demand from the panel beside."
              />
            ) : (
              <DemandPipelineLanes
                demands={myActive}
                onSelect={(d) => navigate('demand-detail', { id: d.id })}
                emptyLabel="No demands in this stage"
              />
            )}
          </SectionCard>
        </div>
        <SectionCard
          title="My Workload"
          description="Active demands by status"
        >
          {workload.length === 0 ? (
            <EmptyState icon={<Activity className="h-7 w-7" />} title="No workload" />
          ) : (
            <WorkloadBars items={workload} />
          )}
        </SectionCard>
      </div>

      {/* Unassigned tickets for my customers + Unassigned demands */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Unassigned for My Customers"
          description="Take a ticket — these are within your customer scope."
          actions={
            <Badge variant="outline" className="text-xs">
              {unassignedTickets.length} open
            </Badge>
          }
        >
          {unassignedTickets.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="Queue is clear"
              description="No unassigned tickets in your scope right now."
            />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
              {unassignedTickets.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => navigate('ticket-detail', { id: t.id })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">{t.number}</span>
                      <PriorityDot priority={t.priority} />
                      <span className="text-sm font-medium truncate">{t.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.serviceCustomerName ?? '—'} · {t.serviceName ?? 'General'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={assignTicketMe.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      assignTicketMe.mutate(t.id);
                    }}
                    className="shrink-0"
                  >
                    Take
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Unassigned Demands"
          description="Pick up new demands awaiting an SCM worker."
          actions={
            <Badge variant="outline" className="text-xs">
              {(unassignedDemands ?? []).length} open
            </Badge>
          }
        >
          {(unassignedDemands ?? []).length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="Queue is clear"
              description="No unassigned demands right now."
            />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
              {(unassignedDemands ?? []).slice(0, 6).map((d) => (
                <div
                  key={d.id}
                  className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => navigate('demand-detail', { id: d.id })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <DemandStatusBadge status={d.status} />
                      <span className="text-xs text-muted-foreground">
                        {d.serviceCustomerName ?? '—'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium truncate">{d.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Submitted <RelativeTime date={d.createdAt} /> by {d.submittedByName ?? '—'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={assignMe.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      assignMe.mutate(d.id);
                    }}
                  >
                    Assign to Me
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Awaiting customer + Change status feed */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Awaiting Customer Action"
          description="Quotes you've issued — waiting on customer accept/decline."
        >
          {myQuoted.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-7 w-7" />}
              title="Nothing awaiting customer"
              description="No quotes pending customer decision."
            />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
              {myQuoted.map((d) => {
                const days = daysSince(d.quotedAt);
                const overdue = days !== null && days > 5;
                return (
                  <div
                    key={d.id}
                    className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => navigate('demand-detail', { id: d.id })}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{d.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {d.serviceCustomerName ?? '—'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={
                          overdue
                            ? 'text-sm font-semibold text-rose-600 tabular-nums'
                            : 'text-sm font-medium tabular-nums'
                        }
                      >
                        {days === null ? '—' : `${days}d`}
                      </div>
                      {overdue ? (
                        <Badge
                          variant="outline"
                          className="mt-1 text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                        >
                          Overdue
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">since quote</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Change Status Feed"
          description="IN_CHANGE demands and their linked change progress."
        >
          {inChangeDemands.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-7 w-7" />}
              title="No changes in flight"
              description="Demands you hand to CE will appear here."
            />
          ) : (
            <div className="space-y-2">
              {inChangeDemands.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => navigate('demand-detail', { id: d.id })}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      Change: {d.change?.title ?? '—'}
                    </p>
                  </div>
                  {d.change ? (
                    <ChangeStatusBadge status={d.change.status} />
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      No change
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* SLA Health Snapshot */}
      <SectionCard
        title="SLA Health Snapshot"
        description="Services with active warnings or breaches in your scope."
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('sla')} className="gap-1.5 text-xs">
            Open SLM <ArrowRight className="h-3 w-3" />
          </Button>
        }
      >
        {slaHotspots.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="h-7 w-7" />}
            title="All clear"
            description="No active SLA warnings or breaches."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {slaHotspots.map(({ service, counts }) => (
              <div
                key={service!.id}
                className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => navigate('sla')}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{service!.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {counts.breaches > 0 && (
                      <span className="text-rose-600 font-medium">
                        {counts.breaches} breach{counts.breaches > 1 ? 'es' : ''}
                      </span>
                    )}
                    {counts.breaches > 0 && counts.warnings > 0 && <span> · </span>}
                    {counts.warnings > 0 && (
                      <span className="text-amber-600 font-medium">
                        {counts.warnings} warning{counts.warnings > 1 ? 's' : ''}
                      </span>
                    )}
                  </p>
                </div>
                <SlaClassBadge slaClass={service!.slaClass} />
                <SlaHealthBadge health={counts.breaches > 0 ? 'red' : 'amber'} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ----------------------------- Inline helpers ----------------------------- */

function earliestDue(t: Ticket): number | null {
  const clocks = t.slaClocks ?? [];
  const running = clocks.filter((c) => c.status === 'RUNNING' && c.dueAt);
  if (running.length === 0) return null;
  return Math.min(...running.map((c) => new Date(c.dueAt).getTime()));
}

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

function SlaStatusPill({ ticket }: { ticket: Ticket }) {
  const clocks = ticket.slaClocks ?? [];
  if (clocks.length === 0) {
    return <span className="text-[10px] text-muted-foreground">No SLA</span>;
  }
  const hasBreached = clocks.some((c) => c.status === 'BREACHED');
  const hasRunning = clocks.some((c) => c.status === 'RUNNING');
  if (hasBreached) {
    return (
      <Badge
        variant="outline"
        className="border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 text-[10px] shrink-0"
      >
        Breached
      </Badge>
    );
  }
  if (hasRunning) {
    const soonest = clocks
      .filter((c) => c.status === 'RUNNING' && c.dueAt)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
    if (!soonest) {
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
          On track
        </Badge>
      );
    }
    const dueMs = new Date(soonest.dueAt).getTime();
    const diffH = (dueMs - Date.now()) / 3_600_000;
    if (diffH <= 2) {
      return (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px] shrink-0"
        >
          Due {Math.max(0, Math.round(diffH))}h
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
        Due {Math.round(diffH)}h
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[10px] text-emerald-700 dark:text-emerald-300 shrink-0"
    >
      Met
    </Badge>
  );
}
