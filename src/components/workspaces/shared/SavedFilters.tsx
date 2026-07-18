'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Filter,
  Star,
  Trash2,
  X,
} from 'lucide-react';

/* ============================================================================
 * SavedFilters — reusable preset + custom-saved filter bar for queue pages.
 *
 * The component is intentionally agnostic about the shape of "filters". The
 * consumer passes:
 *   - presets: built-in named filter bundles the queue wants to surface.
 *   - activePresetId: id of the currently active preset (null = none/custom).
 *   - onApply(preset): callback invoked when a preset button is clicked.
 *   - currentFilters: snapshot of the filter state — used to decide whether
 *       the "Save current filters" action is enabled.
 *   - storageKey: localStorage key for persisting user-saved presets.
 *
 * Custom-saved presets are stored as `{ id, name, filters }` in localStorage
 * and surfaced as additional preset buttons after the built-in ones. Clicking
 * the trash icon on a custom preset removes it.
 *
 * ============================================================================ */

export interface PresetFilters<F = Record<string, unknown>> {
  id: string;
  label: string;
  /** Tooltip shown on hover (optional). */
  hint?: string;
  /** The opaque filter payload the consumer knows how to apply. */
  filters: F;
  /** Icon component (optional). */
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SavedFiltersProps<F = Record<string, unknown>> {
  /** Built-in presets the queue wants to surface. */
  presets: PresetFilters<F>[];
  /** id of the currently active preset (built-in or custom), or null. */
  activePresetId: string | null;
  /** Apply a preset. Receives the full preset object. */
  onApply: (preset: PresetFilters<F>) => void;
  /** Current filter snapshot. Used to enable/disable "Save current filters". */
  currentFilters: F;
  /** True when currentFilters matches no preset (enables the save button). */
  isCustom?: boolean;
  /**
   * localStorage key for user-saved presets. If omitted, custom-save is hidden.
   * Recommended: include the role + queue name to avoid cross-page collisions.
   */
  storageKey?: string;
  className?: string;
}

interface StoredPreset {
  id: string;
  name: string;
  filters: unknown;
  savedAt: string;
}

export function SavedFilters<F = Record<string, unknown>>({
  presets,
  activePresetId,
  onApply,
  currentFilters,
  isCustom = true,
  storageKey,
  className,
}: SavedFiltersProps<F>) {
  const [saved, setSaved] = React.useState<StoredPreset[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState('');

  // Load saved presets from localStorage on mount.
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSaved(parsed);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, [storageKey]);

  const persist = React.useCallback(
    (next: StoredPreset[]) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
    },
    [storageKey],
  );

  function handleSave() {
    if (!storageKey) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry: StoredPreset = {
      id: `custom-${Date.now()}`,
      name: trimmed,
      filters: currentFilters,
      savedAt: new Date().toISOString(),
    };
    const next = [...saved, entry];
    setSaved(next);
    persist(next);
    setName('');
    setSaving(false);
  }

