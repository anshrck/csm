'use client';

import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import {
  PageHeader,
  SectionCard,
  DemandStatusBadge,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  DataTable,
  type Column,
  Button,
  Badge,
} from '@/components/shared';
import { useDemands, useLeaderStats, useAssignDemand, type WorkloadItem } from './Dashboard';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Filter, UserPlus, Inbox, FileText, X, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';
import {
  SavedFilters,
  DEMAND_PRESETS,
  matchPreset,
  type DemandQueueFilters,
} from '@/components/workspaces/shared/SavedFilters';
import {
  QueueControls,
  AgingBadge,
  RowCheckbox,
  SelectAllCheckbox,
  type SortKey,
  type ViewMode,
  type FilterChip,
  sortByAge,
  sortByCustomer,
  sortByOwner,
} from '@/components/workspaces/shared/QueueControls';

const STATUS_OPTIONS: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
  'FULFILLED',
  'CLOSED',
  'REJECTED',
  'REDIRECTED',
];

export default function DemandQueue() {
  const { navigate, session } = useApp();
  const qc = useQueryClient();
  const demandsQ = useDemands();
  const statsQ = useLeaderStats();
  const assign = useAssignDemand();

  // ---- Filter state -------------------------------------------------------
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DemandStatus[]>([]);
  const [workerFilter, setWorkerFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [breachingSoon, setBreachingSoon] = useState(false);
  const [waitingCustomer, setWaitingCustomer] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [acceptedNeedsChange, setAcceptedNeedsChange] = useState(false);

  // ---- Sort / view state --------------------------------------------------
  const [sort, setSort] = useState<SortKey>('age_asc');
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  // ---- Selection state ----------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ---- Bulk-assign dialog state ------------------------------------------
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  const demands = demandsQ.data ?? [];
  const workers = statsQ.data?.workloadByWorker ?? [];

  // SLA events for the breachingSoon filter + overdue indicator.
  const { data: slaEvents = [] } = useQuery({
    queryKey: ['cm-leader', 'sla-events-all'],
    queryFn: () => apiGet<Array<{ id: string; serviceId: string; resolvedAt: string | null; createdAt: string }>>('/api/sla-events').catch(() => []),
  });

  const customers = useMemo(() => {
    const m = new Map<string, string>();
    demands.forEach((d) => {
      if (d.serviceCustomerId) m.set(d.serviceCustomerId, d.serviceCustomerName ?? 'Customer');
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [demands]);

  // Set of demand ids with an open SLA breach (proxy: relatedService has
  // an unresolved BREACHED/WARNING event).
  const demandsWithOpenBreach = useMemo(() => {
    const breachingServices = new Set<string>();
    for (const e of slaEvents) {
      if (!e.resolvedAt) breachingServices.add(e.serviceId);
    }
    return new Set(
      demands
        .filter((d) => d.relatedServiceIds?.some((sid) => breachingServices.has(sid)))
        .map((d) => d.id),
    );
  }, [demands, slaEvents]);

  const currentFilters: DemandQueueFilters = useMemo(() => {
    const f: DemandQueueFilters = {};
    if (statusFilter.length > 0) f.statuses = statusFilter;
    if (unassignedOnly) f.unassignedOnly = true;
    if (mineOnly) f.mineOnly = true;
    if (breachingSoon) f.breachingSoon = true;
    if (waitingCustomer) f.waitingCustomer = true;
    if (pendingApproval) f.pendingApproval = true;
    if (acceptedNeedsChange) f.acceptedNeedsChange = true;
    if (search.trim()) f.search = search.trim();
    if (workerFilter !== 'all') f.workerId = workerFilter;
    if (customerFilter !== 'all') f.customerId = customerFilter;
    return f;
  }, [statusFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange, search, workerFilter, customerFilter]);

  const activePresetId = useMemo(
    () => matchPreset(DEMAND_PRESETS, currentFilters),
    [currentFilters],
  );
  const isCustom = !activePresetId && Object.keys(currentFilters).length > 0;

  function applyPreset(filters: DemandQueueFilters) {
    setStatusFilter(filters.statuses ?? []);
    setUnassignedOnly(!!filters.unassignedOnly);
    setMineOnly(!!filters.mineOnly);
    setBreachingSoon(!!filters.breachingSoon);
    setWaitingCustomer(!!filters.waitingCustomer);
    setPendingApproval(!!filters.pendingApproval);
    setAcceptedNeedsChange(!!filters.acceptedNeedsChange);
    setSearch(filters.search ?? '');
    setWorkerFilter(filters.workerId ?? 'all');
    setCustomerFilter(filters.customerId ?? 'all');
  }

  const filtered = useMemo(() => {
    return demands.filter((d) => {
      if (unassignedOnly && d.assignedScmWorkerId) return false;
      if (mineOnly && d.assignedScmWorkerId !== session?.id) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(d.status)) return false;
      if (workerFilter !== 'all') {
        if (workerFilter === '__unassigned') {
          if (d.assignedScmWorkerId) return false;
        } else if (d.assignedScmWorkerId !== workerFilter) return false;
      }
      if (customerFilter !== 'all' && d.serviceCustomerId !== customerFilter) return false;
      if (breachingSoon && !demandsWithOpenBreach.has(d.id)) return false;
      if (waitingCustomer && !['QUOTED', 'REDIRECTED', 'IN_CHANGE'].includes(d.status)) return false;
      if (pendingApproval) {
        if (d.status !== 'UNDER_REVIEW') return false;
        const hasQuote = (d.estimatedEffortDays != null || d.estimatedCost != null || !!d.quoteNotes);
        if (hasQuote && d.quoteApprovedByCmLeader) return false;
        if (!hasQuote) return false;
      }
      if (acceptedNeedsChange) {
        if (d.status !== 'ACCEPTED') return false;
        if (d.changeRequestId) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${d.title} ${d.description} ${d.serviceCustomerName ?? ''} ${d.assignedScmWorkerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [demands, search, statusFilter, workerFilter, customerFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange, demandsWithOpenBreach, session?.id]);

  const sorted = useMemo(() => {
    switch (sort) {
      case 'age_asc':
        return sortByAge(filtered, 'asc');
      case 'priority_desc':
        return [...filtered].sort((a, b) => {
          const ra = ['NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IN_CHANGE', 'QUOTED', 'FULFILLED', 'CLOSED', 'REJECTED', 'REDIRECTED'].indexOf(a.status);
          const rb = ['NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IN_CHANGE', 'QUOTED', 'FULFILLED', 'CLOSED', 'REJECTED', 'REDIRECTED'].indexOf(b.status);
          return ra - rb;
        });
      case 'sla_due_asc':
        return [...filtered].sort((a, b) => {
          const ab = demandsWithOpenBreach.has(a.id) ? 0 : 1;
          const bb = demandsWithOpenBreach.has(b.id) ? 0 : 1;
          if (ab !== bb) return ab - bb;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      case 'customer_asc':
        return sortByCustomer(filtered, 'asc');
      case 'owner_asc':
        return sortByOwner(filtered, 'asc');
      default:
        return filtered;
    }
  }, [filtered, sort, demandsWithOpenBreach]);

  const filterChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (search.trim()) chips.push({ key: 'search', label: `Search: "${search.trim()}"` });
    for (const s of statusFilter) {
      chips.push({ key: `status:${s}`, label: `Status: ${DEMAND_STATUS_LABELS[s]}` });
    }
    if (unassignedOnly) chips.push({ key: 'unassigned', label: 'Unassigned' });
    if (mineOnly) chips.push({ key: 'mine', label: 'My work' });
    if (breachingSoon) chips.push({ key: 'breaching', label: 'Breaching soon' });
    if (waitingCustomer) chips.push({ key: 'waiting', label: 'Waiting customer' });
    if (pendingApproval) chips.push({ key: 'pending', label: 'Pending approval' });
    if (acceptedNeedsChange) chips.push({ key: 'needschange', label: 'Accepted needs change' });
    if (workerFilter !== 'all') {
      const w = workers.find((x) => x.workerId === workerFilter);
      chips.push({ key: 'worker', label: `Worker: ${w?.workerName ?? workerFilter === '__unassigned' ? 'Unassigned' : workerFilter}` });
    }
    if (customerFilter !== 'all') {
      const c = customers.find((x) => x.id === customerFilter);
      chips.push({ key: 'customer', label: `Customer: ${c?.name ?? customerFilter}` });
    }
    return chips;
  }, [search, statusFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange, workerFilter, customerFilter, workers, customers]);

  function removeFilter(key: string) {
    if (key === 'search') setSearch('');
    else if (key === 'unassigned') setUnassignedOnly(false);
    else if (key === 'mine') setMineOnly(false);
    else if (key === 'breaching') setBreachingSoon(false);
    else if (key === 'waiting') setWaitingCustomer(false);
    else if (key === 'pending') setPendingApproval(false);
    else if (key === 'needschange') setAcceptedNeedsChange(false);
    else if (key === 'worker') setWorkerFilter('all');
    else if (key === 'customer') setCustomerFilter('all');
    else if (key.startsWith('status:')) {
      const s = key.split(':')[1] as DemandStatus;
      setStatusFilter((prev) => prev.filter((x) => x !== s));
    }
  }

  function clearAllFilters() {
    setSearch('');
    setStatusFilter([]);
    setWorkerFilter('all');
    setCustomerFilter('all');
    setUnassignedOnly(false);
    setMineOnly(false);
    setBreachingSoon(false);
    setWaitingCustomer(false);
    setPendingApproval(false);
    setAcceptedNeedsChange(false);
  }

  // ---- Bulk actions ------------------------------------------------------
  const bulkApprove = useMutation({
    mutationFn: (id: string) => apiPost(`/api/demands/${id}/approve-quote`, {}),
  });

  async function handleBulkApprove(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => bulkApprove.mutateAsync(id)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (ok > 0) toast.success(`Approved ${ok} quote${ok === 1 ? '' : 's'}`);
    if (fail > 0) toast.error(`${fail} could not be approved (only UNDER_REVIEW demands with a drafted quote can be approved)`);
    qc.invalidateQueries({ queryKey: ['cm-leader'] });
    setSelectedIds([]);
  }

  async function handleBulkAssign(workerId: string | null, ids: string[]) {
    const results = await Promise.allSettled(
      ids.map((id) => apiPatch(`/api/demands/${id}`, { assignedScmWorkerId: workerId })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (ok > 0) toast.success(`Assigned ${ok} demand${ok === 1 ? '' : 's'}`);
    if (fail > 0) toast.error(`${fail} could not be assigned`);
    qc.invalidateQueries({ queryKey: ['cm-leader'] });
    setSelectedIds([]);
    setBulkAssignOpen(false);
  }

  const columns: Column<Demand>[] = useMemo(() => {
    return [
      {
        key: '_select',
        header: (
          <SelectAllCheckbox
            allIds={sorted.map((d) => d.id)}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        ),
        render: (d) => <RowCheckbox id={d.id} selectedIds={selectedIds} onChange={setSelectedIds} />,
        className: 'w-10',
        headerClassName: 'w-10',
      },
      {
        key: 'title',
        header: 'Title',
        render: (d) => (
          <div className="min-w-0 max-w-[260px]">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm truncate">{d.title}</div>
              <AgingBadge createdAt={d.createdAt} />
              {demandsWithOpenBreach.has(d.id) && (
                <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                  SLA breach
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {d.serviceCustomerName ?? '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'customer',
        header: 'Service Customer',
        render: (d) => (
          <span className="text-sm text-muted-foreground truncate">{d.serviceCustomerName ?? '—'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (d) => <DemandStatusBadge status={d.status} />,
      },
      {
        key: 'worker',
        header: 'Assigned Worker',
        render: (d) =>
          d.assignedScmWorkerName ? (
            <div className="flex items-center gap-1.5">
              <UserAvatar name={d.assignedScmWorkerName} size="sm" />
              <span className="text-sm truncate">{d.assignedScmWorkerName}</span>
            </div>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Unassigned
            </Badge>
          ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        render: (d) => <RelativeTime date={d.createdAt} className="text-xs text-muted-foreground" />,
      },
      {
        key: 'updatedAt',
        header: 'Last updated',
        render: (d) => <RelativeTime date={d.updatedAt} className="text-xs text-muted-foreground" />,
      },
      {
        key: 'actions',
        header: '',
        render: (d) =>
          !d.assignedScmWorkerId ? (
            <div onClick={(e) => e.stopPropagation()}>
              <AssignMenu
                demand={d}
                workers={workers}
                onAssign={(workerId) => assign.mutate({ id: d.id, workerId })}
                disabled={assign.isPending}
              />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        className: 'text-right',
        headerClassName: 'text-right',
      },
    ];
  }, [sorted, selectedIds, demandsWithOpenBreach, workers, assign]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demand Queue"
        description="Full tenant view of all demands. Assign, review, and action any demand across the customer base."
        icon={<FileText className="h-5 w-5" />}
        actions={
          <Badge variant="outline" className="tabular-nums">
            {filtered.length} of {demands.length}
          </Badge>
        }
      />

      <SectionCard>
        {/* Saved / preset filters */}
        <SavedFilters<DemandQueueFilters>
          presets={DEMAND_PRESETS}
          activePresetId={activePresetId}
          onApply={(p) => applyPreset(p.filters)}
          currentFilters={currentFilters}
          isCustom={isCustom}
          storageKey={`queue-filters:cm-leader:demands`}
          className="mb-3"
        />

        {/* Filter bar */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search title, description, customer, worker…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="h-3.5 w-3.5" />
                  Status
                  {statusFilter.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                      {statusFilter.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="end">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Filter by status</p>
                  {STATUS_OPTIONS.map((s) => {
                    const checked = statusFilter.includes(s);
                    return (
                      <button
                        key={s}
                        onClick={() =>
                          setStatusFilter((prev) =>
                            checked ? prev.filter((x) => x !== s) : [...prev, s],
                          )
                        }
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-sm"
                      >
                        <span
                          className={`h-4 w-4 rounded border flex items-center justify-center ${
                            checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input'
                          }`}
                        >
                          {checked && <span className="text-[10px]">✓</span>}
                        </span>
                        {DEMAND_STATUS_LABELS[s]}
                      </button>
                    );
                  })}
                  {statusFilter.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 text-xs h-7"
                      onClick={() => setStatusFilter([])}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Select value={workerFilter} onValueChange={setWorkerFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Worker" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workers</SelectItem>
                <SelectItem value="__unassigned">Unassigned only</SelectItem>
                {workers.map((w) => (
                  <SelectItem key={w.workerId} value={w.workerId}>
                    {w.workerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 px-2 py-1 rounded-md border">
              <Switch
                id="unassigned"
                checked={unassignedOnly}
                onCheckedChange={setUnassignedOnly}
              />
              <Label htmlFor="unassigned" className="text-xs cursor-pointer">
                Unassigned
              </Label>
            </div>

            {(search || statusFilter.length > 0 || workerFilter !== 'all' || customerFilter !== 'all' || unassignedOnly || mineOnly || breachingSoon || waitingCustomer || pendingApproval || acceptedNeedsChange) && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Queue controls: sort + chips + view toggle + bulk actions */}
        <div className="mt-3">
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
              {
                id: 'approve',
                label: 'Approve quotes',
                icon: CheckCircle2,
                onRun: (ids) => handleBulkApprove(ids),
              },
            ]}
          />
        </div>

        <div className="mt-4">
          {demandsQ.isLoading ? (
            <LoadingState rows={6} />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8 text-muted-foreground/50" />}
              title="No demands match your filters"
              description="Try adjusting the filters above."
            />
          ) : viewMode === 'table' ? (
            <DataTable
              columns={columns}
              rows={sorted}
              onRowClick={(d) => navigate('demand-detail', { id: d.id })}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((d) => (
                <button
                  key={d.id}
                  onClick={() => navigate('demand-detail', { id: d.id })}
                  className="text-left rounded-lg border p-4 hover:shadow-md hover:border-primary/40 transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <DemandStatusBadge status={d.status} />
                    <AgingBadge createdAt={d.createdAt} />
                  </div>
                  <h3 className="font-medium text-sm line-clamp-2 mb-1">{d.title}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{d.description}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">{d.serviceCustomerName ?? '—'}</span>
                    {d.assignedScmWorkerName ? (
                      <span className="text-muted-foreground truncate ml-2">{d.assignedScmWorkerName}</span>
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
        </div>
      </SectionCard>

      <BulkAssignDialog
        open={bulkAssignOpen}
        onOpenChange={setBulkAssignOpen}
        workers={workers}
        selectedCount={selectedIds.length}
        onAssign={(workerId) => handleBulkAssign(workerId, selectedIds)}
      />
    </div>
  );
}

function AssignMenu({
  demand,
  workers,
  onAssign,
  disabled,
}: {
  demand: Demand;
  workers: WorkloadItem[];
  onAssign: (workerId: string) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled} className="h-7 gap-1.5">
          <UserPlus className="h-3.5 w-3.5" /> Assign
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Assign to SCM Worker
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workers.length === 0 ? (
          <DropdownMenuItem disabled>No workers available</DropdownMenuItem>
        ) : (
          workers
            .sort((a, b) => a.activeDemands - b.activeDemands)
            .map((w) => (
              <DropdownMenuItem
                key={w.workerId}
                onClick={() => onAssign(w.workerId)}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2">
                  <UserAvatar name={w.workerName} size="sm" />
                  <span className="text-sm">{w.workerName}</span>
                </span>
                <Badge variant="outline" className="text-[10px] tabular-nums">
                  {w.activeDemands}
                </Badge>
              </DropdownMenuItem>
            ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  workers: WorkloadItem[];
  selectedCount: number;
  onAssign: (workerId: string | null) => void;
}) {
  const [workerId, setWorkerId] = useState<string>('');

  React.useEffect(() => {
    if (open) setWorkerId('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk assign demands</DialogTitle>
          <DialogDescription>
            Choose an SCM Worker for the {selectedCount} selected demand{selectedCount === 1 ? '' : 's'}.
            The worker with the fewest active demands is listed first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workers available.</p>
          ) : (
            workers
              .slice()
              .sort((a, b) => a.activeDemands - b.activeDemands)
              .map((w) => (
                <button
                  key={w.workerId}
                  onClick={() => setWorkerId(w.workerId)}
                  className={`w-full flex items-center justify-between gap-2 rounded-md border p-2.5 text-left transition-colors ${
                    workerId === w.workerId
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <UserAvatar name={w.workerName} size="sm" />
                    <span className="text-sm font-medium">{w.workerName}</span>
                  </span>
                  <Badge variant="outline" className="text-[10px] tabular-nums">
                    {w.activeDemands} active
                  </Badge>
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
