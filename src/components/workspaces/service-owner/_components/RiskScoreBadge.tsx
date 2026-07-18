'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/shared';

/**
 * RiskScoreBadge — numeric 0-100 risk score with traffic-light coloring.
 *
 * Bands (matching the service-health API derivation logic):
 *   0-30   → green  (low risk)
 *   31-60  → amber  (medium risk)
 *   61-100 → red    (high/critical risk)
 *
 * Used in the Service Health table and Service Detail header.
 */
export function riskScoreBand(score: number): 'green' | 'amber' | 'red' {
  if (score <= 30) return 'green';
  if (score <= 60) return 'amber';
  return 'red';
}

const BAND_META: Record<
  'green' | 'amber' | 'red',
  { cls: string; label: string }
> = {
  green: {
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    label: 'Low',
  },
  amber: {
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    label: 'Medium',
  },
  red: {
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
    label: 'High',
  },
};

export function RiskScoreBadge({
  score,
  className,
  showLabel = false,
}: {
  score: number;
  className?: string;
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = riskScoreBand(clamped);
  const meta = BAND_META[band];
  return (
    <Badge
      variant="outline"
      className={cn('font-semibold border tabular-nums text-xs', meta.cls, className)}
      title={`Risk score ${clamped}/100 — ${meta.label.toLowerCase()} risk`}
    >
      {clamped}
      {showLabel && <span className="ml-1 font-normal opacity-80">· {meta.label}</span>}
    </Badge>
  );
}

export default RiskScoreBadge;
