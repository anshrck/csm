'use client';

import { useState, useMemo } from 'react';
import type { Change } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  ChangeStatusBadge,
  RelativeTime,
  FormattedDate,
  KeyValue,
  DataTable,
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
  GitBranch,
  ClipboardList,
  CheckCircle2,
  ListChecks,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { useOwnerServices, useAllChanges } from './_hooks';

const TYPE_STYLES: Record<string, string> = {
  STANDARD: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  NORMAL: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  EMERGENCY: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

const COMPLEXITY_LABELS: Record<string, string> = {
  SIMPLE: 'Simple',
  MEDIUM: 'Medium',
  COMPLEX: 'Complex',
};

const ORIGIN_LABELS: Record<string, string> = {
  DEMAND: 'Demand-driven',
  PROBLEM: 'Problem-driven',
  STANDARD: 'Standard (pre-approved)',
};

export default function Changes() {
  const servicesQ = useOwnerServices();
  const changesQ = useAllChanges();
  const [selected, setSelected] = useState<Change | null>(null);

  const services = servicesQ.data ?? [];
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';

  const myChanges = useMemo(
    () =>
      (changesQ.data ?? [])
        .filter((c) => c.affectedServiceIds.some((sid) => services.some((s) => s.id === sid)))
        .slice()
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [changesQ.data, services],
  );

  const columns: Column<Change>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (c) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{c.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {ORIGIN_LABELS[c.originType] ?? c.originType}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant="outline" className={TYPE_STYLES[c.type] ?? 'bg-muted'}>
          {c.type}
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
          <span className="text-xs">{COMPLEXITY_LABELS[c.complexity] ?? c.complexity}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'ce',
      header: 'CE Worker',
      render: (c) => (
        <span className="text-xs">{c.assignedCeWorkerName ?? 'Unassigned'}</span>
      ),
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
    {
      key: 'created',
      header: 'Created',
      render: (c) => <RelativeTime date={c.createdAt} className="text-xs text-muted-foreground" />,
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
    },
  ];

  const loading = servicesQ.isLoading || changesQ.isLoading;
  const activeCount = myChanges.filter(
    (c) => !['CLOSED', 'REJECTED'].includes(c.status),
  ).length;
  const emergencyCount = myChanges.filter((c) => c.type === 'EMERGENCY').length;
  const postReviewDue = myChanges.filter((c) => c.isEmergencyPostReviewDue).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changes Affecting Your Services"
        description="You are consulted when DEMAND transitions to QUOTE. You are escalated to when OUTCOME fails. Review all changes affecting your service portfolio."
        icon={<GitBranch className="h-6 w-6" />}
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : myChanges.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<GitBranch className="h-10 w-10" />}
            title="No changes affecting your services"
            description="Changes whose affected services include any of your owned services will appear here."
          />
        </SectionCard>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile
              icon={<GitBranch className="h-4 w-4" />}
              label="Total Changes"
              value={myChanges.length}
            />
            <SummaryTile
              icon={<ClipboardList className="h-4 w-4" />}
              label="Active"
              value={activeCount}
              tone="warning"
            />
            <SummaryTile
              icon={<AlertCircle className="h-4 w-4" />}
              label="Emergency"
              value={emergencyCount}
              tone="danger"
            />
            <SummaryTile
              icon={<ShieldCheck className="h-4 w-4" />}
              label="PIR Due"
              value={postReviewDue}
              tone="danger"
            />
          </div>

          <SectionCard
            title="Changes on Your Services"
            description="Click a row to see the implementation plan, affected services, technical owner tasks, and verification notes."
          >
            <DataTable
              columns={columns}
              rows={myChanges}
              onRowClick={(c) => setSelected(c)}
              empty="No changes."
            />
          </SectionCard>
        </>
      )}

      {selected && (
        <ChangeDetailDialog
          change={selected}
          serviceName={serviceName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ChangeDetailDialog({
  change,
  serviceName,
  onClose,
}: {
  change: Change;
  serviceName: (id: string) => string;
  onClose: () => void;
}) {
  const tasks = Array.isArray(change.technicalOwnerTasksJson)
    ? (change.technicalOwnerTasksJson as Array<{
        owner?: string;
        chapter?: string;
        task?: string;
        status?: string;
      }>)
    : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <ChangeStatusBadge status={change.status} />
            <Badge variant="outline" className={TYPE_STYLES[change.type] ?? 'bg-muted'}>
              {change.type}
            </Badge>
            {change.complexity && (
              <Badge variant="outline">
                {COMPLEXITY_LABELS[change.complexity] ?? change.complexity}
              </Badge>
            )}
            {change.isEmergencyPostReviewDue && (
              <Badge
                variant="outline"
                className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300"
              >
                <AlertCircle className="h-3 w-3 mr-1" /> PIR Due
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl mt-2">{change.title}</DialogTitle>
          <DialogDescription>
            {ORIGIN_LABELS[change.originType] ?? change.originType} · opened{' '}
            <FormattedDate date={change.createdAt} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Affected services */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Affected Services
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {change.affectedServiceIds.map((sid) => (
                <Badge key={sid} variant="outline" className="bg-muted/50">
                  {serviceName(sid)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Implementation plan */}
          {change.implementationPlan && (
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" /> Implementation Plan
              </div>
              <pre className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans">
                {change.implementationPlan}
              </pre>
            </div>
          )}

          {/* Technical owner tasks */}
          {tasks.length > 0 && (
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" /> Technical Owner Tasks
              </div>
              <ul className="space-y-2">
                {tasks.map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span
                      className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                        t.status === 'DONE'
                          ? 'bg-emerald-500'
                          : t.status === 'IN_PROGRESS'
                            ? 'bg-amber-500'
                            : 'bg-muted-foreground/40'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{t.task ?? 'Task'}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t.owner ?? 'Owner'} {t.chapter ? `· ${t.chapter}` : ''} ·{' '}
                        <span className="font-medium">
                          {(t.status ?? 'PENDING').replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verification notes */}
          {change.verificationNotes && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Verification Notes
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">
                {change.verificationNotes}
              </p>
            </div>
          )}

          {/* Approval notes */}
          {change.approvalNotes && (
            <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
              <span className="font-semibold text-foreground">Approval notes:</span>{' '}
              {change.approvalNotes}
            </div>
          )}

          {/* Meta */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <KeyValue
              label="CE Worker"
              value={change.assignedCeWorkerName ?? 'Unassigned'}
            />
            <KeyValue
              label="Catalog Updated"
              value={
                change.catalogUpdatedAt ? (
                  <FormattedDate date={change.catalogUpdatedAt} />
                ) : (
                  'Not yet'
                )
              }
            />
            <KeyValue label="Created" value={<FormattedDate date={change.createdAt} />} />
            <KeyValue
              label="Closed"
              value={change.closedAt ? <FormattedDate date={change.closedAt} /> : '—'}
            />
          </dl>

          {change.postImplementationReview && (
            <div className="rounded-md border p-3 text-xs leading-relaxed">
              <div className="font-semibold text-foreground mb-1">
                Post-Implementation Review
              </div>
              {change.postImplementationReview}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneCls = {
    default: '',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
