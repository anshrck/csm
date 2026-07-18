'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  DataTable,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  Button,
  Badge,
  type Column,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Ticket as TicketIcon, Inbox, UserPlus, AlertTriangle } from 'lucide-react';
import type {
  Ticket,
  TicketStatus,
  TicketPriority,
} from '@/lib/tickets';
import {
  TICKET_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_SHORT,
} from '@/lib/tickets';
import { cn } from '@/lib/utils';
import {
  SavedFilters,
  type PresetFilters,
} from '@/components/workspaces/shared/SavedFilters';
import {
  QueueControls,
  AgingBadge,
  OverdueSlaIndicator,
  RowCheckbox,
  SelectAllCheckbox,
  type SortKey,
  type ViewMode,
  type FilterChip,
  sortByAge,
  sortByPriority,
  sortByCustomer,
  sortByOwner,
} from '@/components/workspaces/shared/QueueControls';

/* ============================================================================
 * TicketQueue — shared queue page for tickets.
 *
 * This component is a drop-in queue view for the Ticket domain. It uses the
 * same SavedFilters + QueueControls primitives as the demand queues so SCM
 * Workers and CM Leaders get a consistent work-management UX.
 *
 * Built as a wrapper that other agents' workspace components can adopt
 * directly (e.g. by rendering <TicketQueue role={role} /> in the workspace
 * switch). The component is self-contained: it fetches `/api/tickets`,
 * applies role-aware filtering + the shared queue UX, and routes clicks into
 * the in-app `navigate('ticket-detail', { id })` view (gracefully no-ops if
 * the workspace doesn't handle that view yet).
 * ============================================================================ */

export interface TicketQueueFilters {
  statuses?: TicketStatus[];
  priorities?: TicketPriority[];
  unassignedOnly?: boolean;
  mineOnly?: boolean;
  breachingSoon?: boolean;
  waitingCustomer?: boolean;
  search?: string;
}

const TICKET_PRESETS: PresetFilters<TicketQueueFilters>[] = [
  {
    id: 'my-open-work',
    label: 'My Open Work',
    hint: 'Tickets assigned to you that are not yet resolved or closed.',
    filters: {
      mineOnly: true,
      statuses: ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER'],
    },
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    hint: 'Tickets with no assignee.',
    filters: { unassignedOnly: true },
  },
  {
    id: 'breaching-soon',
    label: 'Breaching Soon',
    hint: 'Tickets with an at-risk or breached SLA clock.',
    filters: { breachingSoon: true },
  },
  {
    id: 'waiting-customer',
    label: 'Waiting Customer',
    hint: 'Tickets paused waiting for a customer response.',
    filters: { waitingCustomer: true, statuses: ['WAITING_CUSTOMER'] },
  },
  {
    id: 'p1-p2',
    label: 'P1 / P2',
    hint: 'High-priority incidents.',
    filters: { priorities: ['P1', 'P2'] },
  },
];

const ALL_STATUSES: TicketStatus[] = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'CANCELED',
];

const PRIORITY_RANK: Record<TicketPriority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

const priorityTone: Record<TicketPriority, string> = {
  P1: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  P2: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  P3: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  P4: 'bg-muted text-muted-foreground border-border',
};

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] font-semibold border tabular-nums', priorityTone[priority])}>
      {TICKET_PRIORITY_SHORT[priority]}
    </Badge>
  );
}

export interface TicketQueueProps {
  /** Optional heading override. Defaults to "Ticket Queue". */
  title?: string;
  /** Optional description override. */
  description?: string;
  /** Restrict to tickets for the current user only. */
  mineOnlyByDefault?: boolean;
  /** Optional className passthrough. */
  className?: string;
}

