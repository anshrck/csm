'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, PlusCircle, Search, X } from 'lucide-react';
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
  type Column,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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

export default function DemandList() {
  const { navigate } = useApp();
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState<DemandStatus | 'ALL'>('ALL');

  const demandsQ = useQuery({
    queryKey: ['demands', 'mine'],
    queryFn: () => apiGet<Demand[]>('/api/demands?mine=1'),
  });

  const filtered = useMemo(() => {
    const list = demandsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list
      .filter((d) => (activeStatus === 'ALL' ? true : d.status === activeStatus))
      .filter((d) => (q ? d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [demandsQ.data, search, activeStatus]);

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0">
          <div className="font-medium truncate max-w-[320px]">{d.title}</div>
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
              <X className="h-4 w-4" />
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
      </div>

      {demandsQ.isLoading ? (
        <LoadingState rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title={demandsQ.data && demandsQ.data.length > 0 ? 'No matching demands' : 'No demands yet'}
          description={
            demandsQ.data && demandsQ.data.length > 0
              ? 'Try adjusting your filters or search query.'
              : 'Submit your first demand to start the SCM engagement workflow.'
          }
          action={
            <Button onClick={() => navigate('submit-demand')} className="gap-2">
              <PlusCircle className="h-4 w-4" /> Submit a Demand
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {demandsQ.data?.length ?? 0} demands
          </p>
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={(d) => navigate('demand-detail', { id: d.id })}
            empty="No matching demands."
          />
        </>
      )}
    </div>
  );
}
