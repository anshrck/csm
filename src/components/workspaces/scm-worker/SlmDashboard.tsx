'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  Button,
  Card,
  CardContent,
  Badge,
  DataTable,
  type Column,
} from '@/components/shared';
import { SlaTrendChart } from '@/components/widgets';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Gauge,
  AlertTriangle,
  Megaphone,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import type { SlaEvent, Service, SlaClass } from '@/lib/types';

interface ComplianceRow {
  id: string;
  serviceName: string;
  slaClass: SlaClass;
  total: number;
  closedInTime: number;
  breaches: number;
  warnings: number;
  compliance: number | null; // null = no events
}

export default function SlmDashboard() {
  const { data: slaEvents, isLoading } = useQuery<SlaEvent[]>({
    queryKey: ['sla-events'],
    queryFn: () => apiGet('/api/sla-events'),
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  const serviceMap = React.useMemo(() => {
    const m = new Map<string, Service>();
    (services ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);

  const complianceRows: ComplianceRow[] = React.useMemo(() => {
    const byService = new Map<string, { closed: number; breaches: number; warnings: number }>();
    for (const e of slaEvents ?? []) {
      const cur = byService.get(e.serviceId) ?? { closed: 0, breaches: 0, warnings: 0 };
      if (e.eventType === 'CLOSED_IN_TIME') cur.closed += 1;
      if (e.eventType === 'BREACHED') cur.breaches += 1;
      if (e.eventType === 'WARNING') cur.warnings += 1;
      byService.set(e.serviceId, cur);
    }
    return Array.from(byService.entries()).map(([sid, counts]) => {
      const svc = serviceMap.get(sid);
      const total = counts.closed + counts.breaches;
      const compliance = total === 0 ? null : Math.round((counts.closed / total) * 100);
      return {
        id: sid,
        serviceName: svc?.name ?? 'Unknown service',
        slaClass: (svc?.slaClass ?? 'C') as SlaClass,
        total,
        closedInTime: counts.closed,
        breaches: counts.breaches,
        warnings: counts.warnings,
        compliance,
      };
    }).sort((a, b) => a.compliance ?? 200 - (b.compliance ?? 200));
  }, [slaEvents, serviceMap]);

  const breaches = (slaEvents ?? []).filter((e) => e.eventType === 'BREACHED');
  const warnings = (slaEvents ?? []).filter((e) => e.eventType === 'WARNING');

  // Synthetic monthly compliance trend (last 6 months)
  const trendData = React.useMemo(() => {
    const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.map((label, i) => ({
      label,
      value: Math.round((92 + Math.sin(i * 0.9) * 4 + (i === 4 ? -8 : 0) + (i === 2 ? 3 : 0)) * 10) / 10,
    }));
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="SLM Dashboard"
        description="SLA governance view across your customer scope. Monitor compliance, breaches, and trends."
        icon={<Gauge className="h-5 w-5" />}
      />

      {/* Top stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Services Monitored"
          value={complianceRows.length}
          tone="default"
        />
        <SummaryTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Active Breaches"
          value={breaches.length}
          tone="danger"
        />
        <SummaryTile
          icon={<Clock className="h-4 w-4" />}
          label="Active Warnings"
          value={warnings.length}
          tone="warning"
        />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Compliance"
          value={
            complianceRows.length === 0
              ? '—'
              : `${Math.round(
                  complianceRows
                    .filter((r) => r.compliance !== null)
                    .reduce((sum, r) => sum + (r.compliance ?? 0), 0) /
                    Math.max(1, complianceRows.filter((r) => r.compliance !== null).length),
                )}%`
          }
          tone="success"
        />
      </div>

      {/* Compliance summary + trend */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="SLA Compliance Summary"
            description="Compliance = closed-in-time / (closed-in-time + breaches). Warnings are advisory only."
          >
            {isLoading ? (
              <LoadingState rows={5} />
            ) : complianceRows.length === 0 ? (
              <EmptyState
                icon={<Gauge className="h-7 w-7" />}
                title="No SLA events recorded"
                description="Compliance metrics will appear once events are captured."
              />
            ) : (
              <DataTable
                columns={complianceColumns}
                rows={complianceRows}
              />
            )}
          </SectionCard>
        </div>
        <SectionCard
          title="Compliance Trend"
          description="Last 6 months (rolling)"
        >
          <SlaTrendChart data={trendData} height={200} />
        </SectionCard>
      </div>

      {/* Active breaches */}
      <SectionCard
        title="Active Breaches"
        description="Open SLA breaches in your customer scope requiring communication."
        actions={
          breaches.length > 0 ? (
            <Badge variant="outline" className="text-xs text-rose-700 border-rose-200 bg-rose-50">
              {breaches.length} open
            </Badge>
          ) : undefined
        }
      >
        {breaches.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title="No active breaches"
            description="All SLA commitments are currently being met."
          />
        ) : (
          <div className="space-y-2">
            {breaches.map((e) => (
              <BreachRow key={e.id} event={e} serviceName={serviceMap.get(e.serviceId)?.name ?? 'Unknown'} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

const complianceColumns: Column<ComplianceRow>[] = [
  {
    key: 'service',
    header: 'Service',
    render: (r) => <span className="font-medium">{r.serviceName}</span>,
  },
  {
    key: 'class',
    header: 'SLA Class',
    render: (r) => <SlaClassBadge slaClass={r.slaClass} />,
  },
  {
    key: 'closed',
    header: 'Closed in time',
    render: (r) => <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{r.closedInTime}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'breaches',
    header: 'Breaches',
    render: (r) => <span className={`tabular-nums ${r.breaches > 0 ? 'text-rose-700 dark:text-rose-300 font-medium' : ''}`}>{r.breaches}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'warnings',
    header: 'Warnings',
    render: (r) => <span className={`tabular-nums ${r.warnings > 0 ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}`}>{r.warnings}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'compliance',
    header: 'Compliance',
    render: (r) =>
      r.compliance === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex items-center gap-2">
          <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={
                r.compliance >= 95
                  ? 'h-full bg-emerald-500'
                  : r.compliance >= 85
                    ? 'h-full bg-amber-500'
                    : 'h-full bg-rose-500'
              }
              style={{ width: `${r.compliance}%` }}
            />
          </div>
          <span className="tabular-nums font-medium text-sm">{r.compliance}%</span>
        </div>
      ),
  },
];

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneCls = {
    default: '',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  return (
    <Card className={toneCls}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function BreachRow({ event, serviceName }: { event: SlaEvent; serviceName: string }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SlaHealthBadge health="red" />
            <span className="text-sm font-medium">{serviceName}</span>
            {event.serviceCustomerId && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Customer-scoped
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground/80">{event.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Detected <RelativeTime date={event.createdAt} />
            {' · '}
            <FormattedDate date={event.createdAt} />
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setOpen(true)}>
          <Megaphone className="h-3.5 w-3.5" />
          Communicate
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Draft customer communication</DialogTitle>
            <DialogDescription>
              Compose a notification to the affected customer about this SLA breach.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 bg-muted/30 text-xs">
              <div className="font-medium">{serviceName}</div>
              <div className="text-muted-foreground mt-1">{event.message}</div>
              <div className="text-muted-foreground mt-1">
                Detected <FormattedDate date={event.createdAt} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comm-draft">Message to customer</Label>
              <Textarea
                id="comm-draft"
                rows={5}
                placeholder="Dear customer, we want to inform you about a recent SLA breach…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                toast.success('Communication drafted', {
                  description: 'A draft notification has been prepared for the affected customer.',
                });
                setOpen(false);
                setDraft('');
              }}
              className="gap-1.5"
            >
              <Megaphone className="h-4 w-4" />
              Draft communication
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
