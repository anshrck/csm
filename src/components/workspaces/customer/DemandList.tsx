'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, PlusCircle, Search } from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  type Demand,
  type DemandStatus,
  DEMAND_STATUS_LABELS,
} from '@/lib/types';
import {
  PageHeader,
  DataTable,
  DemandStatusBadge,
  FormattedDate,
  RelativeTime,
  EmptyState,
  LoadingState,
  Button,
  Badge,
  type Column,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  SavedFilters,
  DEMAND_PRESETS,
  matchPreset,
  type DemandQueueFilters,
  type PresetFilters,
} from '@/components/workspaces/shared/SavedFilters';
import {
  QueueControls,
  AgingBadge,
  type SortKey,
  type ViewMode,
  type FilterChip,
  sortByAge,
  sortByCustomer,
  sortByOwner,
} from '@/components/workspaces/shared/QueueControls';

const STATUS_FILTERS: { key: DemandStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'UNDER_REVIEW', label: 'Under Review' },
  { key: 'QUOTED', label: 'Quoted' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'IN_CHANGE', label: 'In Change' },
  { key: 'FULFILLED', label: 'Fulfilled' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'REDIRECTED', label: 'Redirected' },
];

// Customer-facing preset subset (excludes internal-only presets like
// "Unassigned" and "Pending Approval").
const CUSTOMER_PRESETS: PresetFilters<DemandQueueFilters>[] = DEMAND_PRESETS.filter((p) =>
  ['my-open-work', 'breaching-soon', 'waiting-customer', 'accepted-needs-change'].includes(p.id),
).map((p) => ({
  ...p,
  // For customers, "My Open Work" means all their open demands (not "assigned to me" — they don't have an SCM Worker identity).
  filters:
    p.id === 'my-open-work'
      ? { statuses: ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE'] }
      : p.filters,
}));

export default function DemandList() {
  const { navigate } = useApp();
  const [search, setSearch] = React.useState('');
  const [activeStatus, setActiveStatus] = React.useState<DemandStatus | 'ALL'>('ALL');
  const [breachingSoon, setBreachingSoon] = React.useState(false);
  const [waitingCustomer, setWaitingCustomer] = React.useState(false);
  const [acceptedNeedsChange, setAcceptedNeedsChange] = React.useState(false);

  // Sort + view state
  const [sort, setSort] = React.useState<SortKey>('age_asc');
  const [viewMode, setViewMode] = React.useState<ViewMode>('table');

  const demandsQ = useQuery({
    queryKey: ['demands', 'mine'],
    queryFn: () => apiGet<Demand[]>('/api/demands?mine=1'),
  });

  // SLA events for breachingSoon filter + indicator
  const { data: slaEvents = [] } = useQuery({
    queryKey: ['sla-events', 'mine'],
    queryFn: () => apiGet<Array<{ id: string; serviceId: string; resolvedAt: string | null; createdAt: string }>>('/api/sla-events').catch(() => []),
  });

  const allDemands = demandsQ.data ?? [];

  const demandsWithOpenBreach = React.useMemo(() => {
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

  const currentFilters: DemandQueueFilters = React.useMemo(() => {
    const f: DemandQueueFilters = {};
    if (activeStatus !== 'ALL') f.statuses = [activeStatus];
    if (breachingSoon) f.breachingSoon = true;
    if (waitingCustomer) f.waitingCustomer = true;
    if (acceptedNeedsChange) f.acceptedNeedsChange = true;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [activeStatus, breachingSoon, waitingCustomer, acceptedNeedsChange, search]);

  const activePresetId = React.useMemo(
    () => matchPreset(CUSTOMER_PRESETS, currentFilters),
    [currentFilters],
  );
  const isCustom = !activePresetId && Object.keys(currentFilters).length > 0;

  function applyPreset(filters: DemandQueueFilters) {
    setActiveStatus(filters.statuses?.[0] ?? 'ALL');
    setBreachingSoon(!!filters.breachingSoon);
    setWaitingCustomer(!!filters.waitingCustomer);
    setAcceptedNeedsChange(!!filters.acceptedNeedsChange);
    setSearch(filters.search ?? '');
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDemands
      .filter((d) => (activeStatus === 'ALL' ? true : d.status === activeStatus))
      .filter((d) => (breachingSoon ? demandsWithOpenBreach.has(d.id) : true))
      .filter((d) => (waitingCustomer ? ['QUOTED', 'REDIRECTED', 'IN_CHANGE'].includes(d.status) : true))
      .filter((d) => (acceptedNeedsChange ? (d.status === 'ACCEPTED' && !d.changeRequestId) : true))
      .filter((d) => (q ? d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) : true));
  }, [allDemands, activeStatus, breachingSoon, waitingCustomer, acceptedNeedsChange, search, demandsWithOpenBreach]);

  const sorted = React.useMemo(() => {
    switch (sort) {
      case 'age_asc':
        return sortByAge(filtered, 'asc');
      case 'priority_desc':
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

  const filterChips: FilterChip[] = React.useMemo(() => {
    const chips: FilterChip[] = [];
    if (search.trim()) chips.push({ key: 'search', label: `Search: "${search.trim()}"` });
    if (activeStatus !== 'ALL') chips.push({ key: 'status', label: `Status: ${DEMAND_STATUS_LABELS[activeStatus]}` });
    if (breachingSoon) chips.push({ key: 'breaching', label: 'Breaching soon' });
    if (waitingCustomer) chips.push({ key: 'waiting', label: 'Waiting customer' });
    if (acceptedNeedsChange) chips.push({ key: 'needschange', label: 'Accepted needs change' });
    return chips;
  }, [search, activeStatus, breachingSoon, waitingCustomer, acceptedNeedsChange]);

  function removeFilter(key: string) {
    if (key === 'search') setSearch('');
    else if (key === 'status') setActiveStatus('ALL');
    else if (key === 'breaching') setBreachingSoon(false);
    else if (key === 'waiting') setWaitingCustomer(false);
    else if (key === 'needschange') setAcceptedNeedsChange(false);
  }

  function clearAllFilters() {
    setSearch('');
    setActiveStatus('ALL');
    setBreachingSoon(false);
    setWaitingCustomer(false);
    setAcceptedNeedsChange(false);
  }

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate max-w-[320px]">{d.title}</div>
            <AgingBadge createdAt={d.createdAt} />
            {demandsWithOpenBreach.has(d.id) && (
              <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                SLA breach
              </Badge>
            )}
          </div>
          {d.estimatedCost != null && (
            <div className="text-xs text-muted-foreground tabular-nums">
              ${d.estimatedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {d.estimatedEffortDays != null ? ` · ${d.estimatedEffortDays}d effort` : ''}
            </div>
          )}
        </div>
      ),
      className: 'max-w-[360px]',
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <DemandStatusBadge status={d.status} />,
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (d) => <FormattedDate date={d.createdAt} />,
    },
    {
      key: 'scm',
      header: 'SCM Worker',
      render: (d) =>
        d.assignedScmWorkerName ? (
          <span className="text-sm">{d.assignedScmWorkerName}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">Unassigned</span>
        ),
    },
    {
      key: 'updated',
      header: 'Last update',
      render: (d) => <RelativeTime date={d.updatedAt} />,
      headerClassName: 'text-right',
      className: 'text-right',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Demands"
        description="All service demands submitted by your organisational unit."
        icon={<FileText className="h-5 w-5" />}
        actions={
          <Button onClick={() => navigate('submit-demand')} className="gap-2">
            <PlusCircle className="h-4 w-4" /> New Demand
          </Button>
        }
      />

      {/* Saved filters + presets */}
      <SavedFilters<DemandQueueFilters>
        presets={CUSTOMER_PRESETS}
        activePresetId={activePresetId}
        onApply={(p) => applyPreset(p.filters)}
        currentFilters={currentFilters}
        isCustom={isCustom}
        storageKey={`queue-filters:customer:demands`}
      />

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by title or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <Search className="h-4 w-4 opacity-0" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveStatus(f.key)}
              className={cn(
                'inline-flex items-center h-8 px-3 rounded-md text-xs font-medium border transition-colors',
                activeStatus === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-accent hover:text-accent-foreground border-border',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Queue controls: sort + chips + view toggle */}
        <QueueControls
          sort={sort}
          onSortChange={setSort}
          filterChips={filterChips}
          onRemoveFilter={removeFilter}
          onClearAllFilters={clearAllFilters}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hideViewToggle={false}
        />
      </div>

      {demandsQ.isLoading ? (
        <LoadingState rows={6} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title={allDemands.length > 0 ? 'No matching demands' : 'No demands yet'}
          description={
            allDemands.length > 0
              ? 'Try adjusting your filters or search query.'
              : 'Submit your first demand to start the SCM engagement workflow.'
          }
          action={
            <Button onClick={() => navigate('submit-demand')} className="gap-2">
              <PlusCircle className="h-4 w-4" /> Submit a Demand
            </Button>
          }
        />
      ) : viewMode === 'table' ? (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {sorted.length} of {allDemands.length} demands
          </p>
          <DataTable
            columns={columns}
            rows={sorted}
            onRowClick={(d) => navigate('demand-detail', { id: d.id })}
            empty="No matching demands."
          />
        </>
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
                <span className="text-muted-foreground">
                  {d.estimatedCost != null ? `$${d.estimatedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                </span>
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
  );
}
