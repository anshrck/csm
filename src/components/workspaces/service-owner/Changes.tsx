'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
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
  GitBranch,
  ClipboardList,
  CheckCircle2,
  ListChecks,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Gavel,
  RotateCcw,
  Megaphone,
  TriangleAlert,
  Clock,
  ArrowRight,
  Stethoscope,
} from 'lucide-react';
import { useOwnerServices, useAllChanges } from './_hooks';
import { OwnerDecisionDialog, type DecisionOption } from './_components/OwnerDecisionDialog';

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

/* --------------------- Risk Review Dialog --------------------- */

function RiskReviewDialog({
  open,
  onOpenChange,
  change,
  serviceName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  change: Change | null;
  serviceName: string;
}) {
  if (!change) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" /> Owner Risk Review
          </DialogTitle>
          <DialogDescription>
            Review the risk profile of <span className="font-medium">{change.title}</span> on{' '}
            <span className="font-medium">{serviceName}</span>. The risk review is informational — record a
            governance decision below to authorise resources or direct remediation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border p-3 bg-muted/40">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risk summary</div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={TYPE_STYLES[change.type] ?? 'bg-muted'}>
                {change.type}
              </Badge>
              {change.complexity && (
                <Badge variant="outline">{COMPLEXITY_LABELS[change.complexity] ?? change.complexity}</Badge>
              )}
              {change.isEmergencyPostReviewDue && (
                <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                  PIR due
                </Badge>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <KeyValue label="Origin" value={ORIGIN_LABELS[change.originType] ?? change.originType} />
            <KeyValue label="Status" value={change.status.replace(/_/g, ' ').toLowerCase()} />
          </dl>
          <p className="text-xs text-muted-foreground">
            For high-risk changes, use the governance actions in the change detail dialog to authorise
            resources, request rollback readiness, or record a post-implementation review.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Main --------------------- */

export default function Changes() {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const servicesQ = useOwnerServices();
  const changesQ = useAllChanges();
  const [selected, setSelected] = useState<Change | null>(null);
  const [riskReviewTarget, setRiskReviewTarget] = useState<Change | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<Change | null>(null);
  const [pirTarget, setPirTarget] = useState<Change | null>(null);

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';

  const myChanges = useMemo(
    () =>
      (changesQ.data ?? [])
        .filter((c) => c.affectedServiceIds.some((sid) => myServiceIds.has(sid)))
        .slice()
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [changesQ.data, myServiceIds],
  );

  /* --- Tabs / category filters --- */
  const CATEGORIES: Record<string, { title: string; description: string; filter: (c: Change) => boolean }> = {
    emergency: {
      title: 'Emergency Changes',
      description: 'Emergency changes in flight on your services — require post-implementation review.',
      filter: (c) => c.type === 'EMERGENCY' && c.status !== 'CLOSED' && c.status !== 'REJECTED',
    },
    complex: {
      title: 'Complex Changes',
      description: 'Complex changes requiring Change Board review.',
      filter: (c) => c.complexity === 'COMPLEX' && c.status !== 'CLOSED' && c.status !== 'REJECTED',
    },
    pendingApproval: {
      title: 'Pending Approval',
      description: 'Changes in ASSESSMENT or PLANNING awaiting approval.',
      filter: (c) => ['ASSESSMENT', 'PLANNING', 'REQUESTED'].includes(c.status),
    },
    inImplementation: {
      title: 'In Implementation',
      description: 'Changes currently in IMPLEMENTATION status.',
      filter: (c) => c.status === 'IMPLEMENTATION',
    },
    verification: {
      title: 'Verification / Cutover',
      description: 'Changes in VERIFICATION status — cutover phase, awaiting closure.',
      filter: (c) => c.status === 'VERIFICATION',
    },
    pirDue: {
      title: 'PIR Due',
      description: 'Changes with post-implementation review overdue.',
      filter: (c) => c.isEmergencyPostReviewDue,
    },
    catalogUpdate: {
      title: 'Catalog Update Required',
      description: 'Closed changes whose catalogUpdatedAt is null — catalog entry not yet updated.',
      filter: (c) => c.status === 'CLOSED' && !c.catalogUpdatedAt,
    },
    all: {
      title: 'All Changes',
      description: 'Every change affecting your services.',
      filter: () => true,
    },
  };

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
      key: 'services',
      header: 'Services',
      render: (c) => (
        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
          {c.affectedServiceIds.filter((sid) => myServiceIds.has(sid)).map((sid) => serviceName(sid)).join(', ')}
        </div>
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
  const activeCount = myChanges.filter((c) => !['CLOSED', 'REJECTED'].includes(c.status)).length;
  const emergencyCount = myChanges.filter((c) => c.type === 'EMERGENCY').length;
  const postReviewDue = myChanges.filter((c) => c.isEmergencyPostReviewDue).length;
  const complexCount = myChanges.filter((c) => c.complexity === 'COMPLEX').length;

  /* --- Mutations --- */
  const pirMutation = useMutation({
    mutationFn: (args: { serviceId: string; changeId: string; rationale: string }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.serviceId,
        decisionType: 'POST_IMPLEMENTATION_REVIEW',
        decision: 'APPROVED',
        rationale: args.rationale,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Post-implementation review recorded', {
        description: `PIR for change ${vars.changeId.slice(-6)} recorded in the audit trail.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      setPirTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Changes Affecting Your Services"
        description="You are consulted when DEMAND transitions to QUOTE and escalated to when OUTCOME fails. Review risk, authorise resources, request rollback readiness, and record post-implementation reviews for changes touching your portfolio."
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
            <SummaryTile icon={<GitBranch className="h-4 w-4" />} label="Total Changes" value={myChanges.length} />
            <SummaryTile icon={<ClipboardList className="h-4 w-4" />} label="Active" value={activeCount} tone="warning" />
            <SummaryTile icon={<AlertCircle className="h-4 w-4" />} label="Emergency" value={emergencyCount} tone="danger" />
            <SummaryTile icon={<ShieldCheck className="h-4 w-4" />} label="PIR Due" value={postReviewDue} tone="danger" />
          </div>

          <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-8 h-auto">
              <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
              <TabsTrigger value="emergency" className="text-xs">Emergency</TabsTrigger>
              <TabsTrigger value="complex" className="text-xs">Complex</TabsTrigger>
              <TabsTrigger value="pendingApproval" className="text-xs">Pending</TabsTrigger>
              <TabsTrigger value="inImplementation" className="text-xs">In Impl</TabsTrigger>
              <TabsTrigger value="verification" className="text-xs">Verify</TabsTrigger>
              <TabsTrigger value="pirDue" className="text-xs">PIR Due</TabsTrigger>
              <TabsTrigger value="catalogUpdate" className="text-xs">Catalog</TabsTrigger>
            </TabsList>

            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <TabsContent key={key} value={key} className="space-y-4 mt-4">
                <SectionCard title={cat.title} description={cat.description}>
                  <DataTable
                    columns={columns}
                    rows={myChanges.filter(cat.filter)}
                    onRowClick={(c) => setSelected(c)}
                    empty="No changes in this category."
                  />
                </SectionCard>
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}

      {selected && (
        <ChangeDetailDialog
          change={selected}
          serviceName={serviceName}
          onClose={() => setSelected(null)}
          onRiskReview={() => {
            setRiskReviewTarget(selected);
            setSelected(null);
          }}
          onAuthorize={() => {
            setAuthorizeTarget(selected);
            setSelected(null);
          }}
          onPir={() => {
            setPirTarget(selected);
            setSelected(null);
          }}
          onRollback={() => {
            toast.success('Rollback readiness requested', {
              description: `CE Worker notified to confirm rollback readiness for "${selected.title}".`,
            });
          }}
          onVerifyImpact={() => {
            toast.success('Customer impact plan verified', {
              description: `Customer communication plan for "${selected.title}" confirmed.`,
            });
          }}
          onLinkRisk={() => {
            navigate('risk-register');
          }}
        />
      )}

      {riskReviewTarget && (
        <RiskReviewDialog
          open={!!riskReviewTarget}
          onOpenChange={(v) => !v && setRiskReviewTarget(null)}
          change={riskReviewTarget}
          serviceName={serviceName(riskReviewTarget.affectedServiceIds.find((sid) => myServiceIds.has(sid)) ?? '')}
        />
      )}

      {authorizeTarget && (
        <OwnerDecisionDialog
          key={`authorize:${authorizeTarget.id}`}
          open={!!authorizeTarget}
          onOpenChange={(v) => !v && setAuthorizeTarget(null)}
          serviceId={authorizeTarget.affectedServiceIds.find((sid) => myServiceIds.has(sid)) ?? ''}
          decisionType="REMEDIATION_AUTHORIZATION"
          decisionOptions={[
            { value: 'RESOURCES_AUTHORIZED', label: 'Resources Authorized' },
            { value: 'REMEDIATION_AUTHORIZED', label: 'Remediation Authorized' },
            { value: 'EMERGENCY_CHANGE_DIRECTED', label: 'Emergency Change Directed' },
          ]}
          dialogTitle="Authorize Resources"
          dialogDescription={
            <span>
              Authorise resources for <span className="font-medium">{authorizeTarget.title}</span>. The
              authorisation is recorded in the governance audit trail.
            </span>
          }
          onSubmitted={() => setAuthorizeTarget(null)}
        />
      )}

      {pirTarget && (
        <PirDialog
          open={!!pirTarget}
          change={pirTarget}
          serviceName={serviceName(pirTarget.affectedServiceIds.find((sid) => myServiceIds.has(sid)) ?? '')}
          pending={pirMutation.isPending}
          onConfirm={(rationale) => {
            const sid = pirTarget.affectedServiceIds.find((s) => myServiceIds.has(s));
            if (!sid) {
              toast.error('Could not determine the owned service for this change.');
              return;
            }
            pirMutation.mutate({ serviceId: sid, changeId: pirTarget.id, rationale });
          }}
          onClose={() => setPirTarget(null)}
        />
      )}
    </div>
  );
}

/* --------------------- Post-Implementation Review dialog --------------------- */

function PirDialog({
  open,
  change,
  serviceName,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  change: Change | null;
  serviceName: string;
  pending: boolean;
  onConfirm: (rationale: string) => void;
  onClose: () => void;
}) {
  const [rationale, setRationale] = useState('');
  if (!change) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-orange-600" /> Post-Implementation Review
          </DialogTitle>
          <DialogDescription>
            Record your owner PIR for <span className="font-medium">{change.title}</span> on{' '}
            <span className="font-medium">{serviceName}</span>. The review is persisted as a
            POST_IMPLEMENTATION_REVIEW governance decision.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pir-rationale">Review summary (required)</Label>
          <Textarea
            id="pir-rationale"
            rows={5}
            placeholder="Summarise the change outcome — what went well, what didn't, customer impact observed, lessons learned, follow-up actions…"
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
            {pending ? 'Recording…' : 'Record PIR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Change Detail Dialog --------------------- */

function ChangeDetailDialog({
  change,
  serviceName,
  onClose,
  onRiskReview,
  onAuthorize,
  onPir,
  onRollback,
  onVerifyImpact,
  onLinkRisk,
}: {
  change: Change;
  serviceName: (id: string) => string;
  onClose: () => void;
  onRiskReview: () => void;
  onAuthorize: () => void;
  onPir: () => void;
  onRollback: () => void;
  onVerifyImpact: () => void;
  onLinkRisk: () => void;
}) {
  const tasks = Array.isArray(change.technicalOwnerTasksJson)
    ? (change.technicalOwnerTasksJson as Array<{
        owner?: string;
        chapter?: string;
        task?: string;
        status?: string;
      }>)
    : [];

  const isEmergency = change.type === 'EMERGENCY';
  const isComplex = change.complexity === 'COMPLEX';

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
              <Badge variant="outline">{COMPLEXITY_LABELS[change.complexity] ?? change.complexity}</Badge>
            )}
            {change.isEmergencyPostReviewDue && (
              <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
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
            <KeyValue label="CE Worker" value={change.assignedCeWorkerName ?? 'Unassigned'} />
            <KeyValue
              label="Catalog Updated"
              value={
                change.catalogUpdatedAt ? <FormattedDate date={change.catalogUpdatedAt} /> : 'Not yet'
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
              <div className="font-semibold text-foreground mb-1">Post-Implementation Review</div>
              {change.postImplementationReview}
            </div>
          )}

          {/* Owner actions */}
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Service Owner Actions
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onRiskReview}>
                <AlertTriangle className="h-3 w-3" /> Review risk
              </Button>
              <Button size="sm" variant="default" className="h-7 gap-1.5" onClick={onAuthorize}>
                <Gavel className="h-3 w-3" /> Authorize resources
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onRollback}>
                <RotateCcw className="h-3 w-3" /> Request rollback readiness
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onVerifyImpact}>
                <Megaphone className="h-3 w-3" /> Verify customer impact plan
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onLinkRisk}>
                <TriangleAlert className="h-3 w-3" /> Link risk
                <ArrowRight className="h-3 w-3" />
              </Button>
              {(change.isEmergencyPostReviewDue || isEmergency || change.status === 'CLOSED') && (
                <Button size="sm" variant="default" className="h-7 gap-1.5" onClick={onPir}>
                  <CheckCircle2 className="h-3 w-3" /> Record PIR
                </Button>
              )}
            </div>
          </div>
        </div>
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
