'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  DataTable,
  DemandStatusBadge,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  EmptyState,
  LoadingState,
  Button,
  Card,
  CardContent,
  Badge,
  type Column,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ClipboardList,
  Search,
  PlusCircle,
  Filter,
  Inbox,
  Loader2,
} from 'lucide-react';
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';
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
  sortByPriority,
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

const EMPTY_FILTERS: DemandQueueFilters = {};

export default function DemandQueue() {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  // ---- Filter state (single source of truth for queue filtering) ----------
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<DemandStatus[]>([]);
  const [unassignedOnly, setUnassignedOnly] = React.useState(false);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [breachingSoon, setBreachingSoon] = React.useState(false);
  const [waitingCustomer, setWaitingCustomer] = React.useState(false);
  const [pendingApproval, setPendingApproval] = React.useState(false);
  const [acceptedNeedsChange, setAcceptedNeedsChange] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  // ---- Sort / view state --------------------------------------------------
  const [sort, setSort] = React.useState<SortKey>('age_asc');
  const [viewMode, setViewMode] = React.useState<ViewMode>('table');

  // ---- Selection state (bulk actions) ------------------------------------
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const { data: demands, isLoading } = useQuery<Demand[]>({
    queryKey: ['demands', 'all'],
    queryFn: () => apiGet('/api/demands'),
  });

  // Breach lookup — fetch SLA events to flag demands with open breaches.
  const { data: slaEvents = [] } = useQuery({
    queryKey: ['sla-events', 'all'],
    queryFn: () => apiGet<Array<{ id: string; serviceId: string; resolvedAt: string | null; createdAt: string }>>('/api/sla-events').catch(() => []),
  });

  const allDemands = demands ?? [];

  // Unique customer options for create dialog
  const customerOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of allDemands) {
      if (d.serviceCustomerId && d.serviceCustomerName) {
        m.set(d.serviceCustomerId, d.serviceCustomerName);
      }
    }
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [allDemands]);

  // Build the current filters object so we can match it against presets.
  const currentFilters: DemandQueueFilters = React.useMemo(() => {
    const f: DemandQueueFilters = {};
    if (statusFilter.length > 0) f.statuses = statusFilter;
    if (unassignedOnly) f.unassignedOnly = true;
    if (mineOnly) f.mineOnly = true;
    if (breachingSoon) f.breachingSoon = true;
    if (waitingCustomer) f.waitingCustomer = true;
    if (pendingApproval) f.pendingApproval = true;
    if (acceptedNeedsChange) f.acceptedNeedsChange = true;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [statusFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange, search]);

  const activePresetId = React.useMemo(
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
  }

  // Pre-compute the set of demand ids that have an open SLA breach (for both
  // the breachingSoon filter and the overdue indicator).
  const demandsWithOpenBreach = React.useMemo(() => {
    // We can't link sla-events to specific demands without a join, so we use
    // the demand's relatedServiceIds as a proxy: a demand is "breaching" if
    // any of its services has an unresolved BREACHED event.
    const breachingServices = new Set<string>();
    for (const e of slaEvents) {
      if (!e.resolvedAt) breachingServices.add(e.serviceId);
    }
    return new Set(
      allDemands
        .filter((d) => d.relatedServiceIds?.some((sid) => breachingServices.has(sid)))
        .map((d) => d.id),
    );
  }, [allDemands, slaEvents]);

  // ---- Filter pipeline ----------------------------------------------------
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDemands.filter((d) => {
      if (unassignedOnly && d.assignedScmWorkerId) return false;
      if (mineOnly && d.assignedScmWorkerId !== session?.id) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(d.status)) return false;
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
      if (q) {
        const hay = `${d.title} ${d.description} ${d.serviceCustomerName ?? ''} ${d.submittedByName ?? ''} ${d.assignedScmWorkerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allDemands, search, statusFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange, demandsWithOpenBreach, session?.id]);

  // ---- Sort pipeline ------------------------------------------------------
  const sorted = React.useMemo(() => {
    switch (sort) {
      case 'age_asc':
        return sortByAge(filtered, 'asc');
      case 'priority_desc':
        // Demands don't have priority — sort by status urgency as a proxy.
        return [...filtered].sort((a, b) => {
          const ra = ['NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IN_CHANGE', 'QUOTED', 'FULFILLED', 'CLOSED', 'REJECTED', 'REDIRECTED'].indexOf(a.status);
          const rb = ['NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IN_CHANGE', 'QUOTED', 'FULFILLED', 'CLOSED', 'REJECTED', 'REDIRECTED'].indexOf(b.status);
          return ra - rb;
        });
      case 'sla_due_asc':
        // Demands breaching soonest first.
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

  // ---- Filter chips (for QueueControls) -----------------------------------
  const filterChips: FilterChip[] = React.useMemo(() => {
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
    return chips;
  }, [search, statusFilter, unassignedOnly, mineOnly, breachingSoon, waitingCustomer, pendingApproval, acceptedNeedsChange]);

  function removeFilter(key: string) {
    if (key === 'search') setSearch('');
    else if (key === 'unassigned') setUnassignedOnly(false);
    else if (key === 'mine') setMineOnly(false);
    else if (key === 'breaching') setBreachingSoon(false);
    else if (key === 'waiting') setWaitingCustomer(false);
    else if (key === 'pending') setPendingApproval(false);
    else if (key === 'needschange') setAcceptedNeedsChange(false);
    else if (key.startsWith('status:')) {
      const s = key.split(':')[1] as DemandStatus;
      setStatusFilter((prev) => prev.filter((x) => x !== s));
    }
  }

  function clearAllFilters() {
    setSearch('');
    setStatusFilter([]);
    setUnassignedOnly(false);
    setMineOnly(false);
    setBreachingSoon(false);
    setWaitingCustomer(false);
    setPendingApproval(false);
    setAcceptedNeedsChange(false);
  }

  const createDemand = useMutation({
    mutationFn: (body: { title: string; description: string; serviceCustomerId: string }) =>
      apiPost<Demand>('/api/demands', body),
    onSuccess: (d) => {
      toast.success('Demand created on behalf of customer');
      qc.invalidateQueries({ queryKey: ['demands'] });
      setCreateOpen(false);
      navigate('demand-detail', { id: d.id });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create demand'),
  });

  // ---- Bulk assign (SCM Worker can re-assign their own; full bulk actions
  // are CM Leader only — SCM just gets a "pick up" action) -----------------
  const pickupDemand = useMutation({
    mutationFn: (id: string) => apiPatch<Demand>(`/api/demands/${id}`, { assignedScmWorkerId: session?.id }),
    onSuccess: () => {
      toast.success('Picked up demand(s)');
      qc.invalidateQueries({ queryKey: ['demands'] });
      setSelectedIds([]);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not pick up demand'),
  });

  const columns: Column<Demand>[] = React.useMemo(() => {
    const base: Column<Demand>[] = [
      {
        key: '_select',
        header: (
          <SelectAllCheckbox
            allIds={sorted.map((d) => d.id)}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        ),
        render: (d) => (
          <RowCheckbox id={d.id} selectedIds={selectedIds} onChange={setSelectedIds} />
        ),
        className: 'w-10',
        headerClassName: 'w-10',
      },
      {
        key: 'title',
        header: 'Title',
        render: (d) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate max-w-[28ch]">{d.title}</p>
              <AgingBadge createdAt={d.createdAt} />
              {demandsWithOpenBreach.has(d.id) && (
                <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                  SLA breach
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-[40ch]">{d.description}</p>
          </div>
        ),
        className: 'max-w-md',
      },
      {
        key: 'customer',
        header: 'Service Customer',
        render: (d) => (
          <span className="text-sm">{d.serviceCustomerName ?? '—'}</span>
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
            <div className="flex items-center gap-2">
              <UserAvatar name={d.assignedScmWorkerName} size="sm" />
              <span className="text-sm truncate">{d.assignedScmWorkerName}</span>
            </div>
          ) : (
            <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50">
              Unassigned
            </Badge>
          ),
      },
      {
        key: 'created',
        header: 'Created',
        render: (d) => <FormattedDate date={d.createdAt} className="text-sm" />,
      },
      {
        key: 'updated',
        header: 'Last updated',
        render: (d) => <RelativeTime date={d.updatedAt} className="text-sm text-muted-foreground" />,
      },
    ];
    return base;
  }, [sorted, selectedIds, demandsWithOpenBreach]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demand Queue"
        description="All demands across the tenant — filter, search, and pick up work."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Demand on behalf
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Saved / preset filters */}
          <SavedFilters<DemandQueueFilters>
            presets={DEMAND_PRESETS}
            activePresetId={activePresetId}
            onApply={(p) => applyPreset(p.filters)}
            currentFilters={currentFilters}
            isCustom={isCustom}
            storageKey={`queue-filters:scm-worker:demands`}
          />

          {/* Search + unassigned switch */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, customer, submitter, worker…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 px-1">
              <Switch
                id="unassigned-switch"
                checked={unassignedOnly}
                onCheckedChange={setUnassignedOnly}
              />
              <Label htmlFor="unassigned-switch" className="text-sm cursor-pointer">
                Unassigned only
              </Label>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Switch
                id="mine-switch"
                checked={mineOnly}
                onCheckedChange={setMineOnly}
              />
              <Label htmlFor="mine-switch" className="text-sm cursor-pointer">
                Mine only
              </Label>
            </div>
          </div>

          {/* Status multi-toggle */}
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mt-2">
              <Filter className="h-3.5 w-3.5" /> Status:
            </div>
            <ToggleGroup
              type="multiple"
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as DemandStatus[])}
              variant="outline"
              className="flex-wrap"
            >
              {STATUS_OPTIONS.map((s) => (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className="text-xs h-7 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {DEMAND_STATUS_LABELS[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {statusFilter.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 mt-0.5"
                onClick={() => setStatusFilter([])}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Queue controls: sort + chips + view toggle + bulk actions */}
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
                id: 'pickup',
                label: 'Pick up selected',
                onRun: (ids) => {
                  Promise.all(ids.map((id) => pickupDemand.mutateAsync(id)))
                    .then(() => toast.success(`Picked up ${ids.length} demand(s)`))
                    .catch((e) => toast.error(e.message || 'Could not pick up'));
                },
              },
            ]}
          />

          <div className="text-xs text-muted-foreground">
            {sorted.length} of {allDemands.length} demands
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState rows={6} />
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="No demands match your filters"
              description="Try clearing the status filter or search query."
            />
          </CardContent>
        </Card>
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

      <CreateDemandDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customers={customerOptions}
        submitting={createDemand.isPending}
        onSubmit={(body) => createDemand.mutate(body)}
      />
    </div>
  );
}

function CreateDemandDialog({
  open,
  onOpenChange,
  customers,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: { id: string; name: string }[];
  submitting: boolean;
  onSubmit: (body: { title: string; description: string; serviceCustomerId: string }) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [customerId, setCustomerId] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setCustomerId('');
    }
  }, [open]);

  const valid = title.trim().length > 2 && description.trim().length > 2 && !!customerId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Demand on behalf of customer</DialogTitle>
          <DialogDescription>
            Capture a demand raised verbally or by email. The customer will be able to track it in their portal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              placeholder="e.g. Procurement self-service portal module"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Description</Label>
            <Textarea
              id="d-desc"
              rows={4}
              placeholder="Describe what the customer needs and why…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-cust">Service Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="d-cust" className="w-full">
                <SelectValue placeholder="Select customer organisation" />
              </SelectTrigger>
              <SelectContent>
                {customers.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No customers available
                  </SelectItem>
                ) : (
                  customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ title: title.trim(), description: description.trim(), serviceCustomerId: customerId })}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create demand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
