'use client';

import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DemandStatusBadge,
  UserAvatar,
  RelativeTime,
  DataTable,
  type Column,
  Button,
  Badge,
  Card,
  CardContent,
} from '@/components/shared';
import { WorkloadBars, MiniBarChart } from '@/components/widgets';
import { useDemands, useLeaderStats, daysSince, type WorkloadItem } from './Dashboard';
import { Users, AlertTriangle, Clock, FileText, ArrowRight, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';

const STALL_THRESHOLD_DAYS = 3;
const ACTIVE_STATUSES: DemandStatus[] = ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED'];

export default function Workers() {
  const demandsQ = useDemands();
  const statsQ = useLeaderStats();

  const demands = demandsQ.data ?? [];
  const workers = statsQ.data?.workloadByWorker ?? [];

  const [openWorker, setOpenWorker] = useState<WorkloadItem | null>(null);

  // enrich workers with derived data
  const enriched = useMemo(() => {
    return workers.map((w) => {
      const ws = demands.filter((d) => d.assignedScmWorkerId === w.workerId);
      const active = ws.filter((d) => ACTIVE_STATUSES.includes(d.status));
      const byStatus: Record<string, number> = {};
      active.forEach((d) => {
        byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      });
      const stallingUnderReview = active.filter(
        (d) => d.status === 'UNDER_REVIEW' && (daysSince(d.updatedAt) ?? 0) > STALL_THRESHOLD_DAYS,
      );
      const risk = (w.slaRisk ?? w.riskCount ?? 0) + stallingUnderReview.length;
      return { ...w, activeCount: active.length, totalCount: ws.length, byStatus, stallingUnderReview, risk };
    });
  }, [workers, demands]);

  const totalActive = enriched.reduce((a, w) => a + w.activeCount, 0);
  const totalStalling = enriched.reduce((a, w) => a + w.stallingUnderReview.length, 0);
  const avgActive = enriched.length ? Math.round((totalActive / enriched.length) * 10) / 10 : 0;
  const maxActive = enriched.reduce((a, w) => Math.max(a, w.activeCount), 0);

  const workloadItems = enriched.map((w) => ({
    name: w.workerName,
    count: w.activeCount,
    risk: w.risk,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="SCM Workload Monitoring"
        description="Monitor active demand distribution across your SCM Workers. Spot workload imbalance and early stalling signals before they affect SLA."
        icon={<Users className="h-5 w-5" />}
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="SCM Workers"
          value={enriched.length}
          hint="Active in tenant"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Total Active Demands"
          value={totalActive}
          hint="Across all workers"
          icon={<FileText className="h-4 w-4" />}
        />
        <StatCard
          label="Avg per Worker"
          value={avgActive}
          hint={`Max: ${maxActive}`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Stalling Signals"
          value={totalStalling}
          hint={`Under review > ${STALL_THRESHOLD_DAYS}d`}
          tone={totalStalling > 0 ? 'warning' : 'success'}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      {statsQ.isLoading ? (
        <LoadingState rows={3} />
      ) : enriched.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Users className="h-8 w-8 text-muted-foreground/50" />}
            title="No SCM Workers found"
            description="Workload metrics will appear here once workers are assigned demands."
          />
        </SectionCard>
      ) : (
        <>
          {/* Workload bars */}
          <SectionCard
            title="Workload Distribution"
            description="Active demands per SCM Worker — bars are colored by risk count (red = elevated risk)."
          >
            <WorkloadBars items={workloadItems} />
          </SectionCard>

          {/* Worker cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {enriched.map((w) => (
              <WorkerCard key={w.workerId} worker={w} onOpen={() => setOpenWorker(w)} />
            ))}
          </div>
        </>
      )}

      <WorkerDemandsDialog
        worker={openWorker}
        demands={demands.filter((d) => d.assignedScmWorkerId === openWorker?.workerId)}
        onOpenChange={(v) => !v && setOpenWorker(null)}
      />
    </div>
  );
}

function WorkerCard({
  worker,
  onOpen,
}: {
  worker: WorkloadItem & { activeCount: number; totalCount: number; byStatus: Record<string, number>; stallingUnderReview: Demand[]; risk: number };
  onOpen: () => void;
}) {
  const statusData = (Object.entries(worker.byStatus) as [string, number][]).map(([status, value]) => ({
    label: DEMAND_STATUS_LABELS[status as DemandStatus] ?? status,
    value,
  }));
  const hasRisk = worker.risk > 0;
  const hasStalling = worker.stallingUnderReview.length > 0;

  return (
    <Card className={`overflow-hidden ${hasRisk ? 'border-amber-200 dark:border-amber-900/60' : ''}`}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <UserAvatar name={worker.workerName} color={worker.avatarColor} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{worker.workerName}</div>
            <div className="text-xs text-muted-foreground">SCM Worker</div>
          </div>
          {hasRisk && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 shrink-0">
              <AlertTriangle className="h-3 w-3 mr-1" /> {worker.risk} risk
            </Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{worker.activeCount}</div>
            <div className="text-[10px] text-muted-foreground">Active</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{worker.totalCount}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{statusData.length}</div>
            <div className="text-[10px] text-muted-foreground">Statuses</div>
          </div>
        </div>

        {statusData.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              By status
            </div>
            <MiniBarChart data={statusData} />
          </div>
        )}

        {hasStalling && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" />
              {worker.stallingUnderReview.length} stalling in Under Review
            </div>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">
              No update for over {STALL_THRESHOLD_DAYS} days — early signal of risk.
            </p>
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full mt-4" onClick={onOpen}>
          View demands <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkerDemandsDialog({
  worker,
  demands,
  onOpenChange,
}: {
  worker: WorkloadItem | null;
  demands: Demand[];
  onOpenChange: (v: boolean) => void;
}) {
  const { navigate } = useApp();

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0 max-w-[260px]">
          <div className="font-medium text-sm truncate">{d.title}</div>
          <div className="text-xs text-muted-foreground truncate">{d.serviceCustomerName}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <DemandStatusBadge status={d.status} />,
    },
    {
      key: 'updated',
      header: 'Last updated',
      render: (d) => <RelativeTime date={d.updatedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {worker && <UserAvatar name={worker.workerName} color={worker.avatarColor} />}
            {worker?.workerName ?? 'Worker'} — assigned demands
          </DialogTitle>
          <DialogDescription>
            {demands.length} demand{demands.length !== 1 ? 's' : ''} assigned to this SCM Worker.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {demands.length === 0 ? (
            <EmptyState title="No demands assigned" />
          ) : (
            <DataTable
              columns={columns}
              rows={demands}
              onRowClick={(d) => {
                onOpenChange(false);
                navigate('demand-detail', { id: d.id });
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
