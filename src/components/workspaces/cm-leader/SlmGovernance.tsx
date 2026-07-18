'use client';

import { useQuery } from '@tanstack/react-query';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  DataTable,
  type Column,
  Button,
  Badge,
  Card,
  CardContent,
} from '@/components/shared';
import { ComplianceDonut, SlaTrendChart } from '@/components/widgets';
import { useSlaEvents, useServices, useDemands, daysSince } from './Dashboard';
import {
  Gauge,
  AlertOctagon,
  ShieldCheck,
  FileCheck2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SlaEvent, Service, Demand } from '@/lib/types';

interface ComplianceRow {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceCustomerId: string | null;
  customerName: string;
  slaClass: string;
  total: number;
  breaches: number;
  warnings: number;
  closed: number;
  compliance: number;
}

export default function SlmGovernance() {
  const slaQ = useSlaEvents();
  const servicesQ = useServices();
  const demandsQ = useDemands();

  const slaEvents = slaQ.data ?? [];
  const services = servicesQ.data ?? [];
  const demands = demandsQ.data ?? [];

  const activeBreaches = useMemo(
    () => slaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt),
    [slaEvents],
  );
  const warnings = useMemo(
    () => slaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt),
    [slaEvents],
  );
  const closedInTime = slaEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
  const total = slaEvents.length;
  const overallCompliance = total > 0 ? Math.round((closedInTime / total) * 100) : 100;

  // Build compliance matrix
  const complianceRows = useMemo<ComplianceRow[]>(() => {
    const serviceMap = new Map(services.map((s) => [s.id, s]));
    const grouped = new Map<string, ComplianceRow>();
    for (const ev of slaEvents) {
      const key = `${ev.serviceId}|${ev.serviceCustomerId ?? 'null'}`;
      const svc = serviceMap.get(ev.serviceId);
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          serviceId: ev.serviceId,
          serviceName: ev.serviceName ?? svc?.name ?? 'Service',
          serviceCustomerId: ev.serviceCustomerId,
          customerName: '—',
          slaClass: svc?.slaClass ?? 'C',
          total: 0,
          breaches: 0,
          warnings: 0,
          closed: 0,
          compliance: 100,
        });
      }
      const row = grouped.get(key)!;
      row.total++;
      if (ev.eventType === 'BREACHED') row.breaches++;
      else if (ev.eventType === 'WARNING') row.warnings++;
      else if (ev.eventType === 'CLOSED_IN_TIME') row.closed++;
    }
    // assign customer names from demands (serviceCustomerId → name)
    const customerNameMap = new Map<string, string>();
    demands.forEach((d) => {
      if (d.serviceCustomerId && d.serviceCustomerName) {
        customerNameMap.set(d.serviceCustomerId, d.serviceCustomerName);
      }
    });
    return Array.from(grouped.values()).map((r) => {
      r.customerName = r.serviceCustomerId ? customerNameMap.get(r.serviceCustomerId) ?? 'Tenant' : 'Tenant';
      r.compliance = r.total > 0 ? Math.round((r.closed / r.total) * 100) : 100;
      return r;
    });
  }, [slaEvents, services, demands]);

  // SLA trend data — last 8 weeks (synthesized from event createdAt)
  const trendData = useMemo(() => {
    const weeks: { label: string; value: number; events: SlaEvent[] }[] = [];
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * 7 * 86400000;
      const end = now - i * 7 * 86400000;
      const inWeek = slaEvents.filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= start && t < end;
      });
      const closed = inWeek.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
      const compliance = inWeek.length > 0 ? Math.round((closed / inWeek.length) * 100) : 100;
      const label = `W${8 - i}`;
      weeks.push({ label, value: compliance, events: inWeek });
    }
    return weeks.map((w) => ({ label: w.label, value: w.value }));
  }, [slaEvents]);

  // Pending SLA reports: unresolved breaches that need CM Leader review
  const pendingReports = activeBreaches;

  const isLoading = slaQ.isLoading || servicesQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLM Governance"
        description="Review SLA compliance across the tenant. SLA reports are reviewed by you before issuance to Service Customers — breaches require your governance attention."
        icon={<Gauge className="h-5 w-5" />}
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Overall Compliance"
          value={`${overallCompliance}%`}
          hint={`${closedInTime} of ${total} events closed in time`}
          tone={overallCompliance >= 95 ? 'success' : overallCompliance >= 85 ? 'warning' : 'danger'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Active Breaches"
          value={activeBreaches.length}
          hint="Unresolved breach events"
          tone={activeBreaches.length > 0 ? 'danger' : 'success'}
          icon={<AlertOctagon className="h-4 w-4" />}
        />
        <StatCard
          label="Active Warnings"
          value={warnings.length}
          hint="Threshold approaching"
          tone={warnings.length > 0 ? 'warning' : 'success'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="Pending Report Reviews"
          value={pendingReports.length}
          hint="Reports awaiting your sign-off"
          tone={pendingReports.length > 0 ? 'warning' : 'success'}
          icon={<FileCheck2 className="h-4 w-4" />}
        />
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active breaches — prominent governance panel */}
          <div className="lg:col-span-2 space-y-6">
            <ActiveBreachesPanel
              events={activeBreaches}
              services={services}
              demands={demands}
              onReview={(ev) => {
                toast.info(`Reviewing breach on ${ev.serviceName ?? 'service'}`, {
                  description: ev.message,
                });
              }}
            />

            <ComplianceMatrix rows={complianceRows} />
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <ComplianceDonutPanel value={overallCompliance} total={total} closed={closedInTime} breaches={activeBreaches.length} />
            <SlaReportReviewPanel
              pendingReports={pendingReports}
              onApprove={(ev) => {
                toast.success('SLA report approved', {
                  description: `Report for ${ev.serviceName ?? 'service'} signed off for issuance to Service Customer.`,
                });
              }}
            />
          </div>
        </div>
      )}

      {/* SLA trend */}
      <SectionCard
        title="SLA Compliance Trend"
        description="Weekly SLA compliance percentage over the last 8 weeks."
      >
        {trendData.length === 0 ? (
          <EmptyState title="No trend data available" />
        ) : (
          <SlaTrendChart data={trendData} />
        )}
      </SectionCard>
    </div>
  );
}

