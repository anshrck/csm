'use client';

/**
 * CereBree uSMS — Reports & Analytics UI (Phase 10 item 23)
 *
 * Comprehensive operational report for CM Leader and Service Owner. Fetches a
 * single combined payload from /api/reports/operational (whose shape is owned
 * by the P3-SLA agent — see src/app/api/reports/_compute.ts) and renders
 * eight chart sections, each with its own [Export CSV] [Export JSON] buttons
 * that hit /api/reports/export (camelCase report keys: ticketVolume,
 * slaCompliance, avgResponseTime, avgResolutionTime, backlogAging, reopenRate,
 * csatTrend, workerWorkload, demandConversion).
 *
 * Sections:
 *   1. Ticket Volume — by priority + by type + by customer + by service
 *   2. SLA Compliance — overall % donut + per-service table
 *   3. Avg Response / Resolution Time — overall stats + per-service breakdown
 *   4. Backlog Aging — open tickets by age bucket (0-1d, 1-3d, 3-7d, 7-14d, 14d+)
 *   5. Reopen Rate — donut + stats
 *   6. CSAT Trend — line chart by ISO week
 *   7. Worker Workload — horizontal bars per SCM worker (tickets + demands)
 *   8. Demand Conversion — funnel-style progress bars from total → IN_CHANGE
 *
 * Bonus: includes a Notification Delivery oversight panel at the bottom
 * (CM Leader only) — Phase 9 item 21 oversight UI.
 *
 * Controls:
 *   - Date range preset selector (7d / 30d / 90d / custom) — refetches with
 *     computed from/to ISO date params.
 *   - Custom date pickers (visible only when range=custom).
 *
 * Role-aware:
 *   - CM_LEADER sees all tenant data.
 *   - SERVICE_OWNER sees filtered data (the API scopes to their owned services).
 */
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
  Button,
  Badge,
  UserAvatar,
  RelativeTime,
} from '@/components/shared';
import { ComplianceDonut } from '@/components/widgets';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
} from 'recharts';
import {
  BarChart3,
  Calendar,
  Download,
  FileJson,
  Filter,
  Gauge,
  Inbox,
  RefreshCw,
  Send,
  TrendingUp,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

/* ========================================================================== */
/*  Types — mirror the /api/reports/operational response shape               */
/*  (owned by the P3-SLA agent's _compute.ts)                                 */
/* ========================================================================== */

interface VolumeBucket {
  key: string | null;
  label: string;
  count: number;
}
interface SlaComplianceEntry {
  serviceId: string;
  serviceName: string | null;
  total: number;
  met: number;
  breached: number;
  compliancePct: number;
}
interface BacklogBucket {
  bucket: string;
  count: number;
}
interface CsatWeekEntry {
  week: string;
  avgRating: number;
  responses: number;
}
interface WorkerWorkloadEntry {
  workerId: string;
  workerName: string;
  activeTickets: number;
  activeDemands: number;
}
interface OperationalReport {
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
  reopenRate: { reopened: number; totalClosed: number; ratePct: number };
  csatTrend: CsatWeekEntry[];
  workerWorkload: WorkerWorkloadEntry[];
  demandConversion: { total: number; reachedInChange: number; conversionPct: number };
}

/* ========================================================================== */
/*  Auxiliary types for client-side enrichment (byType + per-service avg)    */
/* ========================================================================== */

interface TicketRow {
  id: string;
  number: string;
  type: string;
  priority: string;
  status: string;
  serviceId: string | null;
  createdAt: string;
}
interface SlaClockRow {
  id: string;
  type: 'RESPONSE' | 'RESOLUTION';
  status: 'RUNNING' | 'PAUSED' | 'MET' | 'BREACHED' | 'CANCELED';
  startedAt: string;
  metAt: string | null;
  serviceId: string | null;
  serviceName: string | null;
}

/* ========================================================================== */
/*  Notification delivery types (oversight panel)                            */
/* ========================================================================== */

interface DeliveryStats {
  byStatus: Record<string, number>;
  byChannel: Record<string, Record<string, number>>;
  total: number;
  pending: number;
  sent: number;
  failed: number;
}
interface DeliveryRow {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  notification: {
    id: string;
    userId: string;
    type: string;
    title: string;
    entityRef: string | null;
    createdAt: string;
    user: { id: string; name: string; email: string; avatarColor: string } | null;
  };
}

/* ========================================================================== */
/*  Constants                                                                 */
/* ========================================================================== */

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

// Teal/emerald palette — primary brand. Variations across sections.
const CHART_COLORS = {
  primary: 'oklch(0.6 0.13 165)',
  amber: 'oklch(0.72 0.15 75)',
  rose: 'oklch(0.62 0.22 27)',
  sky: 'oklch(0.7 0.13 230)',
  violet: 'oklch(0.62 0.18 290)',
  emerald: 'oklch(0.65 0.15 155)',
  muted: 'var(--muted-foreground)',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: CHART_COLORS.rose,
  P2: CHART_COLORS.amber,
  P3: CHART_COLORS.primary,
  P4: CHART_COLORS.sky,
};
const TYPE_COLORS: Record<string, string> = {
  INCIDENT: CHART_COLORS.rose,
  SERVICE_REQUEST: CHART_COLORS.primary,
  QUESTION: CHART_COLORS.amber,
  COMPLAINT: CHART_COLORS.violet,
};
const TYPE_LABELS: Record<string, string> = {
  INCIDENT: 'Incident',
  SERVICE_REQUEST: 'Service Request',
  QUESTION: 'Question',
  COMPLAINT: 'Complaint',
};

/* ========================================================================== */
/*  Main component                                                            */
/* ========================================================================== */

export default function Reports() {
  const { session } = useApp();
  const [range, setRange] = React.useState<string>('30d');
  const [from, setFrom] = React.useState<string>('');
  const [to, setTo] = React.useState<string>('');

  // Compute ISO date params from the preset selector. The operational endpoint
  // accepts from/to ISO date strings (no preset keyword).
  const { fromIso, toIso, params } = React.useMemo(() => {
    const now = new Date();
    const toIsoStr = now.toISOString();
    let fromIsoStr: string;
    if (range === 'custom') {
      fromIsoStr = from ? new Date(from + 'T00:00:00').toISOString() : '';
      const toFinal = to ? new Date(to + 'T23:59:59').toISOString() : toIsoStr;
      return {
        fromIso: fromIsoStr,
        toIso: toFinal,
        params: new URLSearchParams({ from: fromIsoStr, to: toFinal }).toString(),
      };
    }
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    fromIsoStr = new Date(now.getTime() - days * 86400000).toISOString();
    return {
      fromIso: fromIsoStr,
      toIso: toIsoStr,
      params: new URLSearchParams({ from: fromIsoStr, to: toIsoStr }).toString(),
    };
  }, [range, from, to]);

  const reportQ = useQuery<OperationalReport>({
    queryKey: ['reports', 'operational', params],
    queryFn: () => apiGet(`/api/reports/operational?${params}`),
    enabled: range !== 'custom' || (!!from && !!to),
  });

  // Auxiliary fetches for client-side enrichment:
  //   1. /api/tickets → to compute the by-type breakdown (the operational
  //      endpoint exposes byCustomer/byService/byPriority but not byType).
  //   2. /api/sla-clocks → to compute per-service response/resolution time
  //      (the operational endpoint exposes only tenant-wide averages).
  const ticketsQ = useQuery<TicketRow[]>({
    queryKey: ['reports', 'tickets', params],
    queryFn: async () => {
      const all = await apiGet<TicketRow[]>(
        `/api/tickets?limit=500&sort=recent`,
      );
      // Filter client-side to the report window (the tickets API doesn't
      // accept a from/to filter directly).
      const fromMs = new Date(fromIso).getTime();
      const toMs = new Date(toIso).getTime();
      return all.filter((t) => {
        const c = new Date(t.createdAt).getTime();
        return c >= fromMs && c <= toMs;
      });
    },
    enabled: reportQ.isSuccess,
  });

  const clocksQ = useQuery<SlaClockRow[]>({
    queryKey: ['reports', 'sla-clocks', params],
    queryFn: async () => {
      const all = await apiGet<SlaClockRow[]>(`/api/sla-clocks?status=MET,BREACHED`);
      const fromMs = new Date(fromIso).getTime();
      const toMs = new Date(toIso).getTime();
      return all.filter((c) => {
        const s = new Date(c.startedAt).getTime();
        return s >= fromMs && s <= toMs;
      });
    },
    enabled: reportQ.isSuccess,
  });

  const report = reportQ.data;
  const tickets = ticketsQ.data ?? [];
  const clocks = clocksQ.data ?? [];
  const isLoading = reportQ.isLoading;

  // ---- Client-side derived: by-type ticket breakdown ----
  const byType = React.useMemo(() => {
    const counts: Record<string, number> = {
      INCIDENT: 0,
      SERVICE_REQUEST: 0,
      QUESTION: 0,
      COMPLAINT: 0,
    };
    for (const t of tickets) {
      if (counts[t.type] !== undefined) counts[t.type]++;
    }
    return Object.entries(counts).map(([k, v]) => ({
      key: k,
      label: TYPE_LABELS[k] ?? k,
      value: v,
    }));
  }, [tickets]);

  // ---- Client-side derived: per-service response / resolution avg ----
  const perServiceAvg = React.useMemo(() => {
    const map = new Map<
      string,
      {
        serviceName: string;
        responseSum: number;
        responseCount: number;
        resolutionSum: number;
        resolutionCount: number;
        met: number;
        breached: number;
      }
    >();
    for (const c of clocks) {
      if (!c.serviceId) continue;
      let entry = map.get(c.serviceId);
      if (!entry) {
        entry = {
          serviceName: c.serviceName ?? 'Unknown',
          responseSum: 0,
          responseCount: 0,
          resolutionSum: 0,
          resolutionCount: 0,
          met: 0,
          breached: 0,
        };
        map.set(c.serviceId, entry);
      }
      if (c.status === 'MET') {
        entry.met++;
        if (c.metAt && c.startedAt) {
          const mins = (new Date(c.metAt).getTime() - new Date(c.startedAt).getTime()) / 60000;
          if (mins >= 0) {
            if (c.type === 'RESPONSE') {
              entry.responseSum += mins;
              entry.responseCount++;
            } else if (c.type === 'RESOLUTION') {
              entry.resolutionSum += mins;
              entry.resolutionCount++;
            }
          }
        }
      } else if (c.status === 'BREACHED') {
        entry.breached++;
      }
    }
    return Array.from(map.entries())
      .map(([serviceId, e]) => ({
        serviceId,
        serviceName: e.serviceName,
        responseAvgMins: e.responseCount > 0 ? Math.round((e.responseSum / e.responseCount) * 10) / 10 : null,
        resolutionAvgMins: e.resolutionCount > 0 ? Math.round((e.resolutionSum / e.resolutionCount) * 10) / 10 : null,
        met: e.met,
        breached: e.breached,
      }))
      .sort((a, b) => (b.met + b.breached) - (a.met + a.breached));
  }, [clocks]);

  // ---- Client-side derived: overall SLA compliance % ----
  const overallSla = React.useMemo(() => {
    const total = report?.slaCompliance.reduce((a, s) => a + s.total, 0) ?? 0;
    const met = report?.slaCompliance.reduce((a, s) => a + s.met, 0) ?? 0;
    return total > 0 ? Math.round((met / total) * 1000) / 10 : 100;
  }, [report]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Reports"
        description="Tenant-wide operational analytics: ticket volume, SLA compliance, backlog aging, CSAT, demand conversion, and worker workload. Export any section as CSV or JSON."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Date range
              </label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="h-9 w-[160px] text-sm">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {range === 'custom' && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    From
                  </label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9 w-[150px] text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    To
                  </label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9 w-[150px] text-sm"
                  />
                </div>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => {
                reportQ.refetch();
                ticketsQ.refetch();
                clocksQ.refetch();
              }}
              disabled={reportQ.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${reportQ.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Scope + range banner */}
      {report && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            <span className="font-medium text-foreground">{range === 'custom' ? 'Custom' : RANGE_OPTIONS.find((o) => o.value === range)?.label}</span>{' '}
            {new Date(fromIso).toLocaleDateString()} → {new Date(toIso).toLocaleDateString()}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <Filter className="h-3.5 w-3.5" />
          <span>
            Scope:{' '}
            <span className="font-medium text-foreground">
              {session?.role === 'SERVICE_OWNER' ? 'Owned services' : 'All tenant'}
            </span>
          </span>
        </div>
      )}

      {isLoading || !report ? (
        <LoadingState rows={6} />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Tickets in window"
              value={report.ticketVolume.byPriority.reduce((a, b) => a + b.count, 0)}
              hint="By creation date"
              icon={<Inbox className="h-4 w-4" />}
              tone="default"
            />
            <StatCard
              label="SLA Compliance"
              value={`${overallSla}%`}
              hint={`${report.slaCompliance.reduce((a, s) => a + s.met, 0)} met / ${report.slaCompliance.reduce((a, s) => a + s.breached, 0)} breached`}
              tone={overallSla >= 95 ? 'success' : overallSla >= 85 ? 'warning' : 'danger'}
              icon={<Gauge className="h-4 w-4" />}
            />
            <StatCard
              label="Reopen Rate"
              value={`${report.reopenRate.ratePct}%`}
              hint={`${report.reopenRate.reopened} of ${report.reopenRate.totalClosed} closed`}
              tone={report.reopenRate.ratePct > 10 ? 'warning' : 'default'}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <StatCard
              label="Demand Conversion"
              value={`${report.demandConversion.conversionPct}%`}
              hint={`${report.demandConversion.reachedInChange} of ${report.demandConversion.total} demands reached IN_CHANGE+`}
              tone="success"
              icon={<TrendingUp className="h-4 w-4" />}
            />
          </div>

          {/* Section 1: Ticket volume */}
          <SectionCard
            title="Ticket Volume"
            description="Tickets created in the window — by priority, type, customer, and service."
            actions={<ExportButtons reportKeys={['ticketVolume']} params={params} />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <VolumeChart
                title="By Priority"
                data={report.ticketVolume.byPriority.map((b) => ({ label: b.label, value: b.count }))}
                colorMap={PRIORITY_COLORS}
              />
              <VolumeChart
                title="By Type"
                data={byType.map((b) => ({ label: b.label, value: b.value }))}
                colorMap={Object.fromEntries(
                  byType.map((b) => [b.label, TYPE_COLORS[b.key] ?? CHART_COLORS.primary]),
                )}
              />
              <VolumeChart
                title="By Customer"
                data={report.ticketVolume.byCustomer.map((b) => ({ label: b.label, value: b.count }))}
              />
              <VolumeChart
                title="By Service"
                data={report.ticketVolume.byService.map((b) => ({ label: b.label, value: b.count }))}
              />
            </div>
          </SectionCard>

          {/* Section 2: SLA compliance */}
          <SectionCard
            title="SLA Compliance"
            description="Overall compliance % and per-service breakdown (MET vs BREACHED across response + resolution clocks)."
            actions={<ExportButtons reportKeys={['slaCompliance']} params={params} />}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="flex flex-col items-center justify-center py-2">
                <ComplianceDonut value={overallSla} label="overall compliance" size={170} />
                <div className="mt-3 text-xs text-muted-foreground">
                  {report.slaCompliance.reduce((a, s) => a + s.met, 0)} met ·{' '}
                  {report.slaCompliance.reduce((a, s) => a + s.breached, 0)} breached
                </div>
              </div>
              <div className="lg:col-span-2">
                {report.slaCompliance.length === 0 ? (
                  <EmptyState
                    icon={<Gauge className="h-8 w-8 text-muted-foreground/40" />}
                    title="No SLA data in window"
                    description="SLA clock records will appear here once tickets have been created."
                  />
                ) : (
                  <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Service</th>
                          <th className="text-right font-medium text-muted-foreground px-4 py-2.5">Total</th>
                          <th className="text-right font-medium text-muted-foreground px-4 py-2.5">Met</th>
                          <th className="text-right font-medium text-muted-foreground px-4 py-2.5">Breached</th>
                          <th className="text-right font-medium text-muted-foreground px-4 py-2.5">Compliance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.slaCompliance.map((s) => (
                          <tr key={s.serviceId} className="border-t">
                            <td className="px-4 py-3 font-medium truncate max-w-[220px]">
                              {s.serviceName ?? 'Unknown'}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{s.total}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{s.met}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">{s.breached}</td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={`tabular-nums font-semibold ${
                                  s.compliancePct >= 95
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : s.compliancePct >= 85
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {s.compliancePct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          {/* Section 3: Avg response / resolution time */}
          <SectionCard
            title="Average Response & Resolution Time"
            description="Tenant-wide averages + per-service breakdown (minutes, MET clocks only)."
            actions={
              <ExportButtons reportKeys={['avgResponseTime', 'avgResolutionTime']} params={params} />
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-4">
              <StatCard
                label="Avg Response Time"
                value={report.avgResponseTimeMins != null ? `${report.avgResponseTimeMins}m` : '—'}
                hint="Across all MET response clocks"
                icon={<Clock className="h-4 w-4" />}
                tone="default"
              />
              <StatCard
                label="Avg Resolution Time"
                value={report.avgResolutionTimeMins != null ? `${report.avgResolutionTimeMins}m` : '—'}
                hint="Across all MET resolution clocks"
                icon={<CheckCircle2 className="h-4 w-4" />}
                tone="default"
              />
              <StatCard
                label="Services with SLA data"
                value={perServiceAvg.length}
                hint="Per-service breakdown below"
                icon={<Gauge className="h-4 w-4" />}
                tone="default"
              />
            </div>
            {perServiceAvg.length === 0 ? (
              <ChartEmpty />
            ) : (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={perServiceAvg.map((s) => ({
                      label: (s.serviceName ?? 'Unknown').length > 22 ? (s.serviceName ?? '').slice(0, 20) + '…' : s.serviceName,
                      responseAvgMins: s.responseAvgMins ?? 0,
                      resolutionAvgMins: s.resolutionAvgMins ?? 0,
                    }))}
                    margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={56}
                      dy={6}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      width={48}
                      tickFormatter={(v: number) => `${v}m`}
                    />
                    <Tooltip
                      content={({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string; color?: string }>; label?: string | number }) =>
                        active && payload && payload.length > 0 ? (
                          <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="font-medium">{label}</p>
                            {payload.map((p, i) => (
                              <p key={i} className="mt-0.5 tabular-nums" style={{ color: p.color }}>
                                {p.name}: {Number(p.value ?? 0).toFixed(1)}m
                              </p>
                            ))}
                          </div>
                        ) : null
                      }
                      cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="responseAvgMins" name="Response" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar dataKey="resolutionAvgMins" name="Resolution" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* Section 4: Backlog aging */}
          <SectionCard
            title="Backlog Aging"
            description="Currently-open tickets grouped by age since creation."
            actions={<ExportButtons reportKeys={['backlogAging']} params={params} />}
          >
            {report.backlogAging.every((b) => b.count === 0) ? (
              <ChartEmpty description="No open tickets in the current backlog." />
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={report.backlogAging.map((b) => ({ label: b.bucket, value: b.count }))}
                    margin={{ top: 8, right: 16, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} allowDecimals={false} width={36} />
                    <Tooltip
                      content={({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string }>; label?: string | number }) =>
                        active && payload && payload.length > 0 ? (
                          <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="font-medium">{label}</p>
                            <p className="mt-0.5 tabular-nums font-semibold">{payload[0].value ?? 0} tickets</p>
                          </div>
                        ) : null
                      }
                      cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                    />
                    <Bar dataKey="value" name="Open tickets" radius={[4, 4, 0, 0]} maxBarSize={64}>
                      {report.backlogAging.map((b, i) => {
                        const colors = [CHART_COLORS.emerald, CHART_COLORS.primary, CHART_COLORS.amber, CHART_COLORS.rose, 'oklch(0.5 0.2 27)'];
                        return <Cell key={b.bucket} fill={colors[i] ?? CHART_COLORS.primary} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* Section 5: Reopen rate */}
          <SectionCard
            title="Reopen Rate"
            description="Tickets that were reopened after being marked resolved/closed, as a share of all closed tickets."
            actions={<ExportButtons reportKeys={['reopenRate']} params={params} />}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="flex flex-col items-center justify-center py-2">
                <ComplianceDonut value={report.reopenRate.ratePct} label="reopen rate" size={150} />
              </div>
              <div className="md:col-span-2 grid grid-cols-3 gap-3">
                <StatCard
                  label="Reopened"
                  value={report.reopenRate.reopened}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  tone={report.reopenRate.reopened > 0 ? 'warning' : 'success'}
                />
                <StatCard
                  label="Total Closed"
                  value={report.reopenRate.totalClosed}
                  icon={<Inbox className="h-4 w-4" />}
                />
                <StatCard
                  label="Reopen Rate"
                  value={`${report.reopenRate.ratePct}%`}
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone={report.reopenRate.ratePct > 10 ? 'warning' : 'default'}
                />
              </div>
            </div>
          </SectionCard>

          {/* Section 6: CSAT trend */}
          <SectionCard
            title="CSAT Trend"
            description="Average customer satisfaction rating per ISO week (1–5 scale)."
            actions={<ExportButtons reportKeys={['csatTrend']} params={params} />}
          >
            {report.csatTrend.length === 0 ? (
              <ChartEmpty description="CSAT ratings will appear here once customers complete satisfaction surveys." />
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={report.csatTrend.map((c) => ({ label: c.week, value: c.avgRating, samples: c.responses }))}
                    margin={{ top: 8, right: 16, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                    <YAxis domain={[0, 5]} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} width={36} tickFormatter={(v: number) => `${v}★`} />
                    <Tooltip
                      content={({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string; payload?: { samples?: number } }>; label?: string | number }) =>
                        active && payload && payload.length > 0 ? (
                          <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="font-medium">{label}</p>
                            <p className="mt-0.5 tabular-nums font-semibold">
                              {payload[0].value != null ? `${Number(payload[0].value).toFixed(2)}★` : 'No ratings'}
                            </p>
                            <p className="mt-0.5 text-muted-foreground">
                              {payload[0].payload?.samples ?? 0} response(s)
                            </p>
                          </div>
                        ) : null
                      }
                      cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Avg rating"
                      stroke={CHART_COLORS.primary}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART_COLORS.primary, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: CHART_COLORS.primary, stroke: 'var(--background)', strokeWidth: 2 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* Section 7: Worker workload */}
          <SectionCard
            title="Worker Workload"
            description="Active tickets + active demands per SCM worker."
            actions={<ExportButtons reportKeys={['workerWorkload']} params={params} />}
          >
            {report.workerWorkload.length === 0 ? (
              <EmptyState
                icon={<Users className="h-8 w-8 text-muted-foreground/40" />}
                title="No active workers"
                description="No SCM workers have active tickets or demands."
              />
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-thin">
                {report.workerWorkload.map((w) => {
                  const maxTickets = Math.max(...report.workerWorkload.map((x) => x.activeTickets), 1);
                  const maxDemands = Math.max(...report.workerWorkload.map((x) => x.activeDemands), 1);
                  return (
                    <div key={w.workerId} className="py-1">
                      <div className="flex items-center gap-3 mb-2">
                        <UserAvatar name={w.workerName} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium truncate">{w.workerName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {w.activeTickets} tickets · {w.activeDemands} demands
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pl-10">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Tickets</div>
                          <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${(w.activeTickets / maxTickets) * 100}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Demands</div>
                          <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-500 transition-all"
                              style={{ width: `${(w.activeDemands / maxDemands) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Section 8: Demand conversion funnel */}
          <SectionCard
            title="Demand Conversion"
            description="Demands created in the window vs. those that reached the IN_CHANGE stage or beyond (the demand-to-change conversion gate)."
            actions={<ExportButtons reportKeys={['demandConversion']} params={params} />}
          >
            {report.demandConversion.total === 0 ? (
              <ChartEmpty description="No demands were created in the selected window." />
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    label="Demands Created"
                    value={report.demandConversion.total}
                    icon={<Inbox className="h-4 w-4" />}
                    tone="default"
                  />
                  <StatCard
                    label="Reached IN_CHANGE+"
                    value={report.demandConversion.reachedInChange}
                    icon={<TrendingUp className="h-4 w-4" />}
                    tone="success"
                  />
                  <StatCard
                    label="Conversion Rate"
                    value={`${report.demandConversion.conversionPct}%`}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone={report.demandConversion.conversionPct >= 50 ? 'success' : 'warning'}
                  />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Funnel
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Demands created', value: report.demandConversion.total, color: CHART_COLORS.sky },
                      { label: 'Reached IN_CHANGE+', value: report.demandConversion.reachedInChange, color: CHART_COLORS.emerald },
                      { label: 'Conversion gap', value: Math.max(0, report.demandConversion.total - report.demandConversion.reachedInChange), color: CHART_COLORS.amber },
                    ].map((stage, i) => {
                      const max = report.demandConversion.total || 1;
                      const pct = (stage.value / max) * 100;
                      return (
                        <div key={i}>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-sm font-medium">{stage.label}</span>
                            <span className="text-sm font-semibold tabular-nums">{stage.value}</span>
                          </div>
                          <div className="h-6 rounded-md bg-muted/60 overflow-hidden">
                            <div
                              className="h-full rounded-md transition-all"
                              style={{
                                width: `${Math.max(pct, 2)}%`,
                                backgroundColor: stage.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Notification Delivery oversight (CM_LEADER only) */}
          {session?.role === 'CM_LEADER' && <NotificationDeliveryOversight />}
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Sub-component: per-section export buttons                                 */
/* ========================================================================== */

function ExportButtons({ reportKeys, params }: { reportKeys: string[]; params: string }) {
  const [downloading, setDownloading] = React.useState<string | null>(null);

  async function handleExport(format: 'csv' | 'json') {
    for (const rk of reportKeys) {
      setDownloading(`${rk}:${format}`);
      try {
        const url = `/api/reports/export?${params}&format=${format}&report=${rk}`;
        if (format === 'csv') {
          const res = await fetch(url, { credentials: 'same-origin' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `Export failed: ${res.status}` }));
            throw new Error(err.error ?? `Export failed: ${res.status}`);
          }
          const blob = await res.blob();
          const disposition = res.headers.get('Content-Disposition') ?? '';
          const filenameMatch = disposition.match(/filename="([^"]+)"/);
          const filename = filenameMatch?.[1] ?? `${rk}.csv`;
          const objUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(objUrl);
        } else {
          // JSON → open in a new tab so the user can inspect/copy/save.
          window.open(url, '_blank', 'noopener');
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Export failed');
      } finally {
        setDownloading(null);
      }
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => handleExport('csv')}
        disabled={downloading !== null}
      >
        {downloading?.endsWith(':csv') ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => handleExport('json')}
        disabled={downloading !== null}
      >
        {downloading?.endsWith(':json') ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <FileJson className="h-3 w-3" />
        )}
        JSON
      </Button>
    </div>
  );
}

/* ========================================================================== */
/*  Sub-component: volume chart (reusable for by-priority / type / etc.)     */
/* ========================================================================== */

function VolumeChart({
  title,
  data,
  colorMap,
}: {
  title: string;
  data: { label: string; value: number }[];
  colorMap?: Record<string, string>;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </div>
      {data.every((b) => b.value === 0) ? (
        <ChartEmpty />
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                interval={0}
                angle={data.length > 4 ? -15 : 0}
                textAnchor={data.length > 4 ? 'end' : 'middle'}
                height={data.length > 4 ? 50 : 24}
                dy={data.length > 4 ? 6 : 8}
              />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} allowDecimals={false} width={36} />
              <Tooltip
                content={({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string }>; label?: string | number }) =>
                  active && payload && payload.length > 0 ? (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="font-medium">{label}</p>
                      <p className="mt-0.5 tabular-nums font-semibold">{payload[0].value ?? 0}</p>
                    </div>
                  ) : null
                }
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {data.map((b) => (
                  <Cell key={b.label} fill={colorMap?.[b.label] ?? CHART_COLORS.primary} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Sub-component: Notification Delivery oversight (CM_LEADER only)         */
/* ========================================================================== */

function NotificationDeliveryOversight() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<string>('ALL');

  const statsQ = useQuery<DeliveryStats>({
    queryKey: ['notification-deliveries', 'stats'],
    queryFn: () => apiGet('/api/notification-deliveries?stats=1'),
    staleTime: 15_000,
  });

  const rowsQ = useQuery<DeliveryRow[]>({
    queryKey: ['notification-deliveries', 'list', filter],
    queryFn: () => {
      const q = filter === 'ALL' ? '' : `?status=${filter}`;
      return apiGet<DeliveryRow[]>(`/api/notification-deliveries${q}`);
    },
    staleTime: 15_000,
  });

  const processMutation = useMutation({
    mutationFn: () =>
      apiPost<{
        ok: boolean;
        message: string;
        processed: number;
        sent: number;
        failed: number;
        skipped: number;
      }>('/api/notification-deliveries/process'),
    onSuccess: (data) => {
      toast.success(data.message ?? `Processed ${data.processed} deliveries`);
      qc.invalidateQueries({ queryKey: ['notification-deliveries'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to process deliveries'),
  });

  const stats = statsQ.data;
  const rows = rowsQ.data ?? [];

  return (
    <SectionCard
      title="Notification Delivery Oversight"
      description="Audit trail of every notification delivery across the tenant. The in-app PORTAL channel always succeeds; EMAIL/TEAMS/SLACK are simulated with a 5% failure rate."
      actions={
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1"
          onClick={() => processMutation.mutate()}
          disabled={processMutation.isPending}
        >
          {processMutation.isPending ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Flush pending now
        </Button>
      }
    >
      {/* Stats row */}
      {statsQ.isLoading ? (
        <LoadingState rows={2} />
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="Pending"
              value={stats.pending}
              icon={<Clock className="h-4 w-4" />}
              tone={stats.pending > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Sent"
              value={stats.sent}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
            />
            <StatCard
              label="Failed"
              value={stats.failed}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={stats.failed > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="Total deliveries"
              value={stats.total}
              icon={<Send className="h-4 w-4" />}
            />
          </div>

          {/* Per-channel breakdown */}
          {Object.keys(stats.byChannel).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {Object.entries(stats.byChannel).map(([ch, statusCounts]) => (
                <div key={ch} className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{ch}</div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    {Object.values(statusCounts).reduce((a, b) => a + b, 0)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {Object.entries(statusCounts).map(([st, n]) => (
                      <span
                        key={st}
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 tabular-nums ${
                          st === 'SENT'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : st === 'FAILED'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {st}: {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Filter + recent deliveries table */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['notification-deliveries'] });
          }}
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {rowsQ.isLoading ? (
        <LoadingState rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Send className="h-8 w-8 text-muted-foreground/40" />}
          title="No deliveries"
          description="No notification delivery records match the current filter."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            {
              key: 'channel',
              header: 'Channel',
              render: (r) => (
                <Badge variant="outline" className="text-[10px]">
                  {r.channel}
                </Badge>
              ),
              headerClassName: 'w-[100px]',
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <Badge
                  variant="outline"
                  className={
                    r.status === 'SENT'
                      ? 'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                      : r.status === 'FAILED'
                        ? 'text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                        : 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
                  }
                >
                  {r.status}
                </Badge>
              ),
              headerClassName: 'w-[90px]',
            },
            {
              key: 'notification',
              header: 'Notification',
              render: (r) => (
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.notification.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.notification.type}
                    {r.notification.entityRef ? ` · ${r.notification.entityRef}` : ''}
                  </div>
                  {r.error && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5 line-clamp-1">
                      ⚠ {r.error}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'user',
              header: 'Recipient',
              render: (r) =>
                r.notification.user ? (
                  <div className="flex items-center gap-2 min-w-[160px]">
                    <UserAvatar name={r.notification.user.name} color={r.notification.user.avatarColor} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.notification.user.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.notification.user.email}</div>
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'time',
              header: 'Created',
              render: (r) => <RelativeTime date={r.createdAt} className="text-xs text-muted-foreground" />,
              headerClassName: 'w-[110px]',
            },
          ]}
        />
      )}
    </SectionCard>
  );
}

/* ========================================================================== */
/*  Helper: empty chart placeholder                                           */
/* ========================================================================== */

function ChartEmpty({ description }: { description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center rounded-lg border border-dashed">
      <BarChart3 className="h-7 w-7 text-muted-foreground/40 mb-2" />
      <p className="text-sm font-medium text-muted-foreground">No data in window</p>
      {description && <p className="mt-1 text-xs text-muted-foreground/70 max-w-sm">{description}</p>}
    </div>
  );
}
