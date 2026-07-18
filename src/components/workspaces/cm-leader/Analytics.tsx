'use client';

import { useMemo } from 'react';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DemandStatusBadge,
  Badge,
  Card,
  CardContent,
} from '@/components/shared';
import { MiniBarChart, SlaTrendChart, ComplianceDonut, DemandPipelineLanes } from '@/components/widgets';
import { useDemands, useChanges, useSlaEvents, useLeaderStats, daysSince } from './Dashboard';
import { BarChart3, TrendingUp, GitBranch, Gauge, Activity, FileText, CheckCircle2 } from 'lucide-react';
import { useApp } from '@/lib/store';
import type { DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';

const PIPELINE: DemandStatus[] = ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED', 'CLOSED'];

export default function Analytics() {
  const demandsQ = useDemands();
  const changesQ = useChanges();
  const slaQ = useSlaEvents();
  const statsQ = useLeaderStats();

  const demands = demandsQ.data ?? [];
  const changes = changesQ.data ?? [];
  const slaEvents = slaQ.data ?? [];
  const stats = statsQ.data;

  const { navigate } = useApp();

  // ---- Demand throughput (created vs closed per week, last 8 weeks) ----
  const throughput = useMemo(() => {
    const weeks: { label: string; created: number; closed: number }[] = [];
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * 7 * 86400000;
      const end = now - i * 7 * 86400000;
      const created = demands.filter((d) => {
        const t = new Date(d.createdAt).getTime();
        return t >= start && t < end;
      }).length;
      const closed = demands.filter((d) => {
        if (!d.closedAt) return false;
        const t = new Date(d.closedAt).getTime();
        return t >= start && t < end;
      }).length;
      weeks.push({ label: `W${8 - i}`, created, closed });
    }
    return weeks;
  }, [demands]);

  // Combined chart data: create "Created" + "Closed" as separate bars per week
  const throughputCreated = throughput.map((w) => ({ label: w.label, value: w.created }));
  const throughputClosed = throughput.map((w) => ({ label: w.label, value: w.closed }));

  // ---- Demand pipeline distribution (counts by status) ----
  const pipelineData = useMemo(() => {
    const counts: Record<string, number> = {};
    PIPELINE.forEach((s) => (counts[s] = 0));
    demands.forEach((d) => {
      if (counts[d.status] !== undefined) counts[d.status]++;
    });
    return PIPELINE.map((s) => ({ label: DEMAND_STATUS_LABELS[s], value: counts[s] }));
  }, [demands]);

  // ---- SLA trend (last 8 weeks compliance %) ----
  const slaTrend = useMemo(() => {
    const weeks: { label: string; value: number }[] = [];
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
      weeks.push({ label: `W${8 - i}`, value: compliance });
    }
    return weeks;
  }, [slaEvents]);

  const overallCompliance = useMemo(() => {
    const total = slaEvents.length;
    const closed = slaEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
    return total > 0 ? Math.round((closed / total) * 100) : 100;
  }, [slaEvents]);

  // ---- Changes by origin ----
  const changesByOrigin = useMemo(() => {
    const m: Record<string, number> = { DEMAND: 0, PROBLEM: 0, STANDARD: 0 };
    changes.forEach((c) => {
      m[c.originType] = (m[c.originType] ?? 0) + 1;
    });
    return [
      { label: 'From Demand', value: m.DEMAND },
      { label: 'From Problem', value: m.PROBLEM },
      { label: 'Standard', value: m.STANDARD },
    ];
  }, [changes]);

  // ---- Changes by complexity ----
  const changesByComplexity = useMemo(() => {
    const m: Record<string, number> = { SIMPLE: 0, MEDIUM: 0, COMPLEX: 0 };
    changes.forEach((c) => {
      if (c.complexity) m[c.complexity] = (m[c.complexity] ?? 0) + 1;
    });
    return [
      { label: 'Simple', value: m.SIMPLE },
      { label: 'Medium', value: m.MEDIUM },
      { label: 'Complex', value: m.COMPLEX },
    ];
  }, [changes]);

  // ---- KPIs ----
  const totalDemands = demands.length;
  const closedDemands = demands.filter((d) => d.status === 'CLOSED').length;
  const rejectionRate = totalDemands > 0 ? Math.round((demands.filter((d) => d.status === 'REJECTED').length / totalDemands) * 100) : 0;
  const avgCycleDays = useMemo(() => {
    const closed = demands.filter((d) => d.status === 'CLOSED' && d.closedAt);
    if (closed.length === 0) return null;
    const total = closed.reduce((a, d) => a + ((new Date(d.closedAt!).getTime() - new Date(d.createdAt).getTime()) / 86400000), 0);
    return Math.round((total / closed.length) * 10) / 10;
  }, [demands]);

  // ---- Demands for pipeline lanes ----
  const pipelineDemands = useMemo(() => demands.filter((d) => PIPELINE.includes(d.status)), [demands]);

  const isLoading = demandsQ.isLoading || changesQ.isLoading || slaQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="CSM Analytics"
        description="Strategic view of demand throughput, SLA performance, and change mix across the tenant — your practice at a glance."
        icon={<BarChart3 className="h-5 w-5" />}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Demands"
          value={totalDemands}
          hint={`${closedDemands} closed`}
          icon={<FileText className="h-4 w-4" />}
          onClick={() => navigate('demands')}
        />
        <StatCard
          label="Avg Cycle Time"
          value={avgCycleDays != null ? `${avgCycleDays}d` : '—'}
          hint="Created → Closed"
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Rejection Rate"
          value={`${rejectionRate}%`}
          hint="Of all demands"
          tone={rejectionRate > 20 ? 'warning' : 'default'}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="SLA Compliance"
          value={`${overallCompliance}%`}
          hint={`${slaEvents.length} events`}
          tone={overallCompliance >= 95 ? 'success' : overallCompliance >= 85 ? 'warning' : 'danger'}
          icon={<Gauge className="h-4 w-4" />}
          onClick={() => navigate('sla')}
        />
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Demand throughput */}
          <SectionCard
            title="Demand Throughput"
            description="Demands created vs closed per week over the last 8 weeks."
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Created</div>
                <MiniBarChart data={throughputCreated} />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Closed</div>
                <MiniBarChart data={throughputClosed} />
              </div>
            </div>
          </SectionCard>

          {/* Pipeline distribution */}
          <SectionCard
            title="Demand Pipeline Distribution"
            description="Current demand counts by status."
          >
            <MiniBarChart data={pipelineData} />
          </SectionCard>

          {/* SLA trend */}
          <SectionCard
            title="SLA Compliance Trend"
            description="Weekly SLA compliance over the last 8 weeks."
          >
            <SlaTrendChart data={slaTrend} />
          </SectionCard>

          {/* Overall compliance donut */}
          <SectionCard
            title="Overall SLA Compliance"
            description="Tenant-wide SLA compliance."
          >
            <div className="flex flex-col items-center justify-center py-4">
              <ComplianceDonut value={overallCompliance} label="compliant" size={180} />
              <div className="mt-3 text-xs text-muted-foreground">
                {slaEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length} of {slaEvents.length} events closed in time
              </div>
            </div>
          </SectionCard>

          {/* Changes by origin */}
          <SectionCard
            title="Changes by Origin"
            description="Distribution of changes by source type."
          >
            <MiniBarChart data={changesByOrigin} />
          </SectionCard>

          {/* Changes by complexity */}
          <SectionCard
            title="Changes by Complexity"
            description="Distribution of changes by complexity class."
          >
            <MiniBarChart data={changesByComplexity} />
          </SectionCard>
        </div>
      )}

      {/* Pipeline lanes overview */}
      {!isLoading && pipelineDemands.length > 0 && (
        <SectionCard
          title="Demand Pipeline Lanes"
          description="Active demands across the pipeline. Click a lane to drill into the demand queue."
        >
          <DemandPipelineLanes
            demands={pipelineDemands}
            onSelect={(d) => navigate('demand-detail', { id: d.id })}
            emptyLabel="No active demands"
          />
        </SectionCard>
      )}
    </div>
  );
}