  function handleDelete(id: string) {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    persist(next);
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
            <Filter className="h-3.5 w-3.5" /> Presets:
          </span>

          {presets.map((p) => {
            const active = activePresetId === p.id;
            const Icon = p.icon;
            return (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onApply(p)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background text-foreground/80 hover:bg-accent hover:text-accent-foreground border-border',
                    )}
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {p.label}
                  </button>
                </TooltipTrigger>
                {p.hint && (
                  <TooltipContent side="bottom" className="max-w-xs">
                    {p.hint}
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}

          {saved.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              {saved.map((s) => {
                const active = activePresetId === s.id;
                return (
                  <span
                    key={s.id}
                    className={cn(
                      'inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md text-xs font-medium border transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground/80 hover:bg-accent border-border',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onApply({
                          id: s.id,
                          label: s.name,
                          filters: s.filters as F,
                        })
                      }
                      className="inline-flex items-center gap-1.5"
                    >
                      <Star className="h-3 w-3" />
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      aria-label={`Delete saved filter ${s.name}`}
                      className="ml-0.5 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </>
          )}

          {storageKey && isCustom && !saving && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => setSaving(true)}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save current
            </Button>
          )}

          {saving && (
            <span className="inline-flex items-center gap-1 h-7">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') {
                    setSaving(false);
                    setName('');
                  }
                }}
                placeholder="Preset name…"
                className="h-7 w-36 text-xs px-2"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleSave}
                disabled={!name.trim()}
                aria-label="Confirm save preset"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setSaving(false);
                  setName('');
                }}
                aria-label="Cancel save preset"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ============================================================================
 * Built-in demand queue presets.
 *
 * These map to the six presets called out in Phase 8 item 20 of the plan.
 * Consumers can import DEMAND_PRESETS and pass it straight to <SavedFilters/>
 * — or build their own preset list.
 * ============================================================================ */

import type { DemandStatus } from '@/lib/types';

/** Filter shape used by the demand queues (SCM Worker + CM Leader). */
export interface DemandQueueFilters {
  /** Subset of demand statuses to include. Empty = all. */
  statuses?: DemandStatus[];
  /** True → only demands with no assignedScmWorkerId. */
  unassignedOnly?: boolean;
  /** True → only demands assigned to the current user. */
  mineOnly?: boolean;
  /** True → only demands that have an open (non-resolved) SLA breach event. */
  breachingSoon?: boolean;
  /** True → only demands whose last event indicates waiting on the customer. */
  waitingCustomer?: boolean;
  /** True → demands where the quote is filled but not yet approved (CM Leader). */
  pendingApproval?: boolean;
  /** True → ACCEPTED demands that don't yet have a change request created. */
  acceptedNeedsChange?: boolean;
  /** Free-text search query. */
  search?: string;
  /** Worker id filter. */
  workerId?: string | 'all';
  /** Customer id filter. */
  customerId?: string | 'all';
}

export const DEMAND_PRESETS: PresetFilters<DemandQueueFilters>[] = [
  {
    id: 'my-open-work',
    label: 'My Open Work',
    icon: Bookmark,
    hint: 'Demands assigned to you that are not yet fulfilled or closed.',
    filters: { mineOnly: true, statuses: ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE'] },
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    icon: Bookmark,
    hint: 'Demands no SCM Worker has picked up yet.',
    filters: { unassignedOnly: true },
  },
  {
    id: 'breaching-soon',
    label: 'Breaching Soon',
    icon: Bookmark,
    hint: 'Demands with an open SLA breach or warning event.',
    filters: { breachingSoon: true },
  },
  {
    id: 'waiting-customer',
    label: 'Waiting Customer',
    icon: Bookmark,
    hint: 'Demands blocked on a customer response (QUOTED, REDIRECTED, IN_CHANGE).',
    filters: { waitingCustomer: true, statuses: ['QUOTED', 'REDIRECTED', 'IN_CHANGE'] },
  },
  {
    id: 'pending-approval',
    label: 'Pending Approval',
    icon: Bookmark,
    hint: 'Demands with a drafted quote awaiting CM Leader approval.',
    filters: { pendingApproval: true, statuses: ['UNDER_REVIEW'] },
  },
  {
    id: 'accepted-needs-change',
    label: 'Accepted Needs Change',
    icon: Bookmark,
    hint: 'Accepted demands with no change request opened yet.',
    filters: { acceptedNeedsChange: true, statuses: ['ACCEPTED'] },
  },
];

/** Helper: shallow-compares two filter objects (treats undefined keys as missing). */
export function filtersEqual<F = DemandQueueFilters>(a?: F, b?: F): boolean {
  const aKeys = a ? Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined) : [];
  const bKeys = b ? Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined) : [];
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((x, i) => x !== bv[i])) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

/** Returns the id of the preset whose filters match `current`, or null. */
export function matchPreset<F = DemandQueueFilters>(
  presets: PresetFilters<F>[],
  current: F,
): string | null {
  for (const p of presets) {
    if (filtersEqual(p.filters, current)) return p.id;
  }
  return null;
}

/** Trash icon re-export for callers that want it. */
export { Trash2 };
