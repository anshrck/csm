'use client';

/**
 * SlaClockPanel — shared, self-contained SLA clock panel for a single ticket.
 *
 * Props: { ticketId: string }
 *
 * Fetches GET /api/sla-clocks?ticketId=<id> and renders one clock card per
 * SlaClock row (typically RESPONSE + RESOLUTION). Each card shows:
 *   - Status badge (RUNNING=blue, PAUSED=amber, MET=green, BREACHED=red,
 *     CANCELED=muted)
 *   - Progress bar showing elapsed time vs. due time
 *   - Due date (FormattedDate)
 *   - Time remaining (live countdown) or "Breached X ago"
 *   - Paused-time total
 *
 * Mounted inside TicketDetail (replaces the old inline SlaClockPanel).
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  SectionCard,
  EmptyState,
  LoadingState,
  Badge,
  FormattedDate,
} from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  Gauge,
  Play,
  Pause,
  CheckCircle2,
  ShieldAlert,
  Ban,
  Clock,
  TimerReset,
  AlertTriangle,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import {
  type SlaClockRow,
  type SlaClockStatus,
  SLA_CLOCK_TYPE_LABELS,
  SLA_CLOCK_STATUS_LABELS,
  formatMins,
} from '@/lib/tickets';

// ---- Status visual metadata ------------------------------------------------

interface StatusMeta {
  label: string;
  cls: string;
  barCls: string;
  icon: React.ReactNode;
}

const STATUS_META: Record<SlaClockStatus, StatusMeta> = {
  RUNNING: {
    label: SLA_CLOCK_STATUS_LABELS.RUNNING,
    cls: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
    barCls: 'bg-sky-500',
    icon: <Play className="h-3.5 w-3.5" />,
  },
  PAUSED: {
    label: SLA_CLOCK_STATUS_LABELS.PAUSED,
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
    barCls: 'bg-amber-400',
    icon: <Pause className="h-3.5 w-3.5" />,
  },
  MET: {
    label: SLA_CLOCK_STATUS_LABELS.MET,
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
    barCls: 'bg-emerald-500',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  BREACHED: {
    label: SLA_CLOCK_STATUS_LABELS.BREACHED,
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
    barCls: 'bg-rose-500',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  },
  CANCELED: {
    label: SLA_CLOCK_STATUS_LABELS.CANCELED,
    cls: 'bg-muted text-muted-foreground border-border',
    barCls: 'bg-muted-foreground/30',
    icon: <Ban className="h-3.5 w-3.5" />,
  },
};

// ---- Live "now" tick so countdowns update without re-fetching --------------

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---- Single clock card -----------------------------------------------------

function ClockCard({ clock, now }: { clock: SlaClockRow; now: number }) {
  const status = clock.status;
  const meta = STATUS_META[status] ?? STATUS_META.RUNNING;

  // Use the API-derived percentRemaining if available, else compute from
  // dueAt/startedAt. For non-RUNNING clocks, the percent is informational.
  let percent = clock.percentRemaining;
  if (percent === null) {
    const start = new Date(clock.startedAt).getTime();
    const due = new Date(clock.dueAt).getTime();
    if (status === 'BREACHED') percent = 0;
    else if (status === 'MET') percent = 100;
    else if (due > start) {
      const total = due - start;
      const elapsed = Math.max(0, now - start);
      percent = Math.max(0, Math.min(100, Math.round(((total - elapsed) / total) * 100)));
    } else percent = 100;
  }
  const elapsedPct = Math.max(0, Math.min(100, 100 - percent));

  // Time label.
  const dueMs = new Date(clock.dueAt).getTime();
  const remainingMs = dueMs - now;
  const remainingMins = Math.round(remainingMs / 60000);
  let timeLabel: string;
  let timeLabelTone = '';

  if (status === 'RUNNING') {
    if (remainingMins < 0) {
      timeLabel = `Breached ${formatMins(-remainingMins)} ago`;
      timeLabelTone = 'text-rose-700 dark:text-rose-300';
    } else if (remainingMins <= 60) {
      timeLabel = `${formatMins(remainingMins)} remaining`;
      timeLabelTone = 'text-amber-700 dark:text-amber-300';
    } else {
      timeLabel = `${formatMins(remainingMins)} remaining`;
      timeLabelTone = 'text-emerald-700 dark:text-emerald-300';
    }
  } else if (status === 'PAUSED') {
    timeLabel = `Paused for ${formatMins(clock.totalPausedMins)}`;
    timeLabelTone = 'text-amber-700 dark:text-amber-300';
  } else if (status === 'MET' && clock.metAt) {
    timeLabel = `Met at ${new Date(clock.metAt).toLocaleString()}`;
    timeLabelTone = 'text-emerald-700 dark:text-emerald-300';
  } else if (status === 'BREACHED') {
    // Show how long ago the breach occurred (or since dueAt).
    const breachMs = clock.breachedAt ? new Date(clock.breachedAt).getTime() : dueMs;
    const agoMins = Math.round((now - breachMs) / 60000);
    timeLabel =
      agoMins > 0
        ? `Breached ${formatMins(agoMins)} ago`
        : `Due ${new Date(clock.dueAt).toLocaleString()}`;
    timeLabelTone = 'text-rose-700 dark:text-rose-300';
  } else if (status === 'CANCELED') {
    timeLabel = 'Clock canceled';
    timeLabelTone = 'text-muted-foreground';
  } else {
    timeLabel = '—';
  }

  // At-risk flag: RUNNING + percentRemaining <= 25 (but not yet breached).
  const atRisk = status === 'RUNNING' && percent !== null && percent <= 25 && remainingMins >= 0;

  return (
    <div
      className={cn(
        'rounded-md border p-4 space-y-2',
        status === 'BREACHED' && 'border-rose-200 dark:border-rose-900/60',
        atRisk && 'border-amber-200 dark:border-amber-900/60',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">
            {SLA_CLOCK_TYPE_LABELS[clock.type]} SLA
          </span>
          {clock.policyName && (
            <span className="text-[10px] text-muted-foreground">
              · {clock.policyName}
            </span>
          )}
        </div>
        <Badge variant="outline" className={cn('text-[11px] gap-1 font-medium', meta.cls)}>
          {meta.icon}
          {meta.label}
        </Badge>
      </div>

      {/* Time label */}
      <div className={cn('text-lg font-semibold tabular-nums', timeLabelTone)}>
        {timeLabel}
      </div>

      {/* At-risk warning */}
      {atRisk && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          At risk — within 25% of due time
        </div>
      )}

      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', meta.barCls)}
          style={{ width: `${elapsedPct}%` }}
        />
      </div>

      {/* Footer: started + due */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Play className="h-3 w-3" />
          Started <FormattedDate date={clock.startedAt} />
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Due <FormattedDate date={clock.dueAt} />
        </span>
      </div>

      {/* Paused time + breach info */}
      {(clock.totalPausedMins > 0 || clock.breachedAt) && (
        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
          {clock.totalPausedMins > 0 && (
            <span className="flex items-center gap-1">
              <TimerReset className="h-3 w-3" />
              Paused total: {formatMins(clock.totalPausedMins)}
            </span>
          )}
          {clock.breachedAt && (
            <span className="flex items-center gap-1 text-rose-700 dark:text-rose-300">
              <ShieldAlert className="h-3 w-3" />
              Breached at {new Date(clock.breachedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main component --------------------------------------------------------

export interface SlaClockPanelProps {
  ticketId: string;
}

export default function SlaClockPanel({ ticketId }: SlaClockPanelProps) {
  const now = useNow(30_000); // re-render every 30s so countdowns stay fresh

  const clocksQuery = useQuery<SlaClockRow[]>({
    queryKey: ['sla-clocks', 'ticket', ticketId],
    queryFn: () =>
      apiGet<SlaClockRow[]>(`/api/sla-clocks?ticketId=${encodeURIComponent(ticketId)}`),
    enabled: !!ticketId,
    refetchInterval: 60_000, // refresh from server every 60s
  });

  // Sort: RESPONSE before RESOLUTION; BREACHED first within each group.
  const sorted = React.useMemo(() => {
    const arr = (clocksQuery.data ?? []).slice();
    arr.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'RESPONSE' ? -1 : 1;
      }
      // BREACHED first, then RUNNING, then PAUSED, then MET/CANCELED.
      const rank = (s: SlaClockStatus): number => {
        switch (s) {
          case 'BREACHED':
            return 0;
          case 'RUNNING':
            return 1;
          case 'PAUSED':
            return 2;
          case 'MET':
            return 3;
          case 'CANCELED':
            return 4;
          default:
            return 5;
        }
      };
      return rank(a.status) - rank(b.status);
    });
    return arr;
  }, [clocksQuery.data]);

  return (
    <SectionCard
      title="SLA Clocks"
      description="Response and resolution targets for this ticket. Clocks auto-refresh every minute."
    >
      {clocksQuery.isLoading ? (
        <LoadingState rows={2} />
      ) : clocksQuery.isError ? (
        <EmptyState
          icon={<ShieldAlert className="h-8 w-8 text-muted-foreground/50" />}
          title="Failed to load SLA clocks"
          description={
            clocksQuery.error instanceof Error
              ? clocksQuery.error.message
              : 'Unknown error'
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8 text-muted-foreground/50" />}
          title="No SLA clocks configured"
          description="This ticket does not have an SLA policy attached. No response or resolution targets are being tracked."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((c) => (
            <ClockCard key={c.id} clock={c} now={now} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
