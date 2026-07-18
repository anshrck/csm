'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/shared';
import {
  Play,
  Pause,
  CheckCircle2,
  ShieldAlert,
  Ban,
} from 'lucide-react';

/**
 * SlaClockBadge — compact status badge for a single SLA clock.
 *
 * Color mapping (matches the shared SlaClockPanel):
 *   RUNNING  → sky
 *   PAUSED   → amber
 *   MET      → emerald
 *   BREACHED → rose
 *   CANCELED → muted
 *
 * Accepts any string status; unknown values render as a muted default.
 */
const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: React.ReactNode }
> = {
  RUNNING: {
    label: 'Running',
    cls: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
    icon: <Play className="h-3 w-3" />,
  },
  PAUSED: {
    label: 'Paused',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    icon: <Pause className="h-3 w-3" />,
  },
  MET: {
    label: 'Met',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  BREACHED: {
    label: 'Breached',
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
    icon: <ShieldAlert className="h-3 w-3" />,
  },
  CANCELED: {
    label: 'Canceled',
    cls: 'bg-muted text-muted-foreground border-border',
    icon: <Ban className="h-3 w-3" />,
  },
};

const FALLBACK = {
  label: 'Unknown',
  cls: 'bg-muted text-muted-foreground border-border',
  icon: <Ban className="h-3 w-3" />,
};

export function SlaClockBadge({
  status,
  className,
  showIcon = true,
}: {
  status: string;
  className?: string;
  showIcon?: boolean;
}) {
  const meta = STATUS_META[status?.toUpperCase()] ?? FALLBACK;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium border text-[11px]', meta.cls, className)}
    >
      {showIcon && meta.icon}
      {meta.label}
    </Badge>
  );
}

export default SlaClockBadge;
