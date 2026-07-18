'use client';

import { useQuery } from '@tanstack/react-query';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  ChangeStatusBadge,
  Badge,
  Button,
  KeyValue,
  RelativeTime,
  DataTable,
  type Column,
} from '@/components/shared';
import { useChanges } from './Dashboard';
import { GitBranch, Filter, Search, AlertOctagon, CheckCircle2, Clock, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Change, ChangeStatus, ChangeType, ChangeComplexity, ChangeOrigin } from '@/lib/types';
import { CHANGE_STATUS_LABELS } from '@/lib/types';

const STATUS_OPTIONS: ChangeStatus[] = [
  'REQUESTED',
  'ASSESSMENT',
  'PLANNING',
  'APPROVED',
  'IMPLEMENTATION',
  'VERIFICATION',
  'CLOSED',
  'REJECTED',
];
const TYPE_OPTIONS: ChangeType[] = ['STANDARD', 'NORMAL', 'EMERGENCY'];

const typeTone: Record<ChangeType, string> = {
  STANDARD: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  NORMAL: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  EMERGENCY: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

const complexityTone: Record<ChangeComplexity, string> = {
  SIMPLE: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  COMPLEX: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

const originLabels: Record<ChangeOrigin, string> = {
  DEMAND: 'From Demand',
  PROBLEM: 'From Problem',
  STANDARD: 'Standard',
};

export default function Changes() {
  const changesQ = useChanges();
  const changes = changesQ.data ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Change | null>(null);

  const filtered = useMemo(() => {
    return changes.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.title} ${c.assignedCeWorkerName ?? ''} ${c.originType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [changes, search, statusFilter, typeFilter]);

  const open = changes.filter((c) => c.status !== 'CLOSED' && c.status !== 'REJECTED').length;
  const emergencies = changes.filter((c) => c.type === 'EMERGENCY').length;
  const closed = changes.filter((c) => c.status === 'CLOSED').length;
  const inImplementation = changes.filter((c) => c.status === 'IMPLEMENTATION').length;

  const columns: Column<Change>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (c) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="font-medium text-sm truncate">{c.title}</div>
          <div className="text-xs text-muted-foreground truncate">{originLabels[c.originType]}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant="outline" className={`text-[10px] font-medium ${typeTone[c.type]}`}>
          {c.type === 'EMERGENCY' && <Zap className="h-3 w-3 mr-1" />}
          {c.type.charAt(0) + c.type.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ChangeStatusBadge status={c.status} />,
    },
    {
      key: 'complexity',
      header: 'Complexity',
      render: (c) =>
        c.complexity ? (
          <Badge variant="outline" className={`text-[10px] ${complexityTone[c.complexity]}`}>
            {c.complexity.charAt(0) + c.complexity.slice(1).toLowerCase()}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'ceWorker',
      header: 'CE Worker',
      render: (c) => <span className="text-sm">{c.assignedCeWorkerName ?? '—'}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (c) => <RelativeTime date={c.createdAt} className="text-xs text-muted-foreground" />,
    },
    {
      key: 'updatedAt',
      header: 'Last update',
      render: (c) => <RelativeTime date={c.updatedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changes"
        description="Tenant-wide change register. Inspect any change linked to a demand, problem, or standard catalogue item."
        icon={<GitBranch className="h-5 w-5" />}
        actions={
          <Badge variant="outline" className="tabular-nums">
            {filtered.length} of {changes.length}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open Changes" value={open} icon={<Clock className="h-4 w-4" />} tone={open > 0 ? 'warning' : 'success'} />
        <StatCard label="In Implementation" value={inImplementation} icon={<GitBranch className="h-4 w-4" />} />
        <StatCard label="Emergencies" value={emergencies} icon={<AlertOctagon className="h-4 w-4" />} tone={emergencies > 0 ? 'danger' : 'success'} />
        <StatCard label="Closed" value={closed} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
      </div>

      <SectionCard>
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search change title, CE worker, origin…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{CHANGE_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          {changesQ.isLoading ? (
            <LoadingState rows={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-8 w-8 text-muted-foreground/50" />}
              title="No changes match your filters"
            />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              onRowClick={(c) => setSelected(c)}
            />
          )}
        </div>
      </SectionCard>

      <ChangeDetailDialog change={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ChangeDetailDialog({ change, onClose }: { change: Change | null; onClose: () => void }) {
  return (
    <Dialog open={!!change} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin">
        {change && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {change.title}
                <ChangeStatusBadge status={change.status} />
              </DialogTitle>
              <DialogDescription>
                {originLabels[change.originType]} · {change.type.charAt(0) + change.type.slice(1).toLowerCase()} Change
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <KeyValue label="Type" value={<Badge variant="outline" className={typeTone[change.type]}>{change.type}</Badge>} />
                <KeyValue label="Complexity" value={change.complexity ? <Badge variant="outline" className={complexityTone[change.complexity]}>{change.complexity}</Badge> : '—'} />
                <KeyValue label="Origin" value={originLabels[change.originType]} />
                <KeyValue label="CE Worker" value={change.assignedCeWorkerName ?? '—'} />
                <KeyValue label="Created" value={<RelativeTime date={change.createdAt} />} />
                <KeyValue label="Last update" value={<RelativeTime date={change.updatedAt} />} />
                {change.closedAt && <KeyValue label="Closed" value={<RelativeTime date={change.closedAt} />} />}
              </div>

              {change.implementationPlan && (
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">Implementation Plan</h4>
                  <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/50 rounded-md p-3 leading-relaxed">
                    {change.implementationPlan}
                  </pre>
                </div>
              )}

              {change.approvalNotes && (
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">Approval Notes</h4>
                  <p className="text-sm text-muted-foreground">{change.approvalNotes}</p>
                </div>
              )}

              {change.verificationNotes && (
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">Verification Notes</h4>
                  <p className="text-sm text-muted-foreground">{change.verificationNotes}</p>
                </div>
              )}

              {change.rejectionReason && (
                <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 p-3">
                  <h4 className="text-sm font-semibold mb-1 text-rose-700 dark:text-rose-300">Rejection Reason</h4>
                  <p className="text-sm text-rose-700/80 dark:text-rose-300/80">{change.rejectionReason}</p>
                </div>
              )}

              {change.technicalOwnerTasksJson && change.technicalOwnerTasksJson.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">Technical Owner Tasks</h4>
                  <div className="space-y-1.5">
                    {change.technicalOwnerTasksJson.map((task: any, i: number) => (
                      <div key={i} className="flex items-start justify-between gap-2 rounded-md border p-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{task.task}</div>
                          <div className="text-xs text-muted-foreground">
                            {task.owner} · {task.chapter?.replace(/_/g, ' ')}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${
                            task.status === 'DONE'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : task.status === 'IN_PROGRESS'
                              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'border-muted'
                          }`}
                        >
                          {task.status?.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
