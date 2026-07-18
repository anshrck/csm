'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import type { Demand } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  ChangeStatusBadge,
  DemandStatusBadge,
  RelativeTime,
  FormattedDate,
  Button,
  Badge,
} from '@/components/shared';
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
import { Input } from '@/components/ui/input';
import {
  ShieldCheck,
  Gavel,
  CheckCircle2,
  ArrowUpCircle,
  FileText,
  GitBranch,
  Users,
  ArrowRight,
  Clock,
  History,
} from 'lucide-react';
import { useOwnerServices, useAcceptedDemands, useAllChanges } from './_hooks';

/* --------------------- Governance decision type --------------------- */

interface GovernanceDecision {
  id: string;
  serviceId: string;
  demandId: string | null;
  slaEventId: string | null;
  problemId: string | null;
  decisionType: string;
  decision: string;
  rationale: string;
  resourcesAuthorized: string | null;
  followUpOwner: string | null;
  followUpDate: string | null;
  decidedById: string;
  decidedByName: string;
  createdAt: string;
}

const DECISION_TYPE_LABELS: Record<string, string> = {
  COMMITMENT_APPROVAL: 'Commitment Approval',
  COMMITMENT_ESCALATION: 'Commitment Escalation',
  BREACH_RESPONSE: 'Breach Response',
  LIFECYCLE_DIRECTION: 'Lifecycle Direction',
  CATALOG_ACCURACY: 'Catalog Accuracy',
};

const DECISION_TYPE_BADGE_CLS: Record<string, string> = {
  COMMITMENT_APPROVAL:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  COMMITMENT_ESCALATION:
    'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
  BREACH_RESPONSE:
    'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  LIFECYCLE_DIRECTION:
    'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
  CATALOG_ACCURACY:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
};

/* --------------------- Approve dialog --------------------- */

