'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/shared';
import type { SlaHealth } from '@/lib/types';

/**
 * ServiceHealthBadge — colored dot + label summarising the live health of a
 * service (green = within target, amber = warnings, red = active breaches).
 *
 * Compact variant of the foundation SlaHealthBadge, tuned for table cells and
 * inline use within the Service Owner workspace.
 */
const HEALTH_META: Record<
  SlaHealth,
  { label: string; dot: string; cls: string }
> = {
  green: {
    label: 'Healthy',
    dot: 'bg-emerald-500',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  },
  amber: {
    label: 'At risk',
    dot: 'bg-amber-500',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  },
  red: {
    label: 'Breached',
    dot: 'bg-rose-500',
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  },
};

export function ServiceHealthBadge({
  health,
  className,
}: {
  health: SlaHealth;
  className?: string;
}) {
  const meta = HEALTH_META[health] ?? HEALTH_META.green;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium border text-xs', meta.cls, className)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </Badge>
  );
}

export default ServiceHealthBadge;