function ActiveBreachesPanel({
  events,
  services,
  demands,
  onReview,
}: {
  events: SlaEvent[];
  services: Service[];
  demands: Demand[];
  onReview: (ev: SlaEvent) => void;
}) {
  const columns: Column<SlaEvent>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (e) => {
        const svc = services.find((s) => s.id === e.serviceId);
        return (
          <div className="min-w-0 max-w-[200px]">
            <div className="font-medium text-sm truncate">{e.serviceName ?? svc?.name ?? 'Service'}</div>
            {svc && (
              <div className="mt-0.5">
                <SlaClassBadge slaClass={svc.slaClass as any} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (e) => {
        const demand = demands.find((d) => d.serviceCustomerId === e.serviceCustomerId);
        return <span className="text-sm">{demand?.serviceCustomerName ?? 'Tenant'}</span>;
      },
    },
    {
      key: 'message',
      header: 'Message',
      render: (e) => <span className="text-sm text-muted-foreground line-clamp-2 max-w-[280px] block">{e.message}</span>,
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (e) => {
        const d = daysSince(e.createdAt) ?? 0;
        return (
          <Badge
            variant="outline"
            className={d > 3 ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : ''}
          >
            {d}d open
          </Badge>
        );
      },
    },
    {
      key: 'review',
      header: '',
      render: (e) => (
        <Button size="sm" variant="outline" onClick={() => onReview(e)}>
          <Eye className="h-3.5 w-3.5" /> Review
        </Button>
      ),
      className: 'text-right',
      headerClassName: 'text-right',
    },
  ];

  return (
    <SectionCard
      title="Active SLA Breaches"
      description="Unresolved breach events requiring CM Leader governance. These drive the SLA report review queue."
      actions={
        events.length > 0 && (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {events.length} active
          </Badge>
        )
      }
    >
      {events.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="No active SLA breaches"
          description="Tenant SLA posture is healthy. Breach events will appear here when they occur."
        />
      ) : (
        <DataTable columns={columns} rows={events} />
      )}
    </SectionCard>
  );
}

function ComplianceMatrix({ rows }: { rows: ComplianceRow[] }) {
  const columns: Column<ComplianceRow>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0 max-w-[200px]">
          <div className="font-medium text-sm truncate">{r.serviceName}</div>
          <div className="text-xs text-muted-foreground truncate">{r.customerName}</div>
        </div>
      ),
    },
    {
      key: 'slaClass',
      header: 'SLA Class',
      render: (r) => <SlaClassBadge slaClass={r.slaClass as any} />,
    },
    {
      key: 'total',
      header: 'Events',
      render: (r) => <span className="tabular-nums text-sm">{r.total}</span>,
    },
    {
      key: 'breaches',
      header: 'Breaches',
      render: (r) => (
        <span className={`tabular-nums text-sm ${r.breaches > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'}`}>
          {r.breaches}
        </span>
      ),
    },
    {
      key: 'warnings',
      header: 'Warnings',
      render: (r) => (
        <span className={`tabular-nums text-sm ${r.warnings > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
          {r.warnings}
        </span>
      ),
    },
    {
      key: 'closed',
      header: 'Closed in time',
      render: (r) => <span className="tabular-nums text-sm text-emerald-600 dark:text-emerald-400">{r.closed}</span>,
    },
    {
      key: 'compliance',
      header: 'Compliance',
      render: (r) => {
        const health = r.compliance >= 95 ? 'green' : r.compliance >= 85 ? 'amber' : 'red';
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${
                  health === 'green' ? 'bg-emerald-500' : health === 'amber' ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${r.compliance}%` }}
              />
            </div>
            <span className="tabular-nums text-sm font-medium w-9">{r.compliance}%</span>
          </div>
        );
      },
    },
  ];

  return (
    <SectionCard
      title="SLA Compliance Matrix"
      description="Per Service Customer × Service × SLA Class compliance breakdown."
    >
      {rows.length === 0 ? (
        <EmptyState title="No SLA events recorded" description="Compliance metrics will populate as SLA events occur." />
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
    </SectionCard>
  );
}

function ComplianceDonutPanel({
  value,
  total,
  closed,
  breaches,
}: {
  value: number;
  total: number;
  closed: number;
  breaches: number;
}) {
  const health = value >= 95 ? 'green' : value >= 85 ? 'amber' : 'red';
  return (
    <SectionCard title="Tenant Compliance" description="Overall SLA compliance across all services.">
      <div className="flex flex-col items-center py-2">
        <ComplianceDonut value={value} label="compliant" size={160} />
        <div className="mt-3">
          <SlaHealthBadge health={health} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 w-full text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-sm font-semibold tabular-nums">{total}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-2">
            <div className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{closed}</div>
            <div className="text-[10px] text-muted-foreground">Closed</div>
          </div>
          <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 p-2">
            <div className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300">{breaches}</div>
            <div className="text-[10px] text-muted-foreground">Breaches</div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function SlaReportReviewPanel({
  pendingReports,
  onApprove,
}: {
  pendingReports: SlaEvent[];
  onApprove: (ev: SlaEvent) => void;
}) {
  return (
    <SectionCard
      title="SLA Report Review"
      description="SLA reports are reviewed by you before issuance to Service Customers."
      actions={
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {pendingReports.length} pending
        </Badge>
      }
    >
      {pendingReports.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="No reports pending review"
          description="Breach-driven SLA reports awaiting your sign-off will appear here."
        />
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
          {pendingReports.map((ev) => (
            <div key={ev.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{ev.serviceName ?? 'Service'}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ev.message}</p>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Breach open <RelativeTime date={ev.createdAt} />
                  </div>
                </div>
                <Button size="sm" variant="default" className="shrink-0" onClick={() => onApprove(ev)}>
                  <FileCheck2 className="h-3.5 w-3.5" /> Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