function ApproveCommitmentDialog({
  open,
  onOpenChange,
  demand,
  serviceName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  demand: Demand | null;
  serviceName: string;
  pending: boolean;
  onConfirm: (rationale: string, followUpOwner: string, followUpDate: string) => void;
}) {
  const [rationale, setRationale] = useState('');
  const [followUpOwner, setFollowUpOwner] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  // Reset on close
  const handleClose = (v: boolean) => {
    if (!v) {
      setRationale('');
      setFollowUpOwner('');
      setFollowUpDate('');
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Approve Service Commitment
          </DialogTitle>
          <DialogDescription>
            {demand
              ? `You are approving the service commitment for "${demand.title}" on ${serviceName}. This decision is recorded in the governance audit trail.`
              : 'Loading demand…'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="approve-rationale">Rationale (required)</Label>
            <Textarea
              id="approve-rationale"
              rows={5}
              placeholder="Explain the basis for approval — SLA class confirmation, capacity check, support model alignment, dependencies reviewed…"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This rationale is recorded in the governance decision audit trail and visible to CM Leaders.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-owner">Follow-up owner (optional)</Label>
              <Input
                id="follow-up-owner"
                placeholder="e.g. CE Worker name"
                value={followUpOwner}
                onChange={(e) => setFollowUpOwner(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-date">Follow-up date (optional)</Label>
              <Input
                id="follow-up-date"
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(rationale.trim(), followUpOwner.trim(), followUpDate)}
            disabled={pending || !rationale.trim()}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Recording…' : 'Approve Commitment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Escalate dialog --------------------- */

function EscalateDialog({
  open,
  onOpenChange,
  demand,
  serviceName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  demand: Demand | null;
  serviceName: string;
  pending: boolean;
  onConfirm: (rationale: string) => void;
}) {
  const [rationale, setRationale] = useState('');

  const handleClose = (v: boolean) => {
    if (!v) setRationale('');
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-violet-600" /> Escalate to Governance Owner
          </DialogTitle>
          <DialogDescription>
            {demand
              ? `Escalating "${demand.title}" on ${serviceName} beyond your Service Owner authority to the Governance Owner (enterprise risk).`
              : 'Loading demand…'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="escalate-rationale">Rationale (required)</Label>
          <Textarea
            id="escalate-rationale"
            rows={5}
            placeholder="Explain why this commitment exceeds your authority — enterprise risk, cross-domain impact, regulatory exposure, cost beyond threshold…"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The escalation is recorded in the audit trail and CM Leaders are notified.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => onConfirm(rationale.trim())}
            disabled={pending || !rationale.trim()}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <ArrowUpCircle className="h-4 w-4 mr-1.5" />}
            {pending ? 'Escalating…' : 'Escalate to Governance Owner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Main --------------------- */

export default function Governance() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();
  const demandsQ = useAcceptedDemands();
  const changesQ = useAllChanges();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);

  const demandsAwaiting = useMemo(
    () =>
      (demandsQ.data ?? []).filter((d) =>
        d.relatedServiceIds.some((sid) => myServiceIds.has(sid)),
      ),
    [demandsQ.data, myServiceIds],
  );

  const myChanges = useMemo(
    () =>
      (changesQ.data ?? []).filter((c) => c.affectedServiceIds.some((sid) => myServiceIds.has(sid))),
    [changesQ.data, myServiceIds],
  );

  const catalogProposals = myChanges.filter((c) => c.status === 'PLANNING');
  const changeBoardItems = myChanges.filter((c) => c.complexity === 'COMPLEX');

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
  const serviceSlaClass = (id: string) => services.find((s) => s.id === id)?.slaClass;

  /* --- Governance decisions history --- */
  // Fetch decisions for each owned service (one query per service is OK; owners usually own ≤ 5 services)
  const decisionsQueries = useQuery({
    queryKey: ['governance-decisions', 'owner', Array.from(myServiceIds).sort().join(',')] as const,
    queryFn: async (): Promise<GovernanceDecision[]> => {
      if (myServiceIds.size === 0) return [];
      // We fetch one service at a time and merge — the GET endpoint accepts a single serviceId.
      const results = await Promise.all(
        Array.from(myServiceIds).map((sid) =>
          apiGet<GovernanceDecision[]>(`/api/governance-decisions?serviceId=${encodeURIComponent(sid)}`),
        ),
      );
      return results.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    enabled: myServiceIds.size > 0,
    staleTime: 30_000,
  });

  const decisions: GovernanceDecision[] = decisionsQueries.data ?? [];

  // Map of demandId → decision, so we can hide demands that have already been approved/escalated
  const decisionsByDemandId = useMemo(() => {
    const m = new Map<string, GovernanceDecision[]>();
    for (const d of decisions) {
      if (!d.demandId) continue;
      const arr = m.get(d.demandId) ?? [];
      arr.push(d);
      m.set(d.demandId, arr);
    }
    return m;
  }, [decisions]);

  // Hide demands that already have a final COMMITMENT_APPROVAL or COMMITMENT_ESCALATION decision
  const pendingDemands = useMemo(
    () =>
      demandsAwaiting.filter((d) => {
        const existing = decisionsByDemandId.get(d.id) ?? [];
        return !existing.some(
          (dec) =>
            dec.decisionType === 'COMMITMENT_APPROVAL' ||
            dec.decisionType === 'COMMITMENT_ESCALATION',
        );
      }),
    [demandsAwaiting, decisionsByDemandId],
  );

  /* --- Dialog state --- */
  const [approveTarget, setApproveTarget] = useState<Demand | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<Demand | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['governance-decisions'] });
    qc.invalidateQueries({ queryKey: ['demands-accepted'] });
    qc.invalidateQueries({ queryKey: ['demand'] });
    qc.invalidateQueries({ queryKey: ['demands'] });
  };

  const approveMutation = useMutation({
    mutationFn: (args: {
      demand: Demand;
      serviceId: string;
      rationale: string;
      followUpOwner: string;
      followUpDate: string;
    }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.serviceId,
        demandId: args.demand.id,
        decisionType: 'COMMITMENT_APPROVAL',
        decision: 'APPROVED',
        rationale: args.rationale,
        followUpOwner: args.followUpOwner || undefined,
        followUpDate: args.followUpDate || undefined,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Service commitment approved', {
        description: `"${vars.demand.title}" — commitment recorded for ${serviceName(vars.serviceId)}.`,
      });
      invalidateAll();
      setApproveTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const escalateMutation = useMutation({
    mutationFn: (args: { demand: Demand; serviceId: string; rationale: string }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.serviceId,
        demandId: args.demand.id,
        decisionType: 'COMMITMENT_ESCALATION',
        decision: 'ESCALATED',
        rationale: args.rationale,
      }),
    onSuccess: (_data, vars) => {
      toast.info('Demand escalated to Governance Owner', {
        description: `"${vars.demand.title}" escalated beyond Service Owner authority.`,
      });
      invalidateAll();
      setEscalateTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading =
    servicesQ.isLoading || demandsQ.isLoading || changesQ.isLoading || decisionsQueries.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Approvals"
        description="As Service Owner you approve service commitments at demand acceptance, review catalog change proposals, and sit on the Change Board for complex changes on your services."
        icon={<ShieldCheck className="h-6 w-6" />}
      />

      {/* Escalation chain reference */}
      <SectionCard
        title="Escalation Chain"
        description="Your accountability sits between the CM Leader (who authorises quotes) and the Governance Owner (who holds enterprise risk authority)."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-rose-500/20 flex items-center justify-center">
              <Users className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-300">CM Leader</div>
              <div className="text-[11px] text-muted-foreground">Quote authorisation gate</div>
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          <div className="flex items-center gap-2 rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                You · Service Owner
              </div>
              <div className="text-[11px] text-muted-foreground">Commitment & catalog approval</div>
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          <div className="flex items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/40 dark:bg-violet-950/20 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Gavel className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-violet-800 dark:text-violet-300">
                Governance Owner
              </div>
              <div className="text-[11px] text-muted-foreground">Enterprise risk authority</div>
            </div>
          </div>
        </div>
      </SectionCard>

      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {/* Demand commitments awaiting approval */}
          <SectionCard
            title="Service Commitments Awaiting Your Approval"
            description="Accepted demands on your services — the customer has accepted the quote and you must approve the service commitment (SLA class, delivery window, support model) before the change is created."
            actions={
              pendingDemands.length > 0 ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  {pendingDemands.length} pending
                </Badge>
              ) : undefined
            }
          >
            {pendingDemands.length === 0 ? (
              <EmptyState
                icon={<Gavel className="h-8 w-8" />}
                title="No commitments awaiting approval"
                description="When a customer accepts a quote on your service, the commitment request appears here. Decisions you have already recorded appear in the Governance Decision History below."
              />
            ) : (
              <div className="space-y-3">
                {pendingDemands.map((d) => {
                  const myServiceId = d.relatedServiceIds.find((sid) => myServiceIds.has(sid));
                  const slaClass = myServiceId ? serviceSlaClass(myServiceId) : undefined;
                  return (
                    <div
                      key={d.id}
                      className="rounded-lg border p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold">{d.title}</h3>
                            <DemandStatusBadge status={d.status} />
                            {slaClass && <SlaClassBadge slaClass={slaClass} />}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" /> {d.serviceCustomerName ?? 'Customer'}
                            </span>
                            <span>·</span>
                            <span>SCM: {d.assignedScmWorkerName ?? 'Unassigned'}</span>
                            <span>·</span>
                            <span>Service: {myServiceId ? serviceName(myServiceId) : '—'}</span>
                            <span>·</span>
                            <RelativeTime date={d.acceptedAt ?? d.createdAt} />
                          </div>
                          {d.commitmentNotes && (
                            <div className="mt-2.5 rounded-md bg-muted/60 p-2.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                Proposed Commitment
                              </div>
                              <p className="text-xs leading-relaxed text-foreground/90">
                                {d.commitmentNotes}
                              </p>
                            </div>
                          )}
                          {d.estimatedEffortDays != null && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Estimated effort: {d.estimatedEffortDays} days
                              {d.estimatedCost != null && ` · est. cost $${d.estimatedCost.toLocaleString()}`}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setApproveTarget(d)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => setEscalateTarget(d)}
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-xs"
                            onClick={() => navigate('demand-detail', { id: d.id })}
                          >
                            <FileText className="h-3.5 w-3.5" /> View detail
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Governance Decision History */}
          <SectionCard
            title="Governance Decision History"
            description="Every commitment approval, escalation, and breach response you record is persisted here as a governance audit trail."
            actions={
              decisions.length > 0 ? (
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  <History className="h-3 w-3 mr-1" /> {decisions.length} recorded
                </Badge>
              ) : undefined
            }
          >
            {decisions.length === 0 ? (
              <EmptyState
                icon={<History className="h-7 w-7" />}
                title="No governance decisions recorded yet"
                description="Your commitment approvals, escalations, and breach responses will appear here as a permanent audit trail."
              />
            ) : (
              <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
                {decisions.map((dec) => {
                  const cls = DECISION_TYPE_BADGE_CLS[dec.decisionType] ?? '';
                  return (
                    <li key={dec.id} className="py-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={cls}>
                              {DECISION_TYPE_LABELS[dec.decisionType] ?? dec.decisionType}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                dec.decision === 'APPROVED'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                  : dec.decision === 'ESCALATED'
                                    ? 'border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              }
                            >
                              {dec.decision.replace(/_/g, ' ').toLowerCase()}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              on <span className="font-medium text-foreground/80">{serviceName(dec.serviceId)}</span>
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">
                            {dec.rationale}
                          </p>
                          {(dec.resourcesAuthorized || dec.followUpOwner || dec.followUpDate) && (
                            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              {dec.resourcesAuthorized && (
                                <span>Resources: {dec.resourcesAuthorized}</span>
                              )}
                              {dec.followUpOwner && <span>Follow-up: {dec.followUpOwner}</span>}
                              {dec.followUpDate && (
                                <span>By <FormattedDate date={dec.followUpDate} /></span>
                              )}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Decided by {dec.decidedByName} · <RelativeTime date={dec.createdAt} />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Catalog change proposals */}
            <SectionCard
              title="Catalog Change Proposals"
              description="Changes in PLANNING status affecting your services — review proposed catalog updates before approval."
            >
              {catalogProposals.length === 0 ? (
                <EmptyState
                  icon={<GitBranch className="h-7 w-7" />}
                  title="No catalog proposals in planning"
                  description="Catalog changes in PLANNING status on your services will appear here."
                />
              ) : (
                <ul className="divide-y">
                  {catalogProposals.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Affects:{' '}
                            {c.affectedServiceIds
                              .filter((sid) => myServiceIds.has(sid))
                              .map((sid) => serviceName(sid))
                              .join(', ')}
                          </div>
                        </div>
                        <ChangeStatusBadge status={c.status} className="shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* Change Board items */}
            <SectionCard
              title="Change Board Items"
              description="Complex changes on your services requiring Change Board review."
            >
              {changeBoardItems.length === 0 ? (
                <EmptyState
                  icon={<Gavel className="h-7 w-7" />}
                  title="No complex changes pending"
                  description="Complex changes affecting your services will surface here for Change Board review."
                />
              ) : (
                <ul className="divide-y">
                  {changeBoardItems.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            CE: {c.assignedCeWorkerName ?? 'Unassigned'} ·{' '}
                            <RelativeTime date={c.createdAt} />
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 shrink-0"
                        >
                          {c.complexity}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}

      {/* Approve dialog */}
      <ApproveCommitmentDialog
        open={!!approveTarget}
        onOpenChange={(v) => !v && setApproveTarget(null)}
        demand={approveTarget}
        serviceName={approveTarget ? serviceName(approveTarget.relatedServiceIds.find((sid) => myServiceIds.has(sid)) ?? '') : ''}
        pending={approveMutation.isPending}
        onConfirm={(rationale, followUpOwner, followUpDate) => {
          if (!approveTarget) return;
          const serviceId = approveTarget.relatedServiceIds.find((sid) => myServiceIds.has(sid));
          if (!serviceId) {
            toast.error('Could not determine the service to record the decision against.');
            return;
          }
          approveMutation.mutate({ demand: approveTarget, serviceId, rationale, followUpOwner, followUpDate });
        }}
      />

      {/* Escalate dialog */}
      <EscalateDialog
        open={!!escalateTarget}
        onOpenChange={(v) => !v && setEscalateTarget(null)}
        demand={escalateTarget}
        serviceName={escalateTarget ? serviceName(escalateTarget.relatedServiceIds.find((sid) => myServiceIds.has(sid)) ?? '') : ''}
        pending={escalateMutation.isPending}
        onConfirm={(rationale) => {
          if (!escalateTarget) return;
          const serviceId = escalateTarget.relatedServiceIds.find((sid) => myServiceIds.has(sid));
          if (!serviceId) {
            toast.error('Could not determine the service to record the decision against.');
            return;
          }
          escalateMutation.mutate({ demand: escalateTarget, serviceId, rationale });
        }}
      />
    </div>
  );
}

