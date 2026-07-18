'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  Gauge,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  CalendarDays,
  Activity,
  TrendingUp,
  Filter,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import {
  type Service,
  type SlaEvent,
  type SlaHealth,
} from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  SlaClassBadge,
  SlaHealthBadge,
  EmptyState,
  LoadingState,
  Badge,
} from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SlaEventType = 'WARNING' | 'BREACHED' | 'CLOSED_IN_TIME';

const eventBadgeStyles: Record<SlaEventType, string> = {
  WARNING: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  BREACHED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  CLOSED_IN_TIME: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
};

const eventLabels: Record<SlaEventType, string> = {
  WARNING: 'Warning',
  BREACHED: 'Breached',
  CLOSED_IN_TIME: 'Closed in time',
};

export default function SlaPerformance() {
  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });
  const eventsQ = useQuery({
    queryKey: ['sla-events'],
    queryFn: () => apiGet<SlaEvent[]>('/api/sla-events'),
  });

  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');

  const services = servicesQ.data ?? [];
  const events = eventsQ.data ?? [];

  // Compute per-service stats
  const serviceStats = useMemo(() => {
    return services.map((s) => {
      const svcEvents = events.filter((e) => e.serviceId === s.id);
      const breaches = svcEvents.filter((e) => e.eventType === 'BREACHED').length;
      const warnings = svcEvents.filter((e) => e.eventType === 'WARNING').length;
      const closed = svcEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
      const total = svcEvents.length;
      const compliance = total === 0 ? 100 : Math.round((closed / total) * 100);
      let health: SlaHealth = 'green';
      if (breaches > 0) health = 'red';
      else if (warnings > 0) health = 'amber';
      return {
        service: s,
        breaches,
        warnings,
        closed,
        total,
        compliance,
        health,
      };
    });
  }, [services, events]);

  // Trend: monthly compliance over the last 6 months (synthesized from events)
  const trendData = useMemo(() => {
    const now = new Date();
    const months: { label: string; value: number; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthEvents = events.filter((e) => {
        const ed = new Date(e.createdAt);
        return ed >= d && ed < next;
      });
      const closed = monthEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
      const total = monthEvents.length;
      const value = total === 0 ? 100 : Math.round((closed / total) * 100);
      months.push({
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        value,
        total,
      });
    }
    return months;
  }, [events]);

  // Filtered event timeline
  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => (serviceFilter === 'ALL' ? true : e.serviceId === serviceFilter))
      .filter((e) => (dateFilter ? e.createdAt.slice(0, 10) === dateFilter : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [events, serviceFilter, dateFilter]);

  const totalBreaches = events.filter((e) => e.eventType === 'BREACHED').length;
  const totalWarnings = events.filter((e) => e.eventType === 'WARNING').length;
  const totalClosed = events.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
  const overallCompliance =
    events.length === 0 ? 100 : Math.round((totalClosed / events.length) * 100);

  return (
    <div className="space-y-5">
      <PageHeader
        title="SLA Performance"
        description="Service-level commitments and event history across your entitled services."
        icon={<Gauge className="h-5 w-5" />}
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatTile
          label="Overall Compliance"
          value={`${overallCompliance}%`}
          tone={overallCompliance >= 95 ? 'success' : overallCompliance >= 80 ? 'warning' : 'danger'}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatTile
          label="Closed in Time"
          value={totalClosed}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatTile
          label="Warnings"
          value={totalWarnings}
          tone={totalWarnings > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatTile
          label="Breaches"
          value={totalBreaches}
          tone={totalBreaches > 0 ? 'danger' : 'default'}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      {/* Trend chart */}
      <SectionCard
        title="Compliance Trend"
        description="Monthly SLA compliance synthesized from closed-in-time vs total events."
        actions={<Badge variant="outline" className="gap-1"><Activity className="h-3 w-3" /> Last 6 months</Badge>}
      >
        {eventsQ.isLoading ? (
          <LoadingState rows={2} />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name, item) => [
                    `${value}% compliance`,
                    `${(item.payload as { total: number }).total} event(s)`,
                  ]}
                />
                <ReferenceLine y={95} stroke="var(--primary)" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={{ fill: 'var(--primary)', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {/* Per-service summary table */}
      <SectionCard
        title="Service SLA Summary"
        description="Commitment targets and current compliance per entitled service."
      >
        {servicesQ.isLoading ? (
          <LoadingState rows={4} />
        ) : serviceStats.length === 0 ? (
          <EmptyState
            icon={<Gauge className="h-8 w-8" />}
            title="No entitled services"
            description="Your organisation has no active service entitlements yet."
          />
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Service</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">SLA Class</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Availability Target</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Compliance</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">P1 Response</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">P1 Resolution</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceStats.map((row) => (
                    <tr key={row.service.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium truncate max-w-[260px]">{row.service.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.total} event{row.total === 1 ? '' : 's'} tracked
                        </div>
                      </td>
                      <td className="px-4 py-3"><SlaClassBadge slaClass={row.service.slaClass} /></td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.service.slaProfile ? `${row.service.slaProfile.availabilityTarget}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          'font-semibold tabular-nums',
                          row.compliance >= 95 ? 'text-emerald-600 dark:text-emerald-400'
                            : row.compliance >= 80 ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400',
                        )}>
                          {row.compliance}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {row.service.slaProfile ? `${row.service.slaProfile.p1ResponseMins} min` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {row.service.slaProfile ? formatMins(row.service.slaProfile.p1ResolutionMins) : '—'}
                      </td>
                      <td className="px-4 py-3"><SlaHealthBadge health={row.health} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Event timeline */}
      <SectionCard
        title="SLA Event Timeline"
        description="Chronological log of SLA warnings, breaches, and in-time closures."
        actions={
          <Badge variant="outline" className="gap-1">
            <Filter className="h-3 w-3" /> {filteredEvents.length} of {events.length}
          </Badge>
        }
      >
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All services</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            {(serviceFilter !== 'ALL' || dateFilter) && (
              <button
                onClick={() => { setServiceFilter('ALL'); setDateFilter(''); }}
                className="text-xs text-muted-foreground hover:text-foreground px-2"
              >
                Clear
              </button>
            )}
          </div>

          {eventsQ.isLoading ? (
            <LoadingState rows={4} />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title={events.length === 0 ? 'No SLA events recorded' : 'No matching events'}
              description={
                events.length === 0
                  ? 'Your services have not generated any SLA warnings or breaches. That is a good thing.'
                  : 'Adjust the filters above.'
              }
            />
          ) : (
            <ol className="relative space-y-3 max-h-[480px] overflow-y-auto scrollbar-thin pr-1">
              {filteredEvents.map((e, i) => {
                const type = e.eventType as SlaEventType;
                const svc = services.find((s) => s.id === e.serviceId);
                return (
                  <li key={e.id} className="relative flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn('h-2.5 w-2.5 rounded-full mt-1.5', dotColor(type))} />
                      {i < filteredEvents.length - 1 && <div className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="flex-1 pb-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', eventBadgeStyles[type])}>
                          {eventLabels[type]}
                        </Badge>
                        <span className="text-sm font-medium truncate">
                          {e.serviceName ?? svc?.name ?? 'Service'}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {new Date(e.createdAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{e.message}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  icon?: React.ReactNode;
}) {
  const toneCls = {
    default: 'border-border',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  const valueCls = {
    default: 'text-foreground',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-rose-600 dark:text-rose-400',
    success: 'text-emerald-600 dark:text-emerald-400',
  }[tone];
  return (
    <div className={cn('rounded-lg border bg-card p-4', toneCls)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', valueCls)}>{value}</div>
    </div>
  );
}

function dotColor(type: SlaEventType): string {
  return {
    WARNING: 'bg-amber-500',
    BREACHED: 'bg-rose-500',
    CLOSED_IN_TIME: 'bg-emerald-500',
  }[type];
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
