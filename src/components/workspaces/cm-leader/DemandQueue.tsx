'use client';

import { useQuery } from '@tanstack/react-query';
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
import { Search, Filter, UserPlus, Inbox, FileText, X } from 'lucide-react';
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
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';

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
  const { navigate } = useApp();
  const demandsQ = useDemands();
  const statsQ = useLeaderStats();
  const assign = useAssignDemand();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DemandStatus[]>([]);
  const [workerFilter, setWorkerFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  const demands = demandsQ.data ?? [];
  const workers = statsQ.data?.workloadByWorker ?? [];

  const customers = useMemo(() => {
    const m = new Map<string, string>();
    demands.forEach((d) => {
      if (d.serviceCustomerId) m.set(d.serviceCustomerId, d.serviceCustomerName ?? 'Customer');
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [demands]);

  const filtered = useMemo(() => {
    return demands.filter((d) => {
      if (unassignedOnly && d.assignedScmWorkerId) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(d.status)) return false;
      if (workerFilter !== 'all' && d.assignedScmWorkerId !== workerFilter) return false;
      if (customerFilter !== 'all' && d.serviceCustomerId !== customerFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${d.title} ${d.description} ${d.serviceCustomerName ?? ''} ${d.assignedScmWorkerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [demands, search, statusFilter, workerFilter, customerFilter, unassignedOnly]);

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0 max-w-[260px]">
          <div className="font-medium text-sm truncate">{d.title}</div>
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

  const hasFilters = search || statusFilter.length > 0 || workerFilter !== 'all' || customerFilter !== 'all' || unassignedOnly;

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

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => {
                setSearch('');
                setStatusFilter([]);
                setWorkerFilter('all');
                setCustomerFilter('all');
                setUnassignedOnly(false);
              }}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </div>

        {unassignedOnly && workerFilter !== '__unassigned' && (
          <div className="mt-3" />
        )}

        <div className="mt-4">
          {demandsQ.isLoading ? (
            <LoadingState rows={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8 text-muted-foreground/50" />}
              title="No demands match your filters"
              description="Try adjusting the filters above."
            />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              onRowClick={(d) => navigate('demand-detail', { id: d.id })}
            />
          )}
        </div>
      </SectionCard>
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
