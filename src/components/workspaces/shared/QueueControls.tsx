'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  LayoutGrid,
  Table as TableIcon,
  X,
  AlertTriangle,
  Clock,
} from 'lucide-react';

/* ============================================================================
 * QueueControls — reusable header for queue pages.
 *
 * Composes (in order):
 *   1. Sort dropdown        (controlled: value + onChange)
 *   2. Filter chips         (active filter summaries with remove buttons)
 *   3. View toggle          (table | card)
 *   4. Bulk action bar      (appears when selection is non-empty)
 *
 * Companion helpers (exported below) make it easy to render aging badges
 * ("2d old" amber >3d / red >5d) and SLA-overdue indicators inside table
 * columns. Together these satisfy Phase 8 item 20's queue UX requirements.
 * ============================================================================ */

export type SortKey = 'age_asc' | 'priority_desc' | 'sla_due_asc' | 'customer_asc' | 'owner_asc';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'age_asc', label: 'Age (oldest first)' },
  { value: 'priority_desc', label: 'Priority (highest first)' },
  { value: 'sla_due_asc', label: 'SLA due (soonest first)' },
  { value: 'customer_asc', label: 'Customer (A→Z)' },
  { value: 'owner_asc', label: 'Owner (A→Z)' },
];

export type ViewMode = 'table' | 'card';

export interface FilterChip {
  /** Stable key for React + removal targeting. */
  key: string;
  /** Human label, e.g. "Status: Under Review". */
  label: string;
}

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Click handler — called with the current selection. */
  onRun: (selectedIds: string[]) => void;
  /** Optional: disable the action when selection is empty (default true). */
  disabled?: boolean;
  /** Visual variant. */
  variant?: 'default' | 'outline' | 'destructive' | 'ghost';
}

export interface QueueControlsProps {
  /** Sort state. */
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  /** Active filter chips (with remove handlers). */
  filterChips?: FilterChip[];
  onRemoveFilter?: (key: string) => void;
  onClearAllFilters?: () => void;
  /** View mode state. */
  viewMode?: ViewMode;
  onViewModeChange?: (v: ViewMode) => void;
  /** Optional: hide the view toggle (default: visible). */
  hideViewToggle?: boolean;
  /** Selection state (for bulk actions). */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Bulk actions shown when selection is non-empty. CM_LEADER queue pages pass Assign/Priority. */
  bulkActions?: BulkAction[];
  /** Right-aligned extra content (e.g. a search box). */
  children?: React.ReactNode;
  className?: string;
}

