'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  PageHeader,
  DataTable,
  ChangeStatusBadge,
  EmptyState,
  LoadingState,
  SectionCard,
  KeyValue,
  RelativeTime,
  FormattedDate,
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitBranch, Filter, ListChecks, FileText } from 'lucide-react';
import type { Change, Demand, Service, ChangeStatus, ChangeComplexity, ChangeType } from '@/lib/types';
import { CHANGE_STATUS_LABELS } from '@/lib/types';

const COMPLEXITY_LABELS: Record<ChangeComplexity, string> = {
  SIMPLE: 'Simple',
  MEDIUM: 'Medium',
  COMPLEX: 'Complex',
};
const TYPE_LABELS: Record<ChangeType, string> = {
  STANDARD: 'Standard',
  NORMAL: 'Normal',
  EMERGENCY: 'Emergency',
};
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
const TASK_STATUS_STYLE: Record<string, string> = {
  DONE: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  PENDING: 'bg-muted text-muted-foreground border-border',
  BLOCKED: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

export default function Changes() {
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [selected, setSelected] = React.useState<Change | null>(null);

  const { data: changes, isLoading } = useQuery<Change[]>({
    queryKey: ['changes', 'all'],
    queryFn: () => apiGet('/api/changes'),
  });

  const { data: myDemands } = useQuery<Demand[]>({
    queryKey: ['demands', 'assigned', 'me'],
    queryFn: () => apiGet('/api/demands?assigned=me'),
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  const serviceMap = React.useMemo(() => {
    const m = new Map<string, Service>();
    (services ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);

  // Demand lookup for origin title
  const demandMap = React.useMemo(() => {
    const m = new Map<string, Demand>();
    (myDemands ?? []).forEach((d) => m.set(d.id, d));
    return m;
  }, [myDemands]);

  const allChanges = changes ?? [];

  // Filter to changes linked to demands I coordinate (by originDemandId in my demands),
  // or — if none — show all so the SCM worker has full visibility.
  const coordinated = React.useMemo(() => {
    if ((myDemands ?? []).length === 0) return allChanges;
    const myDemandIds = new Set((myDemands ?? []).map((d) => d.id));
    const filtered = allChanges.filter((c) => c.originDemandId && myDemandIds.has(c.originDemandId));
    return filtered.length > 0 ? filtered : allChanges;
  }, [allChanges, myDemands]);

  const filtered = React.useMemo(() => {
    if (statusFilter === 'ALL') return coordinated;
    return coordinated.filter((c) => c.status === statusFilter);
  }, [coordinated, statusFilter]);

  const columns: Column<Change>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (c) => (
        <div className="min-w-0">
          <p className="font-medium truncate max-w-[32ch]">{c.title}</p>
          <p className="text-xs text-muted-foreground">
            {TYPE_LABELS[c.type]} · {c.complexity ? COMPLEXITY_LABELS[c.complexity] : '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant="outline" className="text-xs">
          {TYPE_LABELS[c.type]}
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
      render: (c) => (c.complexity ? <span className="text-sm">{COMPLEXITY_LABELS[c.complexity]}</span> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'origin',
      header: 'Origin Demand',
      render: (c) =>
        c.originDemandId && demandMap.get(c.originDemandId) ? (
          <span className="text-sm truncate block max-w-[28ch]">{demandMap.get(c.originDemandId)!.title}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{c.originType === 'DEMAND' ? 'External demand' : c.originType === 'PROBLEM' ? 'Problem record' : 'Standard change'}</span>
        ),
    },
    {
      key: 'updated',
      header: 'Last update',
      render: (c) => <RelativeTime date={c.updatedAt} className="text-sm text-muted-foreground" />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Changes"
        description="Change requests linked to demands you coordinate. Read-mostly — changes are owned by Change Enablement."
        icon={<GitBranch className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Status:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CHANGE_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {coordinated.length} changes
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState rows={5} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<GitBranch className="h-8 w-8" />}
              title="No changes found"
              description="Changes you create via hand-to-CE will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(c) => setSelected(c)}
        />
      )}

      <ChangeDetailDialog
        change={selected}
        originDemandTitle={selected?.originDemandId ? demandMap.get(selected.originDemandId)?.title : undefined}
        serviceMap={serviceMap}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ChangeDetailDialog({
  change,
  originDemandTitle,
  serviceMap,
  onClose,
}: {
  change: Change | null;
  originDemandTitle?: string;
  serviceMap: Map<string, Service>;
  onClose: () => void;
}) {
  const open = !!change;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin">
        {change && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <ChangeStatusBadge status={change.status} />
                <Badge variant="outline" className="text-xs">{TYPE_LABELS[change.type]}</Badge>
                {change.complexity && (
                  <Badge variant="outline" className="text-xs">{COMPLEXITY_LABELS[change.complexity]}</Badge>
                )}
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Origin: {change.originType === 'DEMAND' ? 'Demand' : change.originType === 'PROBLEM' ? 'Problem' : 'Standard'}
                </Badge>
              </div>
              <DialogTitle className="text-xl mt-2">{change.title}</DialogTitle>
              {originDemandTitle && (
                <DialogDescription>
                  Linked demand: <span className="font-medium text-foreground">{originDemandTitle}</span>
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <KeyValue label="Created" value={<FormattedDate date={change.createdAt} />} />
                <KeyValue label="Last update" value={<RelativeTime date={change.updatedAt} />} />
                {change.closedAt && <KeyValue label="Closed" value={<FormattedDate date={change.closedAt} />} />}
              </div>

              {/* Implementation plan */}
              <SectionCard title="Implementation Plan">
                {change.implementationPlan ? (
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed bg-muted/30 rounded-md p-3 border">
                    {change.implementationPlan}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No implementation plan recorded.</p>
                )}
              </SectionCard>

              {/* Technical owner tasks */}
              <SectionCard
                title="Technical Owner Tasks"
                description="Tasks allocated to technical owners across affected chapters."
                actions={
                  Array.isArray(change.technicalOwnerTasksJson) && change.technicalOwnerTasksJson.length > 0 ? (
                    <Badge variant="outline" className="text-xs">
                      {change.technicalOwnerTasksJson.filter((t: any) => t.status === 'DONE').length}/{change.technicalOwnerTasksJson.length} done
                    </Badge>
                  ) : undefined
                }
              >
                {Array.isArray(change.technicalOwnerTasksJson) && change.technicalOwnerTasksJson.length > 0 ? (
                  <div className="space-y-2">
                    {change.technicalOwnerTasksJson.map((task: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                        <ListChecks className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{task.task}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span>Owner: <span className="text-foreground">{task.owner}</span></span>
                            <span>·</span>
                            <span>Chapter: <span className="text-foreground">{(task.chapter ?? '').replace(/_/g, ' ').toLowerCase()}</span></span>
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${TASK_STATUS_STYLE[task.status] ?? ''}`}>
                          {(task.status ?? '').replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No tasks recorded.</p>
                )}
              </SectionCard>

              {/* Affected services */}
              {change.affectedServiceIds && change.affectedServiceIds.length > 0 && (
                <SectionCard title="Affected Services">
                  <div className="flex flex-wrap gap-2">
                    {change.affectedServiceIds.map((sid) => {
                      const svc = serviceMap.get(sid);
                      return (
                        <Badge key={sid} variant="outline" className="text-xs">
                          {svc?.name ?? sid}
                        </Badge>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Approval / verification notes */}
              {(change.approvalNotes || change.verificationNotes || change.rejectionReason) && (
                <SectionCard title="Governance Notes">
                  <div className="space-y-3 text-sm">
                    {change.approvalNotes && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Approval</div>
                        <p className="leading-relaxed">{change.approvalNotes}</p>
                      </div>
                    )}
                    {change.verificationNotes && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Verification</div>
                        <p className="leading-relaxed">{change.verificationNotes}</p>
                      </div>
                    )}
                    {change.rejectionReason && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-rose-600 mb-0.5">Rejection</div>
                        <p className="leading-relaxed text-rose-700 dark:text-rose-300">{change.rejectionReason}</p>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
