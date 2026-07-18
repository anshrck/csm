'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  PlusCircle,
  FileText,
  Clock,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Activity,
  HeartPulse,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  type Demand,
  type Service,
  type SlaEvent,
  type SlaHealth,
  type DashboardStats,
  DEMAND_PIPELINE,
  DEMAND_STATUS_LABELS,
} from '@/lib/types';
import {
  PageHeader,
  StatCard,
  SectionCard,
  DemandStatusBadge,
  SlaClassBadge,
  SlaHealthBadge,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  Money,
  Days,
  EmptyState,
  LoadingState,
  Button,
  Badge,
} from '@/components/shared';
import { cn } from '@/lib/utils';

// Extended stats shape returned by /api/stats (superset of DashboardStats).
interface StatsResponse extends DashboardStats {
  pipeline?: { status: string; count: number }[];
  slaByService?: {
    serviceId: string;
    serviceName: string;
    slaClass: string;
    health: SlaHealth;
    events: number;
  }[];
  recentActivity?: {
    id: string;
    demandId: string;
    demandTitle: string;
    eventType: string;
    actorName: string;
    createdAt: string;
  }[];
}

export default function Dashboard() {
  const { navigate } = useApp();

  const statsQ = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet<StatsResponse>('/api/stats'),
  });

  const demandsQ = useQuery({
    queryKey: ['demands', 'mine'],
    queryFn: () => apiGet<Demand[]>('/api/demands?mine=1'),
  });

  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });

  const slaEventsQ = useQuery({
    queryKey: ['sla-events'],
    queryFn: () => apiGet<SlaEvent[]>('/api/sla-events'),
  });

  const demands = demandsQ.data ?? [];
  const services = servicesQ.data ?? [];
  const slaEvents = slaEventsQ.data ?? [];
  const stats = statsQ.data;

  // Pending My Action = QUOTED demands awaiting customer decision
  const pendingDemands = useMemo(
    () =>
      demands
        .filter((d) => d.status === 'QUOTED')
        .sort((a, b) => (b.quotedAt ?? '').localeCompare(a.quotedAt ?? '')),
    [demands],
  );

  // Compute SLA health per service from events (fallback when stats.slaByService missing)
  const slaHealthByService = useMemo(() => {
    const map = new Map<string, { health: SlaHealth; warnings: number; breaches: number }>();
    for (const ev of slaEvents) {
      const cur = map.get(ev.serviceId) ?? { health: 'green' as SlaHealth, warnings: 0, breaches: 0 };
      if (ev.eventType === 'BREACHED') {
        cur.breaches += 1;
        cur.health = 'red';
      } else if (ev.eventType === 'WARNING' && cur.health !== 'red') {
        cur.warnings += 1;
        cur.health = 'amber';
      }
      map.set(ev.serviceId, cur);
    }
    return map;
  }, [slaEvents]);

  const recentActivity = stats?.recentActivity ?? [];

  const pendingCount = stats?.byStatus?.QUOTED ?? pendingDemands.length;
  const slaWarnings = stats?.slaWarnings ?? slaEvents.filter((e) => e.eventType === 'WARNING').length;
  const slaBreaches = stats?.slaBreaches ?? slaEvents.filter((e) => e.eventType === 'BREACHED').length;
  const totalDemands = stats?.totalDemands ?? demands.length;

  const loading = demandsQ.isLoading || statsQ.isLoading;

  // SLA health rows — prefer stats.slaByService; fall back to client computation.
  const slaHealthRows = useMemo(() => {
    if (stats?.slaByService && stats.slaByService.length > 0) {
      return stats.slaByService.map((s) => ({
        id: s.serviceId,
        name: s.serviceName,
        slaClass: s.slaClass as Service['slaClass'],
        health: s.health,
        detail: s.events > 0 ? `${s.events} active event(s)` : 'No active events',
      }));
    }
    return services.map((s) => {
      const h = slaHealthByService.get(s.id);
      return {
        id: s.id,
        name: s.name,
        slaClass: s.slaClass,
        health: (h?.health ?? 'green') as SlaHealth,
        detail: h?.breaches ? `${h.breaches} breach(es)` : h?.warnings ? `${h.warnings} warning(s)` : 'No active events',
      };
    });
  }, [stats, services, slaHealthByService]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your demand pipeline and service governance overview."
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <Button onClick={() => navigate('submit-demand')} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Demand
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Demands"
          value={loading ? '—' : totalDemands}
          icon={<FileText className="h-4 w-4" />}
          hint="All demands you have submitted"
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="Pending My Action"
          value={loading ? '—' : pendingCount}
          icon={<Clock className="h-4 w-4" />}
          hint="Quotes awaiting your decision"
          tone={pendingCount > 0 ? 'warning' : 'default'}
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="SLA Warnings"
          value={loading ? '—' : slaWarnings}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint="Approaching threshold"
          tone={slaWarnings > 0 ? 'warning' : 'success'}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="SLA Breaches"
          value={loading ? '—' : slaBreaches}
          icon={<ShieldAlert className="h-4 w-4" />}
          hint="Targets missed"
          tone={slaBreaches > 0 ? 'danger' : 'success'}
          onClick={() => navigate('sla')}
        />
      </div>

      {/* Demand pipeline lanes */}
      <SectionCard
        title="Demand Pipeline"
        description="Your demands grouped by lifecycle stage. Click a card to open details."
      >
        {demandsQ.isLoading ? (
          <LoadingState rows={3} />
        ) : demands.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No demands yet"
            description="Submit your first demand to start the SCM engagement workflow."
            action={
              <Button onClick={() => navigate('submit-demand')} className="gap-2">
                <PlusCircle className="h-4 w-4" /> New Demand
              </Button>
            }
          />
        ) : (
          <PipelineLanes
            demands={demands}
            onSelect={(d) => navigate('demand-detail', { id: d.id })}
          />
        )}
      </SectionCard>

      {/* Pending My Action + SLA Health */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Pending My Action"
          description="Quotes awaiting your accept or decline decision."
          actions={
            pendingDemands.length > 0 ? (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {pendingDemands.length} pending
              </Badge>
            ) : null
          }
        >
          {pendingDemands.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="Nothing pending"
              description="You have no quotes awaiting your decision right now."
            />
          ) : (
            <ul className="divide-y">
              {pendingDemands.map((d) => (
                <li
                  key={d.id}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate('demand-detail', { id: d.id })}
                        className="text-sm font-medium hover:text-primary hover:underline text-left truncate"
                      >
                        {d.title}
                      </button>
                      <DemandStatusBadge status={d.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <UserAvatar name={d.assignedScmWorkerName ?? 'Unassigned'} size="sm" />
                        {d.assignedScmWorkerName ?? 'Unassigned'}
                      </span>
                      {d.quotedAt && (
                        <span className="inline-flex items-center gap-1">
                          Quoted <FormattedDate date={d.quotedAt} />
                        </span>
                      )}
                      {d.estimatedEffortDays != null && <Days value={d.estimatedEffortDays} />}
                      {d.estimatedCost != null && <Money value={d.estimatedCost} />}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('demand-detail', { id: d.id })}
                    className="gap-1 shrink-0"
                  >
                    Review Quote <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="SLA Health"
          description="Per-service health across your entitled catalog."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('sla')} className="gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {servicesQ.isLoading && !stats?.slaByService ? (
            <LoadingState rows={4} />
          ) : slaHealthRows.length === 0 ? (
            <EmptyState
              icon={<HeartPulse className="h-8 w-8" />}
              title="No entitled services"
              description="Your organisation has no active service entitlements yet."
            />
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
              {slaHealthRows.map((s) => (
                <li
                  key={s.id}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => navigate('catalog')}
                      className="text-sm font-medium hover:text-primary hover:underline text-left truncate block"
                    >
                      {s.name}
                    </button>
                    <p className="text-xs text-muted-foreground truncate">{s.detail}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SlaClassBadge slaClass={s.slaClass} />
                    <SlaHealthBadge health={s.health} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Recent Activity */}
      <SectionCard
        title="Recent Activity"
        description="Latest events across your demands."
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('demands')} className="gap-1">
            All demands <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {recentActivity.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No recent activity"
            description="Events from your submitted demands will appear here."
          />
        ) : (
          <ol className="relative space-y-3">
            {recentActivity.map((e, i) => (
              <li key={e.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full mt-1.5',
                      i === 0 ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                  />
                  {i < recentActivity.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="flex-1 pb-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      onClick={() => navigate('demand-detail', { id: e.demandId })}
                      className="text-sm font-medium hover:text-primary hover:underline text-left truncate"
                    >
                      {e.demandTitle || 'Untitled demand'}
                    </button>
                    <RelativeTime date={e.createdAt} className="text-xs text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">
                    {e.eventType.toLowerCase().replace(/_/g, ' ')} · by {e.actorName}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}

/* ---------------- Inline Pipeline Lanes Widget ---------------- */

function PipelineLanes({
  demands,
  onSelect,
}: {
  demands: Demand[];
  onSelect: (d: Demand) => void;
}) {
  const byStatus = useMemo(() => {
    const map = new Map<string, Demand[]>();
    for (const s of DEMAND_PIPELINE) map.set(s, []);
    for (const d of demands) {
      const arr = map.get(d.status);
      if (arr) arr.push(d);
    }
    return map;
  }, [demands]);

  const terminal = demands.filter(
    (d) => d.status === 'CLOSED' || d.status === 'REJECTED' || d.status === 'REDIRECTED',
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {DEMAND_PIPELINE.map((status) => {
          const items = byStatus.get(status) ?? [];
          return (
            <div key={status} className="flex flex-col rounded-lg border bg-muted/30 min-h-[160px]">
              <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DEMAND_STATUS_LABELS[status]}
                </span>
                <Badge variant="secondary" className="text-[10px] h-5 min-w-5 justify-center">
                  {items.length}
                </Badge>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-thin max-h-64">
                {items.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 text-center py-3">Empty</p>
                ) : (
                  items.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelect(d)}
                      className="w-full text-left rounded-md border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-2.5"
                    >
                      <p className="text-xs font-medium line-clamp-2 leading-snug">{d.title}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          <RelativeTime date={d.updatedAt} />
                        </span>
                        {d.estimatedCost != null && (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            <Money value={d.estimatedCost} />
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      {terminal.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Terminal ({terminal.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {terminal.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelect(d)}
                className="inline-flex items-center gap-2 rounded-md border bg-card hover:border-primary/40 transition-colors px-2.5 py-1.5"
              >
                <DemandStatusBadge status={d.status} className="text-[10px]" />
                <span className="text-xs font-medium truncate max-w-[200px]">{d.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
