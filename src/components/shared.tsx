'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type DemandStatus,
  type ChangeStatus,
  type SlaClass,
  type SlaHealth,
  type Role,
  DEMAND_STATUS_LABELS,
  CHANGE_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/types';

/* ----------------------------- Status Badges ----------------------------- */

const demandStatusStyles: Record<DemandStatus, string> = {
  NEW: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  QUOTED: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
  ACCEPTED: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
  IN_CHANGE: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900',
  FULFILLED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  CLOSED: 'bg-muted text-muted-foreground border-border',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  REDIRECTED: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900',
};

export function DemandStatusBadge({ status, className }: { status: DemandStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium border', demandStatusStyles[status], className)}>
      {DEMAND_STATUS_LABELS[status]}
    </Badge>
  );
}

const changeStatusStyles: Record<ChangeStatus, string> = {
  REQUESTED: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  ASSESSMENT: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  PLANNING: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
  APPROVED: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  IMPLEMENTATION: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
  VERIFICATION: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

export function ChangeStatusBadge({ status, className }: { status: ChangeStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium border', changeStatusStyles[status], className)}>
      {CHANGE_STATUS_LABELS[status]}
    </Badge>
  );
}

const slaClassStyles: Record<SlaClass, string> = {
  A: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  B: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  C: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  D: 'bg-muted text-muted-foreground border-border',
};

export function SlaClassBadge({ slaClass, className }: { slaClass: SlaClass; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-semibold border tabular-nums', slaClassStyles[slaClass], className)}>
      Class {slaClass}
    </Badge>
  );
}

export function SlaHealthBadge({ health, className }: { health: SlaHealth; className?: string }) {
  const map = {
    green: { label: 'Healthy', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300', dot: 'bg-emerald-500' },
    amber: { label: 'Warning', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300', dot: 'bg-amber-500' },
    red: { label: 'Breached', cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300', dot: 'bg-rose-500' },
  }[health];
  return (
    <Badge variant="outline" className={cn('font-medium border gap-1.5', map.cls, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', map.dot)} />
      {map.label}
    </Badge>
  );
}

const roleStyles: Record<Role, string> = {
  SERVICE_CUSTOMER: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  SCM_WORKER: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  CM_LEADER: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  SERVICE_OWNER: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium border', roleStyles[role], className)}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

/* ----------------------------- Page Header ----------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-primary">{icon}</div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/* ----------------------------- Stat Card ----------------------------- */

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  onClick?: () => void;
}) {
  const toneCls = {
    default: '',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  return (
    <Card
      className={cn('transition-shadow', onClick && 'cursor-pointer hover:shadow-md', toneCls)}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Empty State ----------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && <div className="mb-3 text-muted-foreground/60">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ----------------------------- Loading ----------------------------- */

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-full bg-primary/20 h-4 w-4', className)} />
  );
}

/* ----------------------------- Entity Avatar ----------------------------- */

export function UserAvatar({ name, color, size = 'default' }: { name: string; color?: string; size?: 'sm' | 'default' | 'lg' }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sz = size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm';
  return (
    <Avatar className={cn(sz, 'border')}>
      <AvatarFallback style={{ backgroundColor: color ?? 'var(--primary)', color: 'white' }} className="font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/* ----------------------------- Relative time ----------------------------- */

export function RelativeTime({ date, className }: { date: string | Date; className?: string }) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  let label: string;
  if (sec < 60) label = 'just now';
  else if (min < 60) label = `${min}m ago`;
  else if (hr < 24) label = `${hr}h ago`;
  else if (day < 30) label = `${day}d ago`;
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time className={cn('tabular-nums', className)} dateTime={d.toISOString()}>
          {label}
        </time>
      </TooltipTrigger>
      <TooltipContent>{d.toLocaleString()}</TooltipContent>
    </Tooltip>
  );
}

export function FormattedDate({ date, className }: { date: string | Date; className?: string }) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <time className={cn('tabular-nums', className)} dateTime={d.toISOString()}>
      {d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}

/* ----------------------------- Section Card ----------------------------- */

export function SectionCard({
  title,
  description,
  children,
  actions,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            {title && <CardTitle className="text-base">{title}</CardTitle>}
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {actions}
        </CardHeader>
      )}
      <CardContent className={cn(title ? 'pt-0' : 'pt-6', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/* ----------------------------- Demand Timeline ----------------------------- */

const PIPELINE: DemandStatus[] = ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED'];

export function DemandPipelineTimeline({ status, className }: { status: DemandStatus; className?: string }) {
  const currentIndex = PIPELINE.indexOf(status);
  const isClosed = status === 'CLOSED';
  const isRejected = status === 'REJECTED' || status === 'REDIRECTED';
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin', className)}>
      {PIPELINE.map((s, i) => {
        const done = isClosed || (currentIndex >= 0 && i < currentIndex);
        const active = !isClosed && !isRejected && i === currentIndex;
        const reached = isClosed || (currentIndex >= 0 && i <= currentIndex);
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center gap-1.5 min-w-[80px]">
              <div
                className={cn(
                  'h-2.5 w-2.5 rounded-full border-2 transition-colors',
                  active && 'bg-primary border-primary ring-4 ring-primary/15',
                  done && 'bg-primary border-primary',
                  !reached && !active && 'bg-background border-muted-foreground/30',
                )}
              />
              <span className={cn('text-[10px] font-medium whitespace-nowrap', active ? 'text-primary' : reached ? 'text-foreground' : 'text-muted-foreground')}>
                {DEMAND_STATUS_LABELS[s]}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={cn('h-0.5 flex-1 min-w-[12px] mt-[-12px]', done ? 'bg-primary' : 'bg-muted-foreground/20')} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ----------------------------- Activity Log ----------------------------- */

const eventTypeLabels: Record<string, string> = {
  CREATED: 'Demand submitted',
  REVIEW_STARTED: 'Review started',
  QUOTED: 'Quote issued',
  QUOTE_APPROVED: 'Quote approved by CM Leader',
  ACCEPTED: 'Quote accepted by customer',
  REJECTED: 'Demand rejected',
  REDIRECTED: 'Demand redirected',
  HANDED_TO_CE: 'Handed to Change Enablement',
  FULFILLED: 'Demand fulfilled',
  CLOSED: 'Demand closed',
  COMMENT: 'Comment added',
};

export function ActivityLog({
  events,
  className,
}: {
  events: { id: string; eventType: string; actorName: string; notes: string | null; createdAt: string }[];
  className?: string;
}) {
  return (
    <ol className={cn('relative space-y-4', className)}>
      {events.map((e, i) => (
        <li key={e.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cn('h-2 w-2 rounded-full mt-1.5', i === 0 ? 'bg-primary' : 'bg-muted-foreground/40')} />
            {i < events.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{eventTypeLabels[e.eventType] ?? e.eventType}</span>
              <RelativeTime date={e.createdAt} className="text-xs text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">by {e.actorName}</p>
            {e.notes && <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{e.notes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------- Data Table (simple) ----------------------------- */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border overflow-hidden', className)}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap', c.headerClassName)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  {empty ?? 'No records found.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    'border-t transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-muted/40',
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------- Misc ----------------------------- */

export function KeyValue({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('tabular-nums', className)}>
      {value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
    </span>
  );
}

export function Days({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('tabular-nums', className)}>
      {value} {value === 1 ? 'day' : 'days'}
    </span>
  );
}

/* Re-export commonly used primitives for convenience */
export { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Badge, Button };
