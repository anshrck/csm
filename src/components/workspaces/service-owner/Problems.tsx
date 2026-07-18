'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { toast } from 'sonner';
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
  Button,
  type Column,
} from '@/components/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Bug,
  Stethoscope,
  AlertTriangle,
  Wrench,
  ShieldAlert,
  Lightbulb,
  Activity,
  CheckCircle2,
  Gavel,
  ArrowRight,
  Clock,
  Link2,
  PlusCircle,
  TriangleAlert,
  Megaphone,
} from 'lucide-react';
import { useOwnerServices, useOwnerProblems } from './_hooks';
import { OwnerDecisionDialog, type DecisionOption } from './_components/OwnerDecisionDialog';
import EntityLinks from '@/components/workspaces/shared/EntityLinks';

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

/* --------------------- Owner actions dialog --------------------- */

interface ActionDialogState {
  type: 'APPROVE_KE' | 'APPROVE_WORKAROUND' | 'CREATE_RISK' | 'CHANGE_REQUIRED' | 'REQUEST_ROOT_CAUSE' | null;
  problem: Problem | null;
}

/* --------------------- Main --------------------- */

export default function Problems() {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const servicesQ = useOwnerServices();
  const problemsQ = useOwnerProblems();
  const [selected, setSelected] = useState<Problem | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ type: null, problem: null });
  const [riskDialog, setRiskDialog] = useState<Problem | null>(null);

  const services = servicesQ.data ?? [];
  const problems = problemsQ.data ?? [];

  // Risk-severity option for "Create risk" dialog
  const [riskSeverity, setRiskSeverity] = useState<string>('HIGH');
  const [riskTitle, setRiskTitle] = useState('');
  const [riskMitigation, setRiskMitigation] = useState('');

  const serviceName = (id: string) =>
    services.find((s) => s.id === id)?.name ?? 'Service';

  /* --- Mutations --- */
  const approveKnownError = useMutation({
    mutationFn: (args: { problemId: string; status: string; decision?: string; rationale: string }) =>
      apiPatch(`/api/problems/${args.problemId}`, {
        status: args.status,
        decision: args.decision,
        decisionRationale: args.rationale,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Known error classification approved', {
        description: `Problem ${vars.problemId.slice(-6)} moved to ${vars.status}.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-problems'] });
      setActionDialog({ type: null, problem: null });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRisk = useMutation({
    mutationFn: (args: { serviceId: string; title: string; severity: string; mitigation?: string; sourceId?: string }) =>
      apiPost('/api/service-owner/risk-register', {
        serviceId: args.serviceId,
        title: args.title,
        severity: args.severity,
        mitigation: args.mitigation,
        sourceType: 'PROBLEM',
        sourceId: args.sourceId,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Risk created', {
        description: `Risk "${vars.title}" added to the service risk register.`,
      });
      qc.invalidateQueries({ queryKey: ['service-owner', 'risk-register'] });
      setRiskDialog(null);
      setRiskTitle('');
      setRiskMitigation('');
      setRiskSeverity('HIGH');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --- Filtering tabs --- */
  const TAB_FILTERS: Record<string, (p: Problem) => boolean> = {
    active: (p) => p.status !== 'CLOSED',
    rootCausePending: (p) => p.status === 'UNDER_INVESTIGATION' || p.status === 'ROOT_CAUSE_IDENTIFIED',
    decisionNeeded: (p) => p.status === 'DECISION',
    knownErrors: (p) => p.knownErrorId != null || p.status === 'KNOWN_ERROR',
    linkedToChange: (p) => p.status === 'LINKED_TO_CHANGE',
    closed: (p) => p.status === 'CLOSED',
  };

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
        description="As Service Owner you sit on the governance side of Problem Management — approve known-error classifications, authorise workaround publication, direct changes, link knowledge articles, and create risks from recurring problems on your services."
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
            <SummaryTile icon={<Bug className="h-4 w-4" />} label="Active Problems" value={problems.filter(TAB_FILTERS.active).length} />
            <SummaryTile icon={<Stethoscope className="h-4 w-4" />} label="Root Cause Pending" value={problems.filter(TAB_FILTERS.rootCausePending).length} tone="warning" />
            <SummaryTile icon={<ShieldAlert className="h-4 w-4" />} label="Known Errors" value={knownErrorCount} tone="danger" />
            <SummaryTile icon={<Activity className="h-4 w-4" />} label="Linked to Change" value={problems.filter(TAB_FILTERS.linkedToChange).length} tone="success" />
          </div>

          <Tabs defaultValue="active" className="w-full">
            <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
              <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
              <TabsTrigger value="rootCausePending" className="text-xs">Root Cause</TabsTrigger>
              <TabsTrigger value="decisionNeeded" className="text-xs">Decision</TabsTrigger>
              <TabsTrigger value="knownErrors" className="text-xs">Known Errors</TabsTrigger>
              <TabsTrigger value="linkedToChange" className="text-xs">Linked</TabsTrigger>
              <TabsTrigger value="closed" className="text-xs">Closed</TabsTrigger>
            </TabsList>

            {(['active', 'rootCausePending', 'decisionNeeded', 'knownErrors', 'linkedToChange', 'closed'] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="space-y-4 mt-4">
                <SectionCard
                  title={TAB_TITLES[tab]}
                  description={TAB_DESCRIPTIONS[tab]}
                >
                  <DataTable
                    columns={columns}
                    rows={rows.filter(TAB_FILTERS[tab])}
                    onRowClick={(p) => setSelected(p)}
                    empty="No problems in this category."
                  />
                </SectionCard>
              </TabsContent>
            ))}
          </Tabs>
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
          onAction={(type) => {
            setActionDialog({ type, problem: selected });
            if (type === 'CREATE_RISK') {
              setRiskDialog(selected);
              setRiskTitle(`Risk from problem: ${selected.title}`);
            }
            if (type === 'CHANGE_REQUIRED') {
              navigate('changes');
            }
            if (type === 'REQUEST_ROOT_CAUSE') {
              toast.success('Root cause update requested', {
                description: `PM Worker has been notified to refresh root cause for "${selected.title}".`,
              });
            }
          }}
        />
      )}

      {/* Approve Known Error Classification */}
      {actionDialog.type === 'APPROVE_KE' && actionDialog.problem && (
        <ApproveKnownErrorDialog
          open
          problem={actionDialog.problem}
          serviceName={actionDialog.problem.serviceName ?? serviceName(actionDialog.problem.serviceId)}
          pending={approveKnownError.isPending}
          onConfirm={(rationale) =>
            approveKnownError.mutate({
              problemId: actionDialog.problem!.id,
              status: 'KNOWN_ERROR',
              decision: 'KNOWN_ERROR',
              rationale,
            })
          }
          onClose={() => setActionDialog({ type: null, problem: null })}
        />
      )}

      {/* Approve Workaround Publication (KNOWLEDGE_APPROVAL governance decision) */}
      {actionDialog.type === 'APPROVE_WORKAROUND' && actionDialog.problem && (
        <OwnerDecisionDialog
          open
          onOpenChange={(v) => !v && setActionDialog({ type: null, problem: null })}
          serviceId={actionDialog.problem.serviceId}
          problemId={actionDialog.problem.id}
          decisionType="KNOWLEDGE_APPROVAL"
          decisionOptions={[
            { value: 'APPROVED', label: 'Approve — publish workaround to customers' },
            { value: 'REJECTED', label: 'Reject — workaround needs revision' },
          ]}
          dialogTitle="Approve Workaround Publication"
          dialogDescription={
            <span>
              Approve the documented workaround for{' '}
              <span className="font-medium">{actionDialog.problem.title}</span> to be published to
              customers via the SCM communication thread.
            </span>
          }
          onSubmitted={() => setActionDialog({ type: null, problem: null })}
        />
      )}

      {/* Create Risk dialog */}
      {riskDialog && (
        <Dialog open onOpenChange={(o) => !o && setRiskDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-rose-600" /> Create Risk from Problem
              </DialogTitle>
              <DialogDescription>
                Add a persisted risk to the service risk register for{' '}
                <span className="font-medium">{riskDialog.title}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="risk-title">Risk title</Label>
                <input
                  id="risk-title"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={riskTitle}
                  onChange={(e) => setRiskTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="risk-severity">Severity</Label>
                <select
                  id="risk-severity"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={riskSeverity}
                  onChange={(e) => setRiskSeverity(e.target.value)}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="risk-mitigation">Mitigation plan</Label>
                <Textarea
                  id="risk-mitigation"
                  rows={3}
                  value={riskMitigation}
                  onChange={(e) => setRiskMitigation(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRiskDialog(null)} disabled={createRisk.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createRisk.mutate({
                    serviceId: riskDialog.serviceId,
                    title: riskTitle.trim() || `Risk from ${riskDialog.title}`,
                    severity: riskSeverity,
                    mitigation: riskMitigation.trim() || undefined,
                    sourceId: riskDialog.id,
                  })
                }
                disabled={createRisk.isPending}
              >
                {createRisk.isPending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <PlusCircle className="h-4 w-4 mr-1.5" />}
                Create Risk
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* --------------------- Tab metadata --------------------- */

const TAB_TITLES: Record<string, string> = {
  active: 'Active Problems',
  rootCausePending: 'Root Cause Pending',
  decisionNeeded: 'Decision Needed',
  knownErrors: 'Known Errors',
  linkedToChange: 'Linked to Change',
  closed: 'Closed Problems',
};

const TAB_DESCRIPTIONS: Record<string, string> = {
  active: 'All non-closed problems on your services.',
  rootCausePending: 'Problems under investigation or with root cause identified but not yet decided.',
  decisionNeeded: 'Problems in DECISION status awaiting your governance direction.',
  knownErrors: 'Problems with documented workarounds — published to customers via SCM.',
  linkedToChange: 'Problems awaiting a change request to be raised.',
  closed: 'Resolved / closed problems.',
};

/* --------------------- Problem detail dialog --------------------- */

function ProblemDetailDialog({
  problem,
  serviceName,
  onClose,
  onAction,
}: {
  problem: Problem;
  serviceName: string;
  onClose: () => void;
  onAction: (type: 'APPROVE_KE' | 'APPROVE_WORKAROUND' | 'CREATE_RISK' | 'CHANGE_REQUIRED' | 'REQUEST_ROOT_CAUSE') => void;
}) {
  const isKnownError = problem.knownErrorId || problem.status === 'KNOWN_ERROR';
  const isDecisionNeeded = problem.status === 'DECISION';
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
            {isDecisionNeeded && (
              <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300">
                Decision required
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
            <div className="mt-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onAction('REQUEST_ROOT_CAUSE')}>
                <Megaphone className="h-3 w-3" /> Request root cause update
              </Button>
            </div>
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
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onAction('APPROVE_WORKAROUND')}>
                  <CheckCircle2 className="h-3 w-3" /> Approve workaround publication
                </Button>
              </div>
            </div>
          )}

          {/* Meta */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <KeyValue label="PM Worker" value={problem.assignedPmWorkerId ? 'Assigned' : 'Unassigned'} />
            <KeyValue label="Known Error ID" value={problem.knownErrorId ?? '—'} />
            <KeyValue label="Created" value={<FormattedDate date={problem.createdAt} />} />
            <KeyValue label="Last Updated" value={<FormattedDate date={problem.updatedAt} />} />
          </dl>

          {/* Entity links — show related tickets, changes, knowledge articles */}
          <div className="pt-2 border-t">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Linked Entities
            </h4>
            <EntityLinks entityType="PROBLEM" entityId={problem.id} readOnly />
          </div>

          {/* Owner actions */}
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Service Owner Governance Actions
            </div>
            <div className="flex flex-wrap gap-2">
              {isDecisionNeeded && (
                <Button size="sm" className="h-7 gap-1.5" onClick={() => onAction('APPROVE_KE')}>
                  <CheckCircle2 className="h-3 w-3" /> Approve known error classification
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onAction('CHANGE_REQUIRED')}>
                <Gavel className="h-3 w-3" /> Direct change required
                <ArrowRight className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onAction('CREATE_RISK')}>
                <TriangleAlert className="h-3 w-3" /> Create risk
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Approve Known Error dialog --------------------- */

function ApproveKnownErrorDialog({
  open,
  problem,
  serviceName,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  problem: Problem;
  serviceName: string;
  pending: boolean;
  onConfirm: (rationale: string) => void;
  onClose: () => void;
}) {
  const [rationale, setRationale] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Approve Known Error Classification
          </DialogTitle>
          <DialogDescription>
            Approve classifying <span className="font-medium">{problem.title}</span> on{' '}
            <span className="font-medium">{serviceName}</span> as a known error. The problem moves to
            KNOWN_ERROR status with your rationale recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ke-rationale">Rationale (required)</Label>
          <Textarea
            id="ke-rationale"
            rows={4}
            placeholder="Explain why this is a known error — recurring failure pattern, root cause confirmed, workaround in place…"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(rationale.trim())} disabled={pending || !rationale.trim()}>
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Approving…' : 'Approve Classification'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Summary tile --------------------- */

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
