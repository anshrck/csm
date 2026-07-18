'use client';

import { useState, useMemo } from 'react';
import type { Problem } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
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
  Bug,
  Stethoscope,
  AlertTriangle,
  Wrench,
  ShieldAlert,
  Lightbulb,
  Activity,
} from 'lucide-react';
import { useOwnerServices, useOwnerProblems } from './_hooks';

const PROBLEM_STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  UNDER_INVESTIGATION: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  ROOT_CAUSE_IDENTIFIED: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
  DECISION: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  KNOWN_ERROR: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  LINKED_TO_CHANGE: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
};

const DECISION_LABELS: Record<string, string> = {
  KNOWN_ERROR: 'Known Error — workaround documented',
  CHANGE_REQUIRED: 'Change Required — raise change request',
  FURTHER_ANALYSIS: 'Further Analysis — continue investigation',
};

export default function Problems() {
  const servicesQ = useOwnerServices();
  const problemsQ = useOwnerProblems();
  const [selected, setSelected] = useState<Problem | null>(null);

  const services = servicesQ.data ?? [];
  const problems = problemsQ.data ?? [];

  const rows = useMemo(
    () =>
      problems.map((p) => ({
        ...p,
        serviceName: p.serviceName ?? services.find((s) => s.id === p.serviceId)?.name ?? 'Service',
      })),
    [problems, services],
  );

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (p) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{p.title}</div>
          {p.rootCauseDescription && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {p.rootCauseDescription}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'service',
      header: 'Service',
      render: (p) => <span className="text-sm">{p.serviceName}</span>,
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <Badge
          variant="outline"
          className={PROBLEM_STATUS_STYLES[p.status] ?? 'bg-muted text-muted-foreground'}
        >
          {p.status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'decision',
      header: 'Decision',
      render: (p) =>
        p.decision ? (
          <span className="text-xs">{DECISION_LABELS[p.decision] ?? p.decision}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Pending</span>
        ),
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
    {
      key: 'created',
      header: 'Created',
      render: (p) => <RelativeTime date={p.createdAt} className="text-xs text-muted-foreground" />,
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
    },
  ];

  const loading = servicesQ.isLoading || problemsQ.isLoading;
  const knownErrorCount = problems.filter((p) => p.knownErrorId || p.status === 'KNOWN_ERROR').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Problem Records"
        description="When Problem Management investigates a recurring failure, that context feeds your SLA governance communication. Review active problems on your services."
        icon={<Bug className="h-6 w-6" />}
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : problems.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Bug className="h-10 w-10" />}
            title="No active problem records"
            description="Problems raised against your services will appear here with root-cause context and decision status."
          />
        </SectionCard>
      ) : (
        <>
          {/* Quick summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile
              icon={<Bug className="h-4 w-4" />}
              label="Active Problems"
              value={problems.length}
            />
            <SummaryTile
              icon={<Stethoscope className="h-4 w-4" />}
              label="Under Investigation"
              value={problems.filter((p) => p.status === 'UNDER_INVESTIGATION').length}
              tone="warning"
            />
            <SummaryTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Known Errors"
              value={knownErrorCount}
              tone="danger"
            />
            <SummaryTile
              icon={<Activity className="h-4 w-4" />}
              label="Linked to Change"
              value={problems.filter((p) => p.status === 'LINKED_TO_CHANGE').length}
              tone="success"
            />
          </div>

          <SectionCard
            title="Active Problems on Your Services"
            description="Click a row to see the full problem record — root cause, impact assessment, decision rationale, and workaround (if known error)."
          >
            <DataTable
              columns={columns}
              rows={rows}
              onRowClick={(p) => setSelected(p)}
              empty="No problems."
            />
          </SectionCard>
        </>
      )}

      {selected && (
        <ProblemDetailDialog
          problem={selected}
          serviceName={
            selected.serviceName ??
            services.find((s) => s.id === selected.serviceId)?.name ??
            'Service'
          }
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ProblemDetailDialog({
  problem,
  serviceName,
  onClose,
}: {
  problem: Problem;
  serviceName: string;
  onClose: () => void;
}) {
  const isKnownError = problem.knownErrorId || problem.status === 'KNOWN_ERROR';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={PROBLEM_STATUS_STYLES[problem.status] ?? 'bg-muted text-muted-foreground'}
            >
              {problem.status.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            {problem.decision && (
              <Badge variant="outline" className="bg-muted">
                {DECISION_LABELS[problem.decision] ?? problem.decision}
              </Badge>
            )}
            {isKnownError && (
              <Badge
                variant="outline"
                className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300"
              >
                <ShieldAlert className="h-3 w-3 mr-1" /> Known Error
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl mt-2">{problem.title}</DialogTitle>
          <DialogDescription>
            Problem on <span className="font-medium text-foreground">{serviceName}</span> · opened{' '}
            <FormattedDate date={problem.createdAt} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Root cause */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Stethoscope className="h-3.5 w-3.5" /> Root Cause
            </div>
            {problem.rootCauseDescription ? (
              <p className="text-sm leading-relaxed text-foreground/90">
                {problem.rootCauseDescription}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Root cause not yet identified — investigation in progress.
              </p>
            )}
          </div>

          {/* Impact assessment */}
          {problem.impactAssessment && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-4">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Impact Assessment
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">{problem.impactAssessment}</p>
            </div>
          )}

          {/* Decision rationale */}
          {problem.decisionRationale && (
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Lightbulb className="h-3.5 w-3.5" /> Decision Rationale
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">
                {problem.decisionRationale}
              </p>
            </div>
          )}

          {/* Workaround (if known error) */}
          {isKnownError && (
            <div className="rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50/40 dark:bg-orange-950/20 p-4">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300">
                <Wrench className="h-3.5 w-3.5" /> Documented Workaround
              </div>
              {problem.workaroundDescription ? (
                <p className="text-sm leading-relaxed text-foreground/90">
                  {problem.workaroundDescription}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No workaround documented yet. Capture one before publishing to customers.
                </p>
              )}
            </div>
          )}

          {/* Meta */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <KeyValue
              label="PM Worker"
              value={problem.assignedPmWorkerId ? 'Assigned' : 'Unassigned'}
            />
            <KeyValue label="Known Error ID" value={problem.knownErrorId ?? '—'} />
            <KeyValue label="Created" value={<FormattedDate date={problem.createdAt} />} />
            <KeyValue label="Last Updated" value={<FormattedDate date={problem.updatedAt} />} />
          </dl>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Linked incidents note:</span> Problem
            Management tracks recurring incidents against this record. When the root cause is
            confirmed and a permanent fix is required, a Change Request will be raised and surfaced
            in your Changes view.
          </div>
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