export default function TicketQueue({
  title = 'Ticket Queue',
  description = 'All tickets in your scope — pick up work, prioritise, and act on SLA risk.',
  mineOnlyByDefault = false,
  className,
}: TicketQueueProps) {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  // ---- Filter state ------------------------------------------------------
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<TicketStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<TicketPriority[]>([]);
  const [unassignedOnly, setUnassignedOnly] = React.useState(false);
  const [mineOnly, setMineOnly] = React.useState(mineOnlyByDefault);
  const [breachingSoon, setBreachingSoon] = React.useState(false);
  const [waitingCustomer, setWaitingCustomer] = React.useState(false);

  // ---- Sort / view state -------------------------------------------------
  const [sort, setSort] = React.useState<SortKey>('priority_desc');
  const [viewMode, setViewMode] = React.useState<ViewMode>('table');

  // ---- Selection state ---------------------------------------------------
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // ---- Bulk-assign dialog -----------------------------------------------
  const [bulkAssignOpen, setBulkAssignOpen] = React.useState(false);

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['tickets', 'queue'],
    queryFn: () => apiGet<Ticket[]>('/api/tickets'),
  });

  // Workers list for the bulk-assign dialog.
  const { data: workers = [] } = useQuery<Array<{ id: string; name: string; activeTickets?: number }>>({
    queryKey: ['workers', 'list'],
    queryFn: () => apiGet<Array<{ id: string; name: string; activeTickets?: number }>>('/api/stats?workers=1').catch(() => []),
  });

  const currentFilters: TicketQueueFilters = React.useMemo(() => {
    const f: TicketQueueFilters = {};
    if (statusFilter.length > 0) f.statuses = statusFilter;
    if (priorityFilter.length > 0) f.priorities = priorityFilter;
    if (unassignedOnly) f.unassignedOnly = true;
    if (mineOnly) f.mineOnly = true;
    if (breachingSoon) f.breachingSoon = true;
    if (waitingCustomer) f.waitingCustomer = true;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [statusFilter, priorityFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, search]);

  const isCustom = Object.keys(currentFilters).length > 0;

  function applyPreset(filters: TicketQueueFilters) {
    setStatusFilter(filters.statuses ?? []);
    setPriorityFilter(filters.priorities ?? []);
    setUnassignedOnly(!!filters.unassignedOnly);
    setMineOnly(!!filters.mineOnly || mineOnlyByDefault);
    setBreachingSoon(!!filters.breachingSoon);
    setWaitingCustomer(!!filters.waitingCustomer);
    setSearch(filters.search ?? '');
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (unassignedOnly && t.assignedUserId) return false;
      if (mineOnly && t.assignedUserId !== session?.id) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false;
      if (priorityFilter.length > 0 && !priorityFilter.includes(t.priority)) return false;
      if (waitingCustomer && t.status !== 'WAITING_CUSTOMER') return false;
      if (breachingSoon) {
        // We don't have SLA clocks loaded here — approximate with P1/P2 + open status.
        if (!['P1', 'P2'].includes(t.priority)) return false;
        if (['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status)) return false;
      }
      if (q) {
        const hay = `${t.number} ${t.title} ${t.description} ${t.serviceCustomerName ?? ''} ${t.assignedUserName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, priorityFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, session?.id]);

  const sorted = React.useMemo(() => {
    switch (sort) {
      case 'age_asc':
        return sortByAge(filtered, 'asc');
      case 'priority_desc':
        return sortByPriority(filtered, 'desc');
      case 'sla_due_asc':
        // Approximation: P1/P2 first, then by age.
        return [...filtered].sort((a, b) => {
          const pa = PRIORITY_RANK[a.priority] ?? 99;
          const pb = PRIORITY_RANK[b.priority] ?? 99;
          if (pa !== pb) return pa - pb;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      case 'customer_asc':
        return sortByCustomer(filtered, 'asc');
      case 'owner_asc':
        return sortByOwner(filtered, 'asc');
      default:
        return filtered;
    }
  }, [filtered, sort]);

  const filterChips: FilterChip[] = React.useMemo(() => {
    const chips: FilterChip[] = [];
    if (search.trim()) chips.push({ key: 'search', label: `Search: "${search.trim()}"` });
    for (const s of statusFilter) chips.push({ key: `status:${s}`, label: `Status: ${TICKET_STATUS_LABELS[s]}` });
    for (const p of priorityFilter) chips.push({ key: `priority:${p}`, label: `Priority: ${TICKET_PRIORITY_LABELS[p]}` });
    if (unassignedOnly) chips.push({ key: 'unassigned', label: 'Unassigned' });
    if (mineOnly) chips.push({ key: 'mine', label: 'My work' });
    if (breachingSoon) chips.push({ key: 'breaching', label: 'Breaching soon' });
    if (waitingCustomer) chips.push({ key: 'waiting', label: 'Waiting customer' });
    return chips;
  }, [search, statusFilter, priorityFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer]);

  function removeFilter(key: string) {
    if (key === 'search') setSearch('');
    else if (key === 'unassigned') setUnassignedOnly(false);
    else if (key === 'mine') setMineOnly(mineOnlyByDefault);
    else if (key === 'breaching') setBreachingSoon(false);
    else if (key === 'waiting') setWaitingCustomer(false);
    else if (key.startsWith('status:')) {
      const s = key.split(':')[1] as TicketStatus;
      setStatusFilter((prev) => prev.filter((x) => x !== s));
    } else if (key.startsWith('priority:')) {
      const p = key.split(':')[1] as TicketPriority;
      setPriorityFilter((prev) => prev.filter((x) => x !== p));
    }
  }

  function clearAllFilters() {
    setSearch('');
    setStatusFilter([]);
    setPriorityFilter([]);
    setUnassignedOnly(false);
    setMineOnly(mineOnlyByDefault);
    setBreachingSoon(false);
    setWaitingCustomer(false);
  }

  // ---- Bulk actions ------------------------------------------------------
  const bulkAssign = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) =>
      apiPatch(`/api/tickets/${id}`, { assignedUserId: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not assign ticket'),
  });

  async function handleBulkAssign(userId: string | null, ids: string[]) {
    const results = await Promise.allSettled(
      ids.map((id) => bulkAssign.mutateAsync({ id, userId })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (ok > 0) toast.success(`Assigned ${ok} ticket${ok === 1 ? '' : 's'}`);
    if (fail > 0) toast.error(`${fail} could not be assigned`);
    setSelectedIds([]);
    setBulkAssignOpen(false);
  }

  const columns: Column<Ticket>[] = React.useMemo(() => {
    return [
      {
        key: '_select',
        header: (
          <SelectAllCheckbox
            allIds={sorted.map((t) => t.id)}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        ),
        render: (t) => <RowCheckbox id={t.id} selectedIds={selectedIds} onChange={setSelectedIds} />,
        className: 'w-10',
        headerClassName: 'w-10',
      },
      {
        key: 'number',
        header: 'ID',
        render: (t) => (
          <span className="font-mono text-xs text-muted-foreground">{t.number}</span>
        ),
        className: 'w-24',
      },
      {
        key: 'title',
        header: 'Title',
        render: (t) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{t.title}</span>
              <PriorityBadge priority={t.priority} />
              <AgingBadge createdAt={t.createdAt} />
              {breachingSoon && t.priority !== 'P3' && t.priority !== 'P4' && (
                <OverdueSlaIndicator overdue label="At risk" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-[40ch]">{t.description}</p>
          </div>
        ),
        className: 'max-w-md',
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (t) => (
          <span className="text-sm text-muted-foreground truncate">{t.serviceCustomerName ?? '—'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => (
          <Badge variant="outline" className="text-xs">
            {TICKET_STATUS_LABELS[t.status]}
          </Badge>
        ),
      },
      {
        key: 'assignee',
        header: 'Assignee',
        render: (t) =>
          t.assignedUserName ? (
            <div className="flex items-center gap-1.5">
              <UserAvatar name={t.assignedUserName} size="sm" />
              <span className="text-sm truncate">{t.assignedUserName}</span>
            </div>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Unassigned
            </Badge>
          ),
      },
      {
        key: 'updated',
        header: 'Last updated',
        render: (t) => <RelativeTime date={t.updatedAt} className="text-xs text-muted-foreground" />,
      },
    ];
  }, [sorted, selectedIds, breachingSoon]);

  return (
    <div className={cn('space-y-5', className)}>
      <PageHeader
        title={title}
        description={description}
        icon={<TicketIcon className="h-5 w-5" />}
        actions={
          <Badge variant="outline" className="tabular-nums">
            {filtered.length} of {tickets.length}
          </Badge>
        }
      />

      {/* Saved filters + presets */}
      <SavedFilters<TicketQueueFilters>
        presets={TICKET_PRESETS}
        activePresetId={null}
        onApply={(p) => applyPreset(p.filters)}
        currentFilters={currentFilters}
        isCustom={isCustom}
        storageKey={`queue-filters:${session?.role ?? 'unknown'}:tickets`}
      />

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Input
            placeholder="Search by number, title, customer, assignee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-3"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter.length === 1 ? statusFilter[0] : undefined}
            onValueChange={(v) => v && setStatusFilter([v as TicketStatus])}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TICKET_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={priorityFilter.length === 1 ? priorityFilter[0] : undefined}
            onValueChange={(v) => v && setPriorityFilter([v as TicketPriority])}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {(['P1', 'P2', 'P3', 'P4'] as TicketPriority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Queue controls */}
      <QueueControls
        sort={sort}
        onSortChange={setSort}
        filterChips={filterChips}
        onRemoveFilter={removeFilter}
        onClearAllFilters={clearAllFilters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        bulkActions={[
          {
            id: 'assign',
            label: 'Assign to…',
            icon: UserPlus,
            onRun: () => setBulkAssignOpen(true),
          },
        ]}
      />

      {isLoading ? (
        <LoadingState rows={6} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="No tickets match your filters"
          description="Try clearing the status filter or search query."
        />
      ) : viewMode === 'table' ? (
        <DataTable
          columns={columns}
          rows={sorted}
          onRowClick={(t) => navigate('ticket-detail', { id: t.id })}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate('ticket-detail', { id: t.id })}
              className="text-left rounded-lg border p-4 hover:shadow-md hover:border-primary/40 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={t.priority} />
                  <Badge variant="outline" className="text-[10px]">
                    {TICKET_STATUS_LABELS[t.status]}
                  </Badge>
                </div>
                <AgingBadge createdAt={t.createdAt} />
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mb-1">{t.number}</div>
              <h3 className="font-medium text-sm line-clamp-2 mb-1">{t.title}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{t.description}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate">{t.serviceCustomerName ?? '—'}</span>
                {t.assignedUserName ? (
                  <span className="text-muted-foreground truncate ml-2">{t.assignedUserName}</span>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200 bg-amber-50">
                    Unassigned
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <BulkAssignDialog
        open={bulkAssignOpen}
        onOpenChange={setBulkAssignOpen}
        workers={workers}
        selectedCount={selectedIds.length}
        onAssign={(userId) => handleBulkAssign(userId, selectedIds)}
      />
    </div>
  );
}

function BulkAssignDialog({
  open,
  onOpenChange,
  workers,
  selectedCount,
  onAssign,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workers: Array<{ id: string; name: string; activeTickets?: number }>;
  selectedCount: number;
  onAssign: (userId: string | null) => void;
}) {
  const [workerId, setWorkerId] = React.useState<string>('');

  React.useEffect(() => {
    if (open) setWorkerId('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk assign tickets</DialogTitle>
          <DialogDescription>
            Choose an agent for the {selectedCount} selected ticket{selectedCount === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workers available.</p>
          ) : (
            workers.map((w) => (
              <button
                key={w.id}
                onClick={() => setWorkerId(w.id)}
                className={`w-full flex items-center justify-between gap-2 rounded-md border p-2.5 text-left transition-colors ${
                  workerId === w.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <UserAvatar name={w.name} size="sm" />
                  <span className="text-sm font-medium">{w.name}</span>
                </span>
                {typeof w.activeTickets === 'number' && (
                  <Badge variant="outline" className="text-[10px] tabular-nums">
                    {w.activeTickets} active
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!workerId || selectedCount === 0}
            onClick={() => onAssign(workerId || null)}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Assign {selectedCount > 0 ? `(${selectedCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AlertTriangle };
