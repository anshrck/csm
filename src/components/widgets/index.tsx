'use client';

/**
 * CereBree uSMS — Reusable dashboard widgets & charts library.
 *
 * This module is the visual centerpiece of every workspace dashboard.
 * All widgets are responsive, theme-aware (teal/emerald oklch 165), and
 * built on recharts + shadcn/ui primitives.
 *
 * Exports:
 *   - DemandPipelineLanes  (kanban of demand status lanes)
 *   - SlaTrendChart        (area chart with gradient fill)
 *   - ComplianceDonut      (donut gauge 0-100%)
 *   - WorkloadBars         (horizontal workload bars per worker)
 *   - MiniBarChart         (compact vertical bar chart)
 */

import * as React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { AlertTriangle, Inbox, TrendingUp } from 'lucide-react';
import type {
  Demand,
  DemandStatus,
} from '@/lib/types';
import {
  DEMAND_STATUS_LABELS,
  DEMAND_PIPELINE,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { RelativeTime, EmptyState } from '@/components/shared';

/* ========================================================================== */
/*  Shared helpers                                                            */
/* ========================================================================== */

/** Per-status accent palette — mirrors the DemandStatusBadge palette. */
const STATUS_ACCENT: Record<
  DemandStatus,
  { dot: string; bar: string; soft: string; text: string }
> = {
  NEW: {
    dot: 'bg-sky-500',
    bar: 'border-l-sky-400',
    soft: 'bg-sky-50/70 dark:bg-sky-950/30',
    text: 'text-sky-700 dark:text-sky-300',
  },
  UNDER_REVIEW: {
    dot: 'bg-amber-500',
    bar: 'border-l-amber-400',
    soft: 'bg-amber-50/70 dark:bg-amber-950/30',
    text: 'text-amber-700 dark:text-amber-300',
  },
  QUOTED: {
    dot: 'bg-violet-500',
    bar: 'border-l-violet-400',
    soft: 'bg-violet-50/70 dark:bg-violet-950/30',
    text: 'text-violet-700 dark:text-violet-300',
  },
  ACCEPTED: {
    dot: 'bg-teal-500',
    bar: 'border-l-teal-400',
    soft: 'bg-teal-50/70 dark:bg-teal-950/30',
    text: 'text-teal-700 dark:text-teal-300',
  },
  IN_CHANGE: {
    dot: 'bg-indigo-500',
    bar: 'border-l-indigo-400',
    soft: 'bg-indigo-50/70 dark:bg-indigo-950/30',
    text: 'text-indigo-700 dark:text-indigo-300',
  },
  FULFILLED: {
    dot: 'bg-emerald-500',
    bar: 'border-l-emerald-400',
    soft: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  CLOSED: {
    dot: 'bg-muted-foreground',
    bar: 'border-l-muted-foreground/40',
    soft: 'bg-muted/60',
    text: 'text-muted-foreground',
  },
  REJECTED: {
    dot: 'bg-rose-500',
    bar: 'border-l-rose-400',
    soft: 'bg-rose-50/70 dark:bg-rose-950/30',
    text: 'text-rose-700 dark:text-rose-300',
  },
  REDIRECTED: {
    dot: 'bg-orange-500',
    bar: 'border-l-orange-400',
    soft: 'bg-orange-50/70 dark:bg-orange-950/30',
    text: 'text-orange-700 dark:text-orange-300',
  },
};

/** Compact empty state for inside chart frames (keeps the chart's height). */
function ChartEmpty({
  height,
  title,
  description,
}: {
  height: number;
  title: string;
  description?: string;
}) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center rounded-lg border border-dashed text-center px-4"
    >
      <TrendingUp className="h-7 w-7 text-muted-foreground/40 mb-2" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground/70 max-w-xs">{description}</p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  DemandPipelineLanes                                                       */
/* ========================================================================== */

export function DemandPipelineLanes({
  demands,
  onSelect,
  emptyLabel = 'No demands',
}: {
  demands: Demand[];
  onSelect?: (d: Demand) => void;
  emptyLabel?: string;
}) {
  const byStatus = React.useMemo(() => {
    const map = {} as Record<DemandStatus, Demand[]>;
    for (const s of Object.keys(DEMAND_STATUS_LABELS) as DemandStatus[]) {
      map[s] = [];
    }
    for (const d of demands) {
      if (map[d.status]) map[d.status].push(d);
    }
    // Sort each lane by most recently updated first.
    for (const s of Object.keys(map) as DemandStatus[]) {
      map[s].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    return map;
  }, [demands]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
      {DEMAND_PIPELINE.map((status, idx) => {
        const items = byStatus[status] ?? [];
        const accent = STATUS_ACCENT[status];
        return (
          <motion.section
            key={status}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: idx * 0.05, ease: 'easeOut' }}
            className={cn(
              'flex flex-col rounded-xl border bg-card border-l-4 overflow-hidden min-w-0',
              accent.bar,
            )}
            aria-label={`${DEMAND_STATUS_LABELS[status]} lane`}
          >
            {/* Lane header */}
            <div
              className={cn(
                'flex items-center justify-between gap-2 px-3 py-2.5 border-b',
                accent.soft,
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn('h-2 w-2 rounded-full shrink-0', accent.dot)} />
                <span className="text-sm font-semibold truncate">
                  {DEMAND_STATUS_LABELS[status]}
                </span>
              </div>
              <Badge
                variant="outline"
                className="tabular-nums shrink-0 h-5 px-1.5 text-[11px]"
              >
                {items.length}
              </Badge>
            </div>

            {/* Lane body */}
            <div className="flex-1 max-h-80 overflow-y-auto scrollbar-thin p-2 space-y-2">
              {items.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/60 italic">
                  {emptyLabel}
                </div>
              ) : (
                items.map((d) => (
                  <DemandLaneCard key={d.id} demand={d} onSelect={onSelect} />
                ))
              )}
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}

function DemandLaneCard({
  demand,
  onSelect,
}: {
  demand: Demand;
  onSelect?: (d: Demand) => void;
}) {
  const interactive = !!onSelect;
  return (
    <button
      type="button"
      onClick={interactive ? () => onSelect!(demand) : undefined}
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
      className={cn(
        'group w-full text-left rounded-lg border bg-background p-2.5 transition-all',
        'hover:shadow-sm hover:border-primary/50 hover:-translate-y-0.5',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        interactive ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground">
        {demand.title}
      </p>
      {demand.serviceCustomerName && (
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {demand.serviceCustomerName}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          <RelativeTime date={demand.updatedAt} />
        </span>
        {demand.estimatedEffortDays != null && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] tabular-nums text-muted-foreground"
          >
            {demand.estimatedEffortDays}d
          </Badge>
        )}
      </div>
    </button>
  );
}

/* ========================================================================== */
/*  SlaTrendChart                                                             */
/* ========================================================================== */

export function SlaTrendChart({
  data,
  height = 220,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const gradientId = React.useId().replace(/:/g, '');

  if (!data || data.length === 0) {
    return (
      <ChartEmpty
        height={height}
        title="No SLA data yet"
        description="Trend data will appear once SLA events are recorded."
      />
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={`slaGrad-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            dy={8}
            minTickGap={8}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickFormatter={(v: number) => `${v}%`}
            width={40}
          />
          <Tooltip
            content={<SlaTrendTooltip />}
            cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            fill={`url(#slaGrad-${gradientId})`}
            dot={{ r: 2.5, fill: 'var(--primary)', strokeWidth: 0, opacity: 0 }}
            activeDot={{
              r: 5,
              fill: 'var(--primary)',
              stroke: 'var(--background)',
              strokeWidth: 2,
            }}
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SlaTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0].value);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-0.5 tabular-nums font-semibold text-primary">
        {Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'}
      </p>
    </div>
  );
}

/* ========================================================================== */
/*  ComplianceDonut                                                           */
/* ========================================================================== */

export function ComplianceDonut({
  value,
  label,
  size = 160,
}: {
  value: number | null | undefined;
  label?: string;
  size?: number;
}) {
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  const pct = hasValue ? Math.max(0, Math.min(100, value as number)) : 0;

  const tone: 'green' | 'amber' | 'red' | 'muted' = !hasValue
    ? 'muted'
    : pct >= 95
      ? 'green'
      : pct >= 85
        ? 'amber'
        : 'red';

  const colorMap = {
    green: 'oklch(0.6 0.13 165)', // emerald/teal — healthy
    amber: 'oklch(0.72 0.15 75)', // amber — warning
    red: 'oklch(0.62 0.22 27)', // rose — breached
    muted: 'var(--muted-foreground)',
  } as const;
  const color = colorMap[tone];

  const data = [
    { name: 'value', value: pct },
    { name: 'rest', value: 100 - pct },
  ];

  const thickness = Math.max(8, size * 0.11);
  const inner = size / 2 - thickness;
  const outer = size / 2;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            stroke="none"
            isAnimationActive
            animationDuration={750}
            animationEasing="ease-out"
          >
            <Cell fill={color} />
            <Cell fill="var(--muted)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className="font-semibold tabular-nums leading-none"
          style={{ fontSize: size * 0.24, color }}
        >
          {hasValue ? `${Math.round(pct)}%` : '—'}
        </span>
        {label && (
          <span
            className="mt-1 text-muted-foreground text-center leading-tight max-w-[85%]"
            style={{ fontSize: Math.max(10, size * 0.085) }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  WorkloadBars                                                              */
/* ========================================================================== */

export function WorkloadBars({
  items,
}: {
  items: { name: string; count: number; risk?: number }[];
}) {
  if (!items || items.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="No workload data"
          description="Worker workload will appear here when demands are assigned."
        />
      </div>
    );
  }

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
        const risk = item.risk ?? 0;
        return (
          <div
            key={`${item.name}-${i}`}
            className="flex items-center gap-2 sm:gap-3"
          >
            <div
              className="w-24 sm:w-32 shrink-0 truncate text-sm font-medium"
              title={item.name}
            >
              {item.name}
            </div>

            <div className="relative flex-1 h-6 rounded-md bg-muted/60 overflow-hidden min-w-0">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-md bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: 'easeOut' }}
              />
            </div>

            <div className="w-7 sm:w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
              {item.count}
            </div>

            <div className="w-6 shrink-0 flex justify-center">
              {risk > 0 ? (
                <span
                  className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold tabular-nums text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/60"
                  title={`${risk} at-risk item${risk === 1 ? '' : 's'}`}
                >
                  {risk}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*  MiniBarChart                                                              */
/* ========================================================================== */

export function MiniBarChart({
  data,
  height = 200,
  color,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const barColor = color ?? 'var(--primary)';

  if (!data || data.length === 0) {
    return (
      <ChartEmpty
        height={height}
        title="No data"
        description="Bars will appear here when values are available."
      />
    );
  }

  const many = data.length > 6;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            interval={many ? 0 : 'preserveStartEnd'}
            angle={many ? -35 : 0}
            textAnchor={many ? 'end' : 'middle'}
            height={many ? 56 : 24}
            dy={many ? 6 : 8}
            minTickGap={2}
          />
          <YAxis hide />
          <Tooltip
            content={<MiniBarTooltip color={barColor} />}
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          />
          <Bar
            dataKey="value"
            fill={barColor}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive
            animationDuration={600}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniBarTooltip({
  active,
  payload,
  label,
  color,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string | number;
  color?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0].value);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p
        className="mt-0.5 tabular-nums font-semibold"
        style={{ color: color ?? 'var(--primary)' }}
      >
        {Number.isFinite(v) ? v.toLocaleString() : '—'}
      </p>
    </div>
  );
}

/* Re-export the risk icon for consumers that want a legend chip. */
export { AlertTriangle as RiskIcon };
