'use client';

import { useMemo } from 'react';
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
  type Column,
} from '@/components/shared';
import { SlaTrendChart, ComplianceDonut } from '@/components/widgets';
import {
  ShieldCheck,
  Gauge,
  Activity,
  TriangleAlert,
  ShieldAlert,
  TrendingDown,
  Stethoscope,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useOwnerProblems,
  deriveHealth,
  serviceCompliance,
  synthesiseTrend,
} from './_hooks';

export default function SlaPerformance() {
  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();

  const services = servicesQ.data ?? [];
  const slaEvents = slaQ.data ?? [];
  const problems = problemsQ.data ?? [];

  const mySlaEvents = useMemo(
    () => slaEvents.filter((e) => services.some((s) => s.id === e.serviceId)),
    [slaEvents, services],
  );

  const rows = useMemo(
    () =>
      services.map((s) => {
        const evs = mySlaEvents.filter((e) => e.serviceId === s.id);
        const warnings = evs.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt).length;
        const breaches = evs.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt).length;
        return {
          id: s.id,
          service: s,
          warnings,
          breaches,
          compliance: serviceCompliance(evs),
          health: deriveHealth(evs),
        };
      }),
    [services, mySlaEvents],
  );

  const overallCompliance = useMemo(() => {
    if (mySlaEvents.length === 0) return 100;
    const breaches = mySlaEvents.filter((e) => e.eventType === 'BREACHED').length;
    const inTime = mySlaEventCount(mySlaEvents, 'CLOSED_IN_TIME');
    const denom = breaches + inTime;
    if (denom === 0) return 100;
    return Math.round((inTime / denom) * 100);
  }, [mySlaEvents]);

  const trendData = useMemo(() => synthesiseTrend(mySlaEvents), [mySlaEvents]);

  const breachTimeline = useMemo(
    () =>
      mySlaEvents
        .filter((e) => e.eventType === 'BREACHED')
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [mySlaEvents],
  );

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
  const problemForService = (serviceId: string) =>
    problems.find((p) => p.serviceId === serviceId);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.service.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{r.service.chapter}</div>
        </div>
      ),
    },
    {
      key: 'class',
      header: 'SLA Class',
      render: (r) => <SlaClassBadge slaClass={r.service.slaClass} />,
    },
    {
      key: 'target',
      header: 'Availability',
      render: (r) =>
        r.service.slaProfile ? (
          <span className="text-sm tabular-nums">{r.service.slaProfile.availabilityTarget}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'compliance',
      header: 'Compliance',
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium tabular-nums">{r.compliance}%</div>
          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${
                r.compliance >= 95
                  ? 'bg-emerald-500'
                  : r.compliance >= 80
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              }`}
              style={{ width: `${r.compliance}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'warnings',
      header: 'Warnings',
      render: (r) =>
        r.warnings > 0 ? (
          <Badge
            variant="outline"
            className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300"
          >
            {r.warnings} active
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      key: 'breaches',
      header: 'Breaches',
      render: (r) =>
        r.breaches > 0 ? (
          <Badge
            variant="outline"
            className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold"
          >
            {r.breaches} active
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      key: 'health',
      header: 'Health',
      render: (r) => <SlaHealthBadge health={r.health} />,
    },
  ];

  const loading = servicesQ.isLoading || slaQ.isLoading || problemsQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Performance"
        description="Breach notifications produce governance responses, not documentation. Track per-service compliance, investigate root causes, and respond to breaches."
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
              title="Portfolio Compliance"
              description="SLA events closed-in-time vs. breaches across your services."
            >
              <div className="flex items-center justify-center py-2">
                <ComplianceDonut value={overallCompliance} label="Overall" size={160} />
              </div>
            </SectionCard>

            <SectionCard
              className="lg:col-span-2"
              title="Compliance Trend"
              description="Monthly compliance % across all owned services."
            >
              <SlaTrendChart data={trendData} height={180} />
            </SectionCard>
          </div>

          {/* Per-service table */}
          <SectionCard
            title="Per-Service SLA Performance"
            description="Current compliance, active warnings, and breach counts for each owned service."
          >
            <DataTable columns={columns} rows={rows} empty="No services." />
          </SectionCard>

          {/* Breach event timeline */}
          <SectionCard
            title="Breach Event Timeline"
            description="Chronological view of breach events with Problem Management root-cause context where available."
          >
            {breachTimeline.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-8 w-8" />}
                title="No breaches recorded"
                description="All SLA events within target across your portfolio."
              />
            ) : (
              <ol className="relative space-y-4 max-h-[480px] overflow-y-auto scrollbar-thin pr-2">
                {breachTimeline.map((b, i) => {
                  const pm = problemForService(b.serviceId);
                  return (
                    <li key={b.id} className="relative flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={`h-2.5 w-2.5 rounded-full mt-1.5 ${
                            b.resolvedAt ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {i < breachTimeline.length - 1 && (
                          <div className="w-px flex-1 bg-border" />
                        )}
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
                          {b.serviceCustomerId && (
                            <span className="text-muted-foreground">
                              affected customer: {b.serviceCustomerId.slice(-6)}
                            </span>
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
            )}
          </SectionCard>

          {/* Quick stats footer */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              icon={<Activity className="h-4 w-4" />}
              label="Total SLA Events"
              value={mySlaEvents.length}
            />
            <StatTile
              icon={<TriangleAlert className="h-4 w-4" />}
              label="Active Warnings"
              value={mySlaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt).length}
              tone="warning"
            />
            <StatTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Active Breaches"
              value={mySlaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt).length}
              tone="danger"
            />
            <StatTile
              icon={<TrendingDown className="h-4 w-4" />}
              label="Resolved This Period"
              value={mySlaEvents.filter((e) => e.resolvedAt).length}
              tone="success"
            />
          </div>
        </>
      )}
    </div>
  );
}

function mySlaEventCount(events: SlaEvent[], type: string) {
  return events.filter((e) => e.eventType === type).length;
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
