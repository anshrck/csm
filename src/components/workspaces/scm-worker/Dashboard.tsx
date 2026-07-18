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
  FormattedDate,
  DataTable,
  type Column,
  Button,
  Card,
  CardContent,
  Badge,
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
  Megaphone,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import type {
  Demand,
  Change,
  SlaEvent,
  Service,
  DemandStatus,
} from '@/lib/types';

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

export default function Dashboard() {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  const { data: myDemands, isLoading: myLoading } = useQuery<Demand[]>({
    queryKey: ['demands', 'assigned', 'me'],
    queryFn: () => apiGet('/api/demands?assigned=me'),
  });

  const { data: unassigned } = useQuery<Demand[]>({
    queryKey: ['demands', 'unassigned'],
    queryFn: () => apiGet('/api/demands?unassigned=1'),
  });

  const { data: quoted } = useQuery<Demand[]>({
    queryKey: ['demands', 'status', 'QUOTED'],
    queryFn: () => apiGet('/api/demands?status=QUOTED'),
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

  const assignMe = useMutation({
    mutationFn: (id: string) =>
      apiPatch(`/api/demands/${id}`, { assignedScmWorkerId: session?.id }),
    onSuccess: () => {
      toast.success('Demand assigned to you');
      qc.invalidateQueries({ queryKey: ['demands'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not assign demand'),
  });

  const myActive = (myDemands ?? []).filter((d) => ACTIVE_STATUSES.includes(d.status));
  const quotedDemands = quoted ?? [];
  const myQuoted = (myDemands ?? []).filter((d) => d.status === 'QUOTED');
  const breaches = (slaEvents ?? []).filter((e) => e.eventType === 'BREACHED');
  const warnings = (slaEvents ?? []).filter((e) => e.eventType === 'WARNING');
  const openChanges = (changes ?? []).filter(
    (c) => c.status !== 'CLOSED' && c.status !== 'REJECTED',
  );
  const inChangeDemands = (myDemands ?? []).filter((d) => d.status === 'IN_CHANGE');

  // SLA health snapshot — services with active warnings/breaches (unresolved)
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
    .sort((a, b) => b.counts.breaches - a.counts.breaches || b.counts.warnings - a.counts.warnings)
    .slice(0, 6);

  // workload for WorkloadBars (group my active demands by status)
  const workload = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const overdue: Record<string, number> = {};
    for (const d of myActive) {
      counts[d.status] = (counts[d.status] ?? 0) + 1;
      // At-risk: QUOTED with no customer action >5 days, or IN_CHANGE
      if (d.status === 'QUOTED') {
        const days = daysSince(d.quotedAt);
        if (days !== null && days > 5) overdue[d.status] = (overdue[d.status] ?? 0) + 1;
      }
    }
    return (['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED'] as DemandStatus[])
      .filter((s) => counts[s])
      .map((s) => ({
        name: s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        count: counts[s],
        risk: overdue[s] ?? 0,
      }));
  }, [myActive]);

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

      {/* Top stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="My Active Demands"
          value={myLoading ? '—' : myActive.length}
          hint={`${(myDemands ?? []).length} total assigned`}
          icon={<ClipboardList className="h-4 w-4" />}
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="Awaiting Customer Action"
          value={quotedDemands.length}
          hint="Demands in QUOTED status"
          tone="warning"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="SLA Breaches"
          value={breaches.length}
          hint={`${warnings.length} active warnings`}
          tone="danger"
          icon={<AlertTriangle className="h-4 w-4" />}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="Open Changes"
          value={openChanges.length}
          hint="Across coordinated demands"
          tone="success"
          icon={<GitBranch className="h-4 w-4" />}
          onClick={() => navigate('changes')}
        />
      </div>

      {/* My queue (kanban) + workload */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="My Queue"
            description="Demands assigned to you, grouped by lifecycle stage."
            actions={
              <Button variant="ghost" size="sm" onClick={() => navigate('demands')} className="gap-1.5 text-xs">
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

      {/* Unassigned + Awaiting customer */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Unassigned Demands"
          description="Pick up new demands awaiting an SCM worker."
          actions={
            <Badge variant="outline" className="text-xs">
              {(unassigned ?? []).length} open
            </Badge>
          }
        >
          {(unassigned ?? []).length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="Queue is clear"
              description="No unassigned demands right now."
            />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
              {(unassigned ?? []).slice(0, 6).map((d) => (
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
                        <Badge variant="outline" className="mt-1 text-[10px] bg-rose-50 text-rose-700 border-rose-200">
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
      </div>

      {/* Change status feed + SLA health */}
      <div className="grid gap-4 lg:grid-cols-2">
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
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
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
                        <span className="text-rose-600 font-medium">{counts.breaches} breach{counts.breaches > 1 ? 'es' : ''}</span>
                      )}
                      {counts.breaches > 0 && counts.warnings > 0 && <span> · </span>}
                      {counts.warnings > 0 && (
                        <span className="text-amber-600 font-medium">{counts.warnings} warning{counts.warnings > 1 ? 's' : ''}</span>
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
    </div>
  );
}