export function QueueControls({
  sort,
  onSortChange,
  filterChips = [],
  onRemoveFilter,
  onClearAllFilters,
  viewMode = 'table',
  onViewModeChange,
  hideViewToggle = false,
  selectedIds = [],
  onSelectionChange,
  bulkActions = [],
  children,
  className,
}: QueueControlsProps) {
  const hasSelection = selectedIds.length > 0;
  const hasChips = filterChips.length > 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: sort + chips */}
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Sort:</span>
            <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasChips && (
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="text-xs text-muted-foreground ml-1">Filters:</span>
              {filterChips.map((c) => (
                <Badge
                  key={c.key}
                  variant="outline"
                  className="pl-2 pr-1 py-0.5 gap-1 text-[11px] font-medium bg-muted/40"
                >
                  {c.label}
                  {onRemoveFilter && (
                    <button
                      type="button"
                      onClick={() => onRemoveFilter(c.key)}
                      aria-label={`Remove filter ${c.label}`}
                      className="ml-0.5 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {onClearAllFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={onClearAllFilters}
                >
                  Clear all
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Right: extras + view toggle */}
        <div className="flex items-center gap-2">
          {children}
          {!hideViewToggle && onViewModeChange && (
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => {
                if (v) onViewModeChange(v as ViewMode);
              }}
              variant="outline"
              className="h-8"
            >
              <ToggleGroupItem value="table" aria-label="Table view" className="h-7 px-2">
                <TableIcon className="h-3.5 w-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="card" aria-label="Card view" className="h-7 px-2">
                <LayoutGrid className="h-3.5 w-3.5" />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>

      {/* Bulk action bar — only visible when items are selected */}
      {hasSelection && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.length} selected
          </span>
          {onSelectionChange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onSelectionChange([])}
            >
              Clear
            </Button>
          )}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {bulkActions.map((a) => {
            const Icon = a.icon;
            const disabled = a.disabled ?? false;
            return (
              <Button
                key={a.id}
                type="button"
                size="sm"
                variant={a.variant ?? 'outline'}
                className="h-7 gap-1.5 text-xs"
                onClick={() => a.onRun(selectedIds)}
                disabled={disabled}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {a.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Companion row-level helpers.
 * ============================================================================ */

/**
 * Aging badge — renders "Nd old" with colour-coded urgency.
 *
 * - < 3 days: neutral (no badge colour)
 * - 3-5 days: amber
 * - > 5 days: red
 *
 * Pass `createdAt` (ISO string or Date) and optionally `now` for tests.
 */
export function AgingBadge({
  createdAt,
  now = new Date(),
  className,
}: {
  createdAt: string | Date;
  now?: Date;
  className?: string;
}) {
  const created = new Date(createdAt);
  const ms = now.getTime() - created.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  let tone = 'bg-muted text-muted-foreground border-border';
  let label = 'Today';
  if (days <= 0) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    label = hours <= 0 ? 'Just now' : `${hours}h old`;
  } else if (days === 1) {
    label = '1d old';
  } else if (days < 3) {
    label = `${days}d old`;
  } else if (days <= 5) {
    label = `${days}d old`;
    tone = 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900';
  } else {
    label = `${days}d old`;
    tone = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900';
  }
  return (
    <Badge variant="outline" className={cn('text-[10px] font-medium border tabular-nums gap-1', tone, className)}>
      <Clock className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}

/**
 * SLA overdue indicator — small rose badge shown when a row has an active
 * SLA breach or its due date is in the past.
 */
export function OverdueSlaIndicator({
  overdue,
  className,
  label = 'SLA overdue',
}: {
  overdue: boolean;
  className?: string;
  label?: string;
}) {
  if (!overdue) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-semibold border gap-1 bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
        className,
      )}
    >
      <AlertTriangle className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}

/**
 * Select-all checkbox cell — drop-in for queue table headers.
 */
export function SelectAllCheckbox({
  allIds,
  selectedIds,
  onChange,
}: {
  allIds: string[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const someSelected = selectedIds.length > 0 && !allSelected;
  return (
    <Checkbox
      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
      onCheckedChange={(v) => {
        if (v) onChange(allIds);
        else onChange([]);
      }}
      aria-label="Select all rows"
    />
  );
}

/**
 * Row-level select checkbox cell — must be wrapped in a stopPropagation onClick
 * so the row click handler doesn't fire.
 */
export function RowCheckbox({
  id,
  selectedIds,
  onChange,
}: {
  id: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const checked = selectedIds.includes(id);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => {
          if (v) onChange([...selectedIds, id]);
          else onChange(selectedIds.filter((x) => x !== id));
        }}
        aria-label={`Select row ${id}`}
      />
    </div>
  );
}

/* ============================================================================
 * Sort helpers — apply a SortKey to a list of rows.
 * Consumers pass their own comparator implementations if they want, but the
 * common sort for Demand / Ticket queues is provided here.
 * ============================================================================ */

export function sortByAge<T extends { createdAt: string }>(rows: T[], dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return dir === 'asc' ? ta - tb : tb - ta;
  });
}

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
export function sortByPriority<T extends { priority?: string | null }>(rows: T[], dir: 'asc' | 'desc' = 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.priority ? PRIORITY_RANK[a.priority] ?? 99 : 99;
    const rb = b.priority ? PRIORITY_RANK[b.priority] ?? 99 : 99;
    return dir === 'desc' ? ra - rb : rb - ra;
  });
}

export function sortByCustomer<
  T extends { serviceCustomerName?: string | null; customerName?: string | null },
>(rows: T[], dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...rows].sort((a, b) => {
    const na = (a.serviceCustomerName ?? a.customerName ?? '').toLowerCase();
    const nb = (b.serviceCustomerName ?? b.customerName ?? '').toLowerCase();
    return dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
  });
}

export function sortByOwner<
  T extends { assignedScmWorkerName?: string | null; assignedUserName?: string | null; ownerName?: string | null },
>(rows: T[], dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...rows].sort((a, b) => {
    const na = (a.assignedScmWorkerName ?? a.assignedUserName ?? a.ownerName ?? '').toLowerCase();
    const nb = (b.assignedScmWorkerName ?? b.assignedUserName ?? b.ownerName ?? '').toLowerCase();
    return dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
  });
}
