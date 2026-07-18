'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import type { SlaEvent } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  DataTable,
  Badge,
  Button,
  type Column,
} from '@/components/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SlaTrendChart, ComplianceDonut } from '@/components/widgets';
import {
  ShieldCheck,
  Gauge,
  Activity,
  TriangleAlert,
  ShieldAlert,
  TrendingDown,
  Stethoscope,
  Clock,
  CheckCircle2,
  Gavel,
  ArrowRight,
  TimerReset,
  AlertOctagon,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useOwnerProblems,
  deriveHealth,
  serviceCompliance,
  synthesiseTrend,
} from './_hooks';
import { OwnerDecisionDialog, type DecisionOption } from './_components/OwnerDecisionDialog';
import { formatMins, type SlaClockRow } from '@/lib/tickets';

/* --------------------- SlaClock extended wire shape --------------------- */
/* /api/sla-clocks returns ticket/policy/service context alongside the core
   SlaClockRow fields. We declare a local interface that mirrors the API
   response so the SlaPerformance view can render per-ticket context. */

interface SlaClockWithContext extends SlaClockRow {
  ticketNumber?: string;
  ticketTitle?: string;
  ticketStatus?: string;
  ticketPriority?: string;
  ticketType?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  serviceCustomerId?: string;
  serviceCustomerName?: string | null;
  policyName?: string;
}

interface GovernanceDecisionLite {
  id: string;
  serviceId: string;
  slaEventId: string | null;
  decisionType: string;
  decision: string;
  rationale: string;
  createdAt: string;
}

/* --------------------- Main --------------------- */

