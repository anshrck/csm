'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, Badge, Button } from '@/components/shared';
import {
  AlertTriangle,
  ShieldAlert,
  Bug,
  GitBranch,
  Clock,
  ChevronRight,
} from 'lucide-react';

/**
 * OwnerActionCard — compact card for the "My Required Actions" list on the
 * Service Owner dashboard / command center.
 *
 * Each card surfaces a single governance obligation: the item type, the
 * affected service, the customer impact summary, how long it has been open,
 * the risk level, and a primary action button.
 *
 * The card is intentionally compact (no internal padding explosion) so a
 * queue of 5-10 actions fits within a single viewport.
 */

export type OwnerActionItemType =
  | 'SLA_BREACH'
  | 'SLA_WARNING'
  | 'P1_INCIDENT'
  | 'PROBLEM'
  | 'CHANGE'
  | 'COMMITMENT';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const ITEM_TYPE_META: Record<
  OwnerActionItemType,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  SLA_BREACH: {
    label: 'SLA Breach',
    icon: <ShieldAlert className="h-4 w-4" />,
    cls: 'border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20',
  },
  SLA_WARNING: {
    label: 'SLA Warning',
    icon: <AlertTriangle className="h-4 w-4" />,
    cls: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20',
  },
  P1_INCIDENT: {
    label: 'P1 Incident',
    icon: <AlertTriangle className="h-4 w-4" />,
    cls: 'border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20',
  },
  PROBLEM: {
    label: 'Problem',
    icon: <Bug className="h-4 w-4" />,
    cls: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20',
  },
  CHANGE: {
    label: 'Change',
    icon: <GitBranch className="h-4 w-4" />,
    cls: 'border-violet-200 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-950/20',
  },
  COMMITMENT: {
    label: 'Commitment',
    icon: <ShieldAlert className="h-4 w-4" />,
    cls: 'border-teal-200 bg-teal-50/50 dark:border-teal-900/50 dark:bg-teal-950/20',
  },
};

const RISK_META: Record<
  RiskLevel,
  { cls: string; label: string }
> = {
  low: {
    label: 'Low',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  },
  medium: {
    label: 'Medium',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  },
  high: {
    label: 'High',
    cls: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  },
  critical: {
    label: 'Critical',
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  },
};

export interface OwnerActionCardProps {
  itemType: OwnerActionItemType;
  service: string;
  customerImpact?: string;
  age: string;
  riskLevel: RiskLevel;
  actionLabel: string;
  onAction: () => void;
  className?: string;
  title?: string;
}

export function OwnerActionCard({
  itemType,
  service,
  customerImpact,
  age,
  riskLevel,
  actionLabel,
  onAction,
  className,
  title,
}: OwnerActionCardProps) {
  const typeMeta = ITEM_TYPE_META[itemType];
  const riskMeta = RISK_META[riskLevel];
  return (
    <Card className={cn('border', typeMeta.cls, className)}>
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {typeMeta.icon}
              <span>{typeMeta.label}</span>
              <span className="inline-flex items-center gap-0.5 text-muted-foreground/80">
                · <Clock className="h-3 w-3" /> {age}
              </span>
            </div>
            <div className="mt-1 text-sm font-medium truncate">
              {title ?? service}
            </div>
            <div className="text-xs text-muted-foreground truncate">{service}</div>
            {customerImpact && (
              <p className="mt-1.5 text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                {customerImpact}
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn('text-[10px] font-semibold border shrink-0', riskMeta.cls)}
          >
            {riskMeta.label}
          </Badge>
        </div>
        <div className="mt-2.5 flex justify-end">
          <Button size="sm" variant="default" className="h-7 gap-1 text-xs" onClick={onAction}>
            {actionLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default OwnerActionCard;