export default function SlaPerformance() {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();

  const services = servicesQ.data ?? [];
  const slaEvents = slaQ.data ?? [];
  const problems = problemsQ.data ?? [];

  const myServiceIds = useMemo(
    () => new Set(services.map((s) => s.id)),
    [services],
  );

  // SLA clocks for tickets on owned services (server-side scoped for SERVICE_OWNER).
  const clocksQ = useQuery<SlaClockWithContext[]>({
    queryKey: ['sla-clocks', 'owner'],
    queryFn: () => apiGet<SlaClockWithContext[]>('/api/sla-clocks'),
    staleTime: 30_000,
  });

  // Breach-response governance decisions (so we can flag which breaches have a recorded response).
  const breachDecisionsQ = useQuery({
    queryKey: ['governance-decisions', 'breach', Array.from(myServiceIds).sort().join(',')] as const,
    queryFn: async (): Promise<GovernanceDecisionLite[]> => {
      if (myServiceIds.size === 0) return [];
      const results = await Promise.all(
        Array.from(myServiceIds).map((sid) =>
          apiGet<GovernanceDecisionLite[]>(
            `/api/governance-decisions?serviceId=${encodeURIComponent(sid)}&decisionType=BREACH_RESPONSE`,
          ),
        ),
      );
      return results.flat();
    },
    enabled: myServiceIds.size > 0,
    staleTime: 30_000,
  });

  const mySlaEvents = useMemo(
    () => slaEvents.filter((e) => myServiceIds.has(e.serviceId)),
    [slaEvents, myServiceIds],
  );

  const clocks = clocksQ.data ?? [];

  // Group clocks by service.
  const clocksByService = useMemo(() => {
    const map = new Map<string, SlaClockWithContext[]>();
    for (const c of clocks) {
      if (!c.serviceId) continue;
      if (!myServiceIds.has(c.serviceId)) continue;
      const arr = map.get(c.serviceId) ?? [];
      arr.push(c);
      map.set(c.serviceId, arr);
    }
    return map;
  }, [clocks, myServiceIds]);

  // Per-service clock summary rows.
  const serviceClockRows = useMemo(() => {
    return services.map((s) => {
      const cs = clocksByService.get(s.id) ?? [];
      const running = cs.filter((c) => c.status === 'RUNNING').length;
      const paused = cs.filter((c) => c.status === 'PAUSED').length;
      const met = cs.filter((c) => c.status === 'MET').length;
      const breached = cs.filter((c) => c.status === 'BREACHED').length;
      return {
        id: s.id,
        service: s,
        running,
        paused,
        met,
        breached,
        total: cs.length,
      };
    });
  }, [services, clocksByService]);

  // Breached clocks list.
  const breachedClocks = useMemo(
    () => clocks.filter((c) => c.status === 'BREACHED' && c.serviceId && myServiceIds.has(c.serviceId)),
    [clocks, myServiceIds],
  );

  // Due-soon clocks (within 2 hours of dueAt, RUNNING status).
  const dueSoon = useMemo(() => {
    const twoHours = 2 * 60 * 60 * 1000;
    const now = Date.now();
    return clocks.filter(
      (c) =>
        c.status === 'RUNNING' &&
        c.serviceId &&
        myServiceIds.has(c.serviceId) &&
        c.dueAt &&
        new Date(c.dueAt).getTime() - now < twoHours,
    );
  }, [clocks, myServiceIds]);

  // Compliance metrics: MET / (MET + BREACHED) for RESPONSE and RESOLUTION.
  const responseCompliance = useMemo(() => {
    const rs = clocks.filter((c) => c.type === 'RESPONSE');
    const met = rs.filter((c) => c.status === 'MET').length;
    const breached = rs.filter((c) => c.status === 'BREACHED').length;
    const denom = met + breached;
    if (denom === 0) return null;
    return Math.round((met / denom) * 100);
  }, [clocks]);

  const resolutionCompliance = useMemo(() => {
    const rs = clocks.filter((c) => c.type === 'RESOLUTION');
    const met = rs.filter((c) => c.status === 'MET').length;
    const breached = rs.filter((c) => c.status === 'BREACHED').length;
    const denom = met + breached;
    if (denom === 0) return null;
    return Math.round((met / denom) * 100);
  }, [clocks]);

  const overallCompliance = useMemo(() => {
    const met = clocks.filter((c) => c.status === 'MET').length;
    const breached = clocks.filter((c) => c.status === 'BREACHED').length;
    const denom = met + breached;
    if (denom === 0) return null;
    return Math.round((met / denom) * 100);
  }, [clocks]);

  // Breach response status: how many breaches have a governance decision?
  const respondedBreachIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of breachDecisionsQ.data ?? []) {
      if (d.slaEventId) s.add(d.slaEventId);
    }
    return s;
  }, [breachDecisionsQ.data]);

  // The breached clocks don't carry an slaEventId directly; the SLA event that
  // represents the breach is matched by service + createdAt. We use the
  // serviceId of the breached clock to see if any BREACH_RESPONSE decision
  // exists for the corresponding slaEvent. Simpler: mark a breach as
  // "response recorded" if there's any BREACH_RESPONSE decision for that
  // service that was recorded AFTER the breach started.
  const breachResponseMap = useMemo(() => {
    const m = new Map<string, boolean>(); // clockId → responded
    for (const clock of breachedClocks) {
      if (!clock.serviceId) {
        m.set(clock.id, false);
        continue;
      }
      const breachStartedAt = new Date(clock.breachedAt ?? clock.startedAt).getTime();
      const responded = (breachDecisionsQ.data ?? []).some(
        (d) =>
          d.serviceId === clock.serviceId &&
          new Date(d.createdAt).getTime() >= breachStartedAt - 60_000,
      );
      m.set(clock.id, responded);
    }
    return m;
  }, [breachedClocks, breachDecisionsQ.data]);

  // Trend from SlaEvents (legacy compatibility — synthesise from events).
  const trendData = useMemo(() => synthesiseTrend(mySlaEvents), [mySlaEvents]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
  const problemForService = (serviceId: string) =>
    problems.find((p) => p.serviceId === serviceId);

  /* --- Breach Response Dialog --- */
  const [breachTarget, setBreachTarget] = useState<{
    clock: SlaClockWithContext;
    serviceId: string;
    serviceName: string;
  } | null>(null);

  const breachResponseMutation = useMutation({
    mutationFn: (args: { serviceId: string; rationale: string; decision: string; resourcesAuthorized?: string }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.serviceId,
        decisionType: 'BREACH_RESPONSE',
        decision: args.decision,
        rationale: args.rationale,
        resourcesAuthorized: args.resourcesAuthorized || undefined,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Breach response recorded', {
        description: `Response recorded for ${serviceName(vars.serviceId)}.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      setBreachTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const BREACH_OPTIONS: DecisionOption[] = [
    { value: 'REMEDIATION_AUTHORIZED', label: 'Remediation Authorized' },
    { value: 'RESOURCES_AUTHORIZED', label: 'Resources Authorized' },
    { value: 'EMERGENCY_CHANGE_DIRECTED', label: 'Emergency Change Directed' },
  ];

  const serviceColumns: Column<(typeof serviceClockRows)[number]>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.service.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <SlaClassBadge slaClass={r.service.slaClass} />
          </div>
        </div>
      ),
    },
    {
      key: 'running',
      header: 'Running',
      render: (r) =>
        r.running > 0 ? (
          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300">
            {r.running}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      key: 'paused',
      header: 'Paused',
      render: (r) =>
        r.paused > 0 ? (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300">
            {r.paused}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'met',
      header: 'Met',
      render: (r) =>
        r.met > 0 ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
            {r.met}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'breached',
      header: 'Breached',
      render: (r) =>
        r.breached > 0 ? (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold">
            {r.breached}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (r) => <span className="text-sm tabular-nums">{r.total}</span>,
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
    },
    {
      key: 'health',
      header: 'Health',
      render: (r) => {
        const sEvents = mySlaEvents.filter((e) => e.serviceId === r.service.id);
        return <SlaHealthBadge health={deriveHealth(sEvents)} />;
      },
    },
  ];

  const loading = servicesQ.isLoading || slaQ.isLoading || problemsQ.isLoading || clocksQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Performance"
        description="Track per-service SLA clock health, breach responses, and resolution / response compliance. Each breach is an accountability event — record a governance response to close the loop."
        icon={<Gauge className="h-6 w-6" />}
      />

      {loading ? (
        <LoadingState rows={6} />
      ) : services.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Gauge className="h-10 w-10" />}
            title="No services to report on"
            description="SLA performance is calculated against services in your portfolio."
          />
        </SectionCard>
      ) : (
        <>
          {/* Compliance summary cards */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Overall Compliance"
              description="Met / (Met + Breached) across all SLA clocks on owned services."
            >
              <div className="flex items-center justify-center py-2">
                <ComplianceDonut value={overallCompliance ?? 100} label="Overall" size={160} />
              </div>
            </SectionCard>

            <SectionCard
              title="Response vs. Resolution"
              description="Compliance split by SLA clock type — response clocks measure first-response time; resolution clocks measure total time-to-resolve."
            >
              <div className="grid grid-cols-2 gap-3 py-2">
                <ComplianceTile label="Response" value={responseCompliance} />
                <ComplianceTile label="Resolution" value={resolutionCompliance} />
              </div>
            </SectionCard>

            <SectionCard
              className="lg:col-span-1"
              title="Compliance Trend"
              description="Monthly compliance % across all owned services."
            >
              <SlaTrendChart data={trendData} height={160} />
            </SectionCard>
          </div>

          {/* Quick stats footer */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              icon={<Activity className="h-4 w-4" />}
              label="Total Clocks"
              value={clocks.length}
            />
            <StatTile
              icon={<TimerReset className="h-4 w-4" />}
              label="Running"
              value={clocks.filter((c) => c.status === 'RUNNING').length}
              tone="default"
            />
            <StatTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Breached"
              value={breachedClocks.length}
              tone="danger"
            />
            <StatTile
              icon={<TriangleAlert className="h-4 w-4" />}
              label="Due ≤ 2h"
              value={dueSoon.length}
              tone="warning"
            />
          </div>

          <Tabs defaultValue="services" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
              <TabsTrigger value="services" className="text-xs">By Service</TabsTrigger>
              <TabsTrigger value="breaches" className="text-xs">
                Breaches
                {breachedClocks.length > 0 && (
                  <Badge variant="outline" className="ml-1.5 bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 text-[10px] px-1.5 py-0">
                    {breachedClocks.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="due" className="text-xs">Due Soon</TabsTrigger>
              <TabsTrigger value="events" className="text-xs">Event Timeline</TabsTrigger>
            </TabsList>

            {/* Per-service clock summary */}
            <TabsContent value="services" className="space-y-4 mt-4">
              <SectionCard
                title="Active SLA Clocks by Service"
                description="Per-service clock counts grouped by status. Click a row to open the service detail."
              >
                <DataTable
                  columns={serviceColumns}
                  rows={serviceClockRows}
                  onRowClick={(r) => navigate('service-detail', { id: r.id })}
                  empty="No active SLA clocks on owned services."
                />
              </SectionCard>
            </TabsContent>

            {/* Breached clocks */}
            <TabsContent value="breaches" className="space-y-4 mt-4">
              <SectionCard
                title="Breached SLA Clocks"
                description="Each breached clock is an accountability event. Record a governance response to close the loop and notify CM Leaders."
              >
                {breachedClocks.length === 0 ? (
                  <EmptyState
                    icon={<ShieldCheck className="h-8 w-8 text-emerald-500" />}
                    title="No breached SLA clocks"
                    description="All SLA commitments are within target across your portfolio."
                  />
                ) : (
                  <div className="space-y-2.5 max-h-[520px] overflow-y-auto scrollbar-thin">
                    {breachedClocks.map((c) => {
                      const responded = breachResponseMap.get(c.id) ?? false;
                      const problem = c.serviceId ? problemForService(c.serviceId) : undefined;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-lg border p-3 ${
                            responded
                              ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                              : 'border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {responded ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                )}
                                <span className="text-sm font-medium">{c.serviceName ?? 'Service'}</span>
                                <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                                  {c.type} breach
                                </Badge>
                                {c.ticketNumber && (
                                  <span className="text-xs font-mono text-muted-foreground">{c.ticketNumber}</span>
                                )}
                                {responded ? (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                                    Response recorded
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold">
                                    Response required
                                  </Badge>
                                )}
                              </div>
                              {c.ticketTitle && (
                                <p className="mt-1 text-sm text-foreground/80 truncate">{c.ticketTitle}</p>
                              )}
                              <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-3">
                                <span>Customer: {c.serviceCustomerName ?? '—'}</span>
                                <span>·</span>
                                <span>Policy: {c.policyName ?? c.policyId.slice(-6)}</span>
                                <span>·</span>
                                <span>Due <FormattedDate date={c.dueAt} /></span>
                                {c.breachedAt && (
                                  <>
                                    <span>·</span>
                                    <span>Breached <RelativeTime date={c.breachedAt} /></span>
                                  </>
                                )}
                              </div>
                              {problem && (
                                <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-2">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                                    <Stethoscope className="h-3 w-3" /> PM Root-Cause Linked
                                  </div>
                                  <div className="text-xs text-foreground/80 mt-0.5">
                                    {problem.title} · {problem.status.replace(/_/g, ' ').toLowerCase()}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="shrink-0 flex flex-col gap-1.5">
                              {responded ? (
                                <Button size="sm" variant="outline" className="h-7" onClick={() => navigate('governance')}>
                                  View in governance
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-7 gap-1.5"
                                  onClick={() =>
                                    setBreachTarget({
                                      clock: c,
                                      serviceId: c.serviceId!,
                                      serviceName: c.serviceName ?? serviceName(c.serviceId ?? ''),
                                    })
                                  }
                                >
                                  <Gavel className="h-3 w-3" /> Record Response
                                </Button>
                              )}
                              {c.ticketId && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-[11px]"
                                  onClick={() => navigate('ticket-detail', { id: c.ticketId })}
                                >
                                  View ticket <ArrowRight className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Breach response status */}
              <SectionCard
                title="Breach Response Status"
                description="How many breached clocks have a governance response recorded vs. still pending."
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                      Responded
                    </div>
                    <div className="text-2xl font-semibold tabular-nums mt-1 text-emerald-700 dark:text-emerald-300">
                      {[...breachResponseMap.values()].filter(Boolean).length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-300">
                      Pending Response
                    </div>
                    <div className="text-2xl font-semibold tabular-nums mt-1 text-rose-700 dark:text-rose-300">
                      {[...breachResponseMap.values()].filter((v) => !v).length}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </TabsContent>

            {/* Due soon */}
            <TabsContent value="due" className="space-y-4 mt-4">
              <SectionCard
                title="SLA Clocks Due Within 2 Hours"
                description="Running clocks within 2 hours of their dueAt — at risk of imminent breach."
              >
                {dueSoon.length === 0 ? (
                  <EmptyState
                    icon={<TimerReset className="h-8 w-8 text-emerald-500" />}
                    title="No clocks due soon"
                    description="No running SLA clocks are within 2 hours of their due time."
                  />
                ) : (
                  <ul className="divide-y max-h-[460px] overflow-y-auto scrollbar-thin">
                    {dueSoon
                      .slice()
                      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
                      .map((c) => {
                        const mins = c.remainingMins ?? 0;
                        const tone = mins < 0 ? 'danger' : mins < 30 ? 'danger' : 'warning';
                        return (
                          <li
                            key={c.id}
                            className="py-2.5 flex items-start justify-between gap-2 flex-wrap hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{c.serviceName ?? 'Service'}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {c.type}
                                </Badge>
                                {c.ticketNumber && (
                                  <span className="text-xs font-mono text-muted-foreground">{c.ticketNumber}</span>
                                )}
                              </div>
                              {c.ticketTitle && (
                                <p className="mt-0.5 text-xs text-foreground/80 truncate">{c.ticketTitle}</p>
                              )}
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Due <FormattedDate date={c.dueAt} /> · {formatMins(mins)} remaining
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                tone === 'danger'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold shrink-0'
                                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 shrink-0'
                              }
                            >
                              {mins < 0 ? 'OVERDUE' : `${formatMins(mins)} left`}
                            </Badge>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </SectionCard>
            </TabsContent>

            {/* Event timeline (legacy) */}
            <TabsContent value="events" className="space-y-4 mt-4">
              <SectionCard
                title="Breach Event Timeline"
                description="Chronological view of SLA breach events (legacy) with Problem Management root-cause context where available."
              >
                <BreachTimeline
                  events={mySlaEvents.filter((e) => e.eventType === 'BREACHED')}
                  serviceName={serviceName}
                  problemForService={problemForService}
                />
              </SectionCard>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Breach response dialog */}
      {breachTarget && (
        <OwnerDecisionDialog
          key={`breach:${breachTarget.clock.id}`}
          open={!!breachTarget}
          onOpenChange={(v) => !v && setBreachTarget(null)}
          serviceId={breachTarget.serviceId}
          decisionType="BREACH_RESPONSE"
          decisionOptions={BREACH_OPTIONS}
          dialogTitle="Record Breach Response"
          dialogDescription={
            <span>
              Breach on <span className="font-medium">{breachTarget.serviceName}</span> —{' '}
              {breachTarget.clock.ticketTitle ?? breachTarget.clock.policyName ?? 'SLA clock'} breached{' '}
              {breachTarget.clock.breachedAt ? <RelativeTime date={breachTarget.clock.breachedAt} /> : 'recently'}.
              Your response is persisted to the audit trail and CM Leaders are notified.
            </span>
          }
          onSubmitted={() => {
            // OwnerDecisionDialog invalidates the governance-decisions query.
            setBreachTarget(null);
          }}
        />
      )}
    </div>
  );
}

/* --------------------- Sub-components --------------------- */

function ComplianceTile({ label, value }: { label: string; value: number | null }) {
  const tone = value == null ? 'muted' : value >= 95 ? 'green' : value >= 85 ? 'amber' : 'red';
  const cls = {
    green: 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
    red: 'border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300',
    muted: 'border-border bg-muted/40 text-muted-foreground',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value == null ? '—' : `${value}%`}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneCls = {
    default: '',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function BreachTimeline({
  events,
  serviceName,
  problemForService,
}: {
  events: SlaEvent[];
  serviceName: (id: string) => string;
  problemForService: (serviceId: string) => { title: string; status: string; rootCauseDescription: string | null } | undefined;
}) {
  const sorted = useMemo(
    () => events.slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [events],
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-8 w-8" />}
        title="No breaches recorded"
        description="All SLA events within target across your portfolio."
      />
    );
  }

  return (
    <ol className="relative space-y-4 max-h-[480px] overflow-y-auto scrollbar-thin pr-2">
      {sorted.map((b, i) => {
        const pm = problemForService(b.serviceId);
        return (
          <li key={b.id} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`h-2.5 w-2.5 rounded-full mt-1.5 ${
                  b.resolvedAt ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              {i < sorted.length - 1 && <div className="w-px flex-1 bg-border" />}
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{serviceName(b.serviceId)}</span>
                <FormattedDate date={b.createdAt} className="text-xs text-muted-foreground" />
              </div>
              <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{b.message}</p>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
                {b.resolvedAt ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300"
                  >
                    Resolved <RelativeTime date={b.resolvedAt} />
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold"
                  >
                    <ShieldAlert className="h-3 w-3 mr-1" /> Active — response required
                  </Badge>
                )}
              </div>
              {pm && (
                <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <Stethoscope className="h-3 w-3" /> PM Root-Cause Context
                  </div>
                  <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                    {pm.rootCauseDescription ?? 'Under investigation.'}
                  </p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Problem: <span className="font-medium">{pm.title}</span> ·{' '}
                    {pm.status.replace(/_/g, ' ').toLowerCase()}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
