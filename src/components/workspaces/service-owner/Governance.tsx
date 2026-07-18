'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { toast } from 'sonner';
import type { Demand, Problem } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  ChangeStatusBadge,
  DemandStatusBadge,
  RelativeTime,
  FormattedDate,
  Button,
  Badge,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  ShieldAlert,
  ClipboardCheck,
  RefreshCw,
  Stethoscope,
  Megaphone,
  ListChecks,
} from 'lucide-react';
import { useOwnerServices, useAcceptedDemands, useAllChanges, useSlaEvents, useOwnerProblems } from './_hooks';
import { OwnerDecisionDialog } from './_components/OwnerDecisionDialog';

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
  KNOWLEDGE_APPROVAL: 'Knowledge Approval',
  CUSTOMER_RISK_ESCALATION: 'Customer Risk Escalation',
  REMEDIATION_AUTHORIZATION: 'Remediation Authorization',
  POST_IMPLEMENTATION_REVIEW: 'Post-Implementation Review',
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
  KNOWLEDGE_APPROVAL:
    'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
  POST_IMPLEMENTATION_REVIEW:
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900',
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
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
  const serviceSlaClass = (id: string) => services.find((s) => s.id === id)?.slaClass;

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

  const mySlaEvents = useMemo(
    () => (slaQ.data ?? []).filter((e) => myServiceIds.has(e.serviceId)),
    [slaQ.data, myServiceIds],
  );

  const myProblems = problemsQ.data ?? [];

  const openBreaches = useMemo(
    () => mySlaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt),
    [mySlaEvents],
  );

  // Catalog overdue — services where lastReviewedAt > 90 days (use updatedAt as proxy when null).
  const catalogOverdue = useMemo(() => {
    const ninetyDaysAgo = Date.now() - 90 * 86400000;
    return services.filter((s) => {
      // ServiceHealthSummary has lastReviewedAt; for the simple Service shape we
      // fall back to updatedAt. The Portfolio view shows the precise date.
      const last = (s as unknown as { lastReviewedAt?: string }).lastReviewedAt;
      const dateMs = last ? new Date(last).getTime() : new Date(s.updatedAt ?? s.createdAt).getTime();
      return dateMs < ninetyDaysAgo;
    });
  }, [services]);

  /* --- Governance decisions history --- */
  const decisionsQuery = useQuery({
    queryKey: ['governance-decisions', 'owner', Array.from(myServiceIds).sort().join(',')] as const,
    queryFn: async (): Promise<GovernanceDecision[]> => {
      if (myServiceIds.size === 0) return [];
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

  const decisions: GovernanceDecision[] = decisionsQuery.data ?? [];

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

  // Open escalations (COMMITMENT_ESCALATION decisions without a subsequent resolution).
  const openEscalations = useMemo(
    () => decisions.filter((d) => d.decisionType === 'COMMITMENT_ESCALATION').slice(0, 20),
    [decisions],
  );

  // Lifecycle decisions history.
  const lifecycleDecisions = useMemo(
    () => decisions.filter((d) => d.decisionType === 'LIFECYCLE_DIRECTION'),
    [decisions],
  );

  // Breach decisions (for "Breach Responses" tab — show all BREACH_RESPONSE decisions).
  const breachDecisions = useMemo(
    () => decisions.filter((d) => d.decisionType === 'BREACH_RESPONSE'),
    [decisions],
  );

  // Set of breach slaEventIds that already have a BREACH_RESPONSE decision.
  const respondedBreachEventIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of decisions) {
      if (d.decisionType === 'BREACH_RESPONSE' && d.slaEventId) s.add(d.slaEventId);
    }
    return s;
  }, [decisions]);

  // Filter history by selected decisionType.
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  const filteredHistory = useMemo(
    () => (historyFilter === 'ALL' ? decisions : decisions.filter((d) => d.decisionType === historyFilter)),
    [decisions, historyFilter],
  );

  /* --- Dialog state --- */
  const [approveTarget, setApproveTarget] = useState<Demand | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<Demand | null>(null);
  const [breachTarget, setBreachTarget] = useState<{
    eventId: string;
    serviceId: string;
    serviceName: string;
    message: string;
    createdAt: string;
  } | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<{ serviceId: string; serviceName: string } | null>(null);
  const [catalogTarget, setCatalogTarget] = useState<{ serviceId: string; serviceName: string } | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['governance-decisions'] });
    qc.invalidateQueries({ queryKey: ['demands-accepted'] });
    qc.invalidateQueries({ queryKey: ['demand'] });
    qc.invalidateQueries({ queryKey: ['demands'] });
    qc.invalidateQueries({ queryKey: ['owner-services'] });
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

  // Note: breach responses are recorded by the OwnerDecisionDialog itself
  // (it POSTs directly to /api/governance-decisions). The dialog's
  // onSubmitted callback simply closes the local dialog state; no duplicate
  // mutation is needed here.

  const markReviewedMutation = useMutation({
    mutationFn: (args: { serviceId: string }) =>
      apiPatch(`/api/services/${args.serviceId}`, { lastReviewedAt: 'now' }),
    onSuccess: (_data, vars) => {
      // Also record a CATALOG_ACCURACY governance decision for audit.
      apiPost('/api/governance-decisions', {
        serviceId: vars.serviceId,
        decisionType: 'CATALOG_ACCURACY',
        decision: 'APPROVED',
        rationale: `Catalog entry reviewed and confirmed accurate by Service Owner on ${new Date().toLocaleDateString()}.`,
      })
        .then(() => {
          toast.success('Catalog marked as reviewed', {
            description: `${serviceName(vars.serviceId)} — lastReviewedAt updated to now. CATALOG_ACCURACY decision recorded.`,
          });
          invalidateAll();
          setCatalogTarget(null);
        })
        .catch((e: Error) => {
          toast.warning('Catalog stamp saved, but governance decision failed', { description: e.message });
          invalidateAll();
          setCatalogTarget(null);
        });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading =
    servicesQ.isLoading ||
    demandsQ.isLoading ||
    changesQ.isLoading ||
    decisionsQuery.isLoading ||
    slaQ.isLoading ||
    problemsQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Approvals"
        description="As Service Owner you approve service commitments at demand acceptance, record breach responses, set lifecycle direction, attest catalog accuracy, and review escalations — every decision is persisted to the audit trail."
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
        <Tabs defaultValue="commitments" className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-6 h-auto">
            <TabsTrigger value="commitments" className="text-xs">
              Commitments
              {pendingDemands.length > 0 && (
                <Badge variant="outline" className="ml-1.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 text-[10px] px-1.5 py-0">
                  {pendingDemands.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="breaches" className="text-xs">
              Breach Responses
              {openBreaches.length > 0 && (
                <Badge variant="outline" className="ml-1.5 bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 text-[10px] px-1.5 py-0">
                  {openBreaches.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="lifecycle" className="text-xs">Lifecycle</TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs">
              Catalog
              {catalogOverdue.length > 0 && (
                <Badge variant="outline" className="ml-1.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 text-[10px] px-1.5 py-0">
                  {catalogOverdue.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="escalations" className="text-xs">Escalations</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
          </TabsList>

          {/* Commitment Approvals tab */}
          <TabsContent value="commitments" className="space-y-4 mt-4">
            <SectionCard
              title="Service Commitments Awaiting Your Approval"
              description="Accepted demands on your services — the customer has accepted the quote and you must approve the service commitment (SLA class, delivery window, support model) before the change is created."
            >
              {pendingDemands.length === 0 ? (
                <EmptyState
                  icon={<Gavel className="h-8 w-8" />}
                  title="No commitments awaiting approval"
                  description="When a customer accepts a quote on your service, the commitment request appears here. Decisions you have already recorded appear in the History tab."
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
          </TabsContent>

          {/* Breach Responses tab */}
          <TabsContent value="breaches" className="space-y-4 mt-4">
            <SectionCard
              title="Breach Responses"
              description="Each unresolved SLA breach on your services requires a governance response. Recorded responses are persisted to the audit trail and CM Leaders are notified."
            >
              {openBreaches.length === 0 ? (
                <EmptyState
                  icon={<ShieldAlert className="h-8 w-8" />}
                  title="No active breaches on your services"
                  description="All SLA commitments are within target. Continue monitoring warnings."
                />
              ) : (
                <div className="space-y-2.5">
                  {openBreaches.map((b) => {
                    const responded = respondedBreachEventIds.has(b.id);
                    return (
                      <div
                        key={b.id}
                        className={`rounded-lg border p-3 ${
                          responded
                            ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                            : 'border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {responded ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                              )}
                              <span className="text-sm font-medium">{serviceName(b.serviceId)}</span>
                              {responded ? (
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]">
                                  Response recorded
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 text-[10px] font-semibold">
                                  Response required
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                Breached <RelativeTime date={b.createdAt} />
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs text-foreground/80 leading-relaxed">{b.message}</p>
                          </div>
                          <div className="shrink-0">
                            {responded ? (
                              <Button size="sm" variant="outline" className="h-7" onClick={() => setHistoryFilter('BREACH_RESPONSE')}>
                                View in history
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 gap-1.5"
                                onClick={() =>
                                  setBreachTarget({
                                    eventId: b.id,
                                    serviceId: b.serviceId,
                                    serviceName: serviceName(b.serviceId),
                                    message: b.message,
                                    createdAt: b.createdAt,
                                  })
                                }
                              >
                                <Gavel className="h-3 w-3" /> Record Response
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {breachDecisions.length > 0 && (
              <SectionCard
                title="Recorded Breach Responses"
                description="Breach responses you have already recorded — persisted to the governance audit trail."
              >
                <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
                  {breachDecisions.slice(0, 12).map((dec) => (
                    <li key={dec.id} className="py-2.5">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                          {dec.decision.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          on <span className="font-medium text-foreground/80">{serviceName(dec.serviceId)}</span> · <RelativeTime date={dec.createdAt} />
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">{dec.rationale}</p>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </TabsContent>

          {/* Lifecycle tab */}
          <TabsContent value="lifecycle" className="space-y-4 mt-4">
            <SectionCard
              title="Lifecycle Direction"
              description="Record your governance direction on each service — continue active, escalate to retirement candidate, or confirm review."
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    setLifecycleTarget({
                      serviceId: services[0]?.id ?? '',
                      serviceName: services[0]?.name ?? '',
                    })
                  }
                  disabled={services.length === 0}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Record Lifecycle Direction
                </Button>
              }
            >
              {services.length === 0 ? (
                <EmptyState
                  icon={<RefreshCw className="h-8 w-8" />}
                  title="No services in portfolio"
                  description="Services you own will appear here for lifecycle direction."
                />
              ) : (
                <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
                  {services.map((s) => (
                    <li
                      key={s.id}
                      className="py-2.5 flex items-start justify-between gap-2 flex-wrap hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{s.name}</span>
                          <SlaClassBadge slaClass={s.slaClass} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.chapter} · {s.layer}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5"
                        onClick={() => setLifecycleTarget({ serviceId: s.id, serviceName: s.name })}
                      >
                        <RefreshCw className="h-3 w-3" /> Record Direction
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {lifecycleDecisions.length > 0 && (
              <SectionCard
                title="Lifecycle Decision History"
                description="Previously recorded lifecycle directions."
              >
                <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
                  {lifecycleDecisions.map((dec) => (
                    <li key={dec.id} className="py-2.5">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px] bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300">
                          {dec.decision.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          on <span className="font-medium text-foreground/80">{serviceName(dec.serviceId)}</span> · <RelativeTime date={dec.createdAt} />
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">{dec.rationale}</p>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </TabsContent>

          {/* Catalog Accuracy tab */}
          <TabsContent value="catalog" className="space-y-4 mt-4">
            <SectionCard
              title="Catalog Accuracy"
              description="Services in your portfolio whose catalog entry has not been reviewed in 90+ days. Mark each as reviewed when you confirm the catalog is accurate, or request an update."
            >
              {catalogOverdue.length === 0 ? (
                <EmptyState
                  icon={<ClipboardCheck className="h-8 w-8 text-emerald-500" />}
                  title="Catalog reviews up to date"
                  description="Every owned service has been reviewed within the last 90 days."
                />
              ) : (
                <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
                  {catalogOverdue.map((s) => (
                    <li
                      key={s.id}
                      className="py-3 flex items-start justify-between gap-2 flex-wrap hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{s.name}</span>
                          <SlaClassBadge slaClass={s.slaClass} />
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                            Review overdue
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Last reviewed: <FormattedDate date={(s as unknown as { lastReviewedAt?: string }).lastReviewedAt ?? s.updatedAt ?? s.createdAt} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 gap-1.5"
                          onClick={() => setCatalogTarget({ serviceId: s.id, serviceName: s.name })}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Mark Reviewed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5"
                          onClick={() => navigate('portfolio')}
                        >
                          <Megaphone className="h-3 w-3" /> Request Update
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </TabsContent>

          {/* Escalations tab */}
          <TabsContent value="escalations" className="space-y-4 mt-4">
            <SectionCard
              title="Open Escalations"
              description="Commitments you have escalated to the Governance Owner. These remain visible until the Governance Owner resolves them."
            >
              {openEscalations.length === 0 ? (
                <EmptyState
                  icon={<ArrowUpCircle className="h-8 w-8" />}
                  title="No open escalations"
                  description="When you escalate a commitment beyond your authority, it appears here until resolved."
                />
              ) : (
                <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
                  {openEscalations.map((dec) => (
                    <li key={dec.id} className="py-2.5">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300">
                          <ArrowUpCircle className="h-3 w-3 mr-1" /> Escalated
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          on <span className="font-medium text-foreground/80">{serviceName(dec.serviceId)}</span> · <RelativeTime date={dec.createdAt} />
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">{dec.rationale}</p>
                      {dec.demandId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-6 text-[11px] gap-1"
                          onClick={() => navigate('demand-detail', { id: dec.demandId! })}
                        >
                          View demand <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </TabsContent>

          {/* Decision History tab */}
          <TabsContent value="history" className="space-y-4 mt-4">
            <SectionCard
              title="Governance Decision History"
              description="Every commitment approval, escalation, breach response, lifecycle direction, and catalog attestation you record is persisted here as a governance audit trail."
              actions={
                <Select value={historyFilter} onValueChange={setHistoryFilter}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="Filter by type…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All decision types</SelectItem>
                    {Object.entries(DECISION_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {filteredHistory.length === 0 ? (
                <EmptyState
                  icon={<History className="h-7 w-7" />}
                  title="No governance decisions recorded yet"
                  description="Your commitment approvals, escalations, and breach responses will appear here as a permanent audit trail."
                />
              ) : (
                <ul className="divide-y max-h-[480px] overflow-y-auto scrollbar-thin">
                  {filteredHistory.map((dec) => {
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
          </TabsContent>
        </Tabs>
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

      {/* Breach Response dialog (uses OwnerDecisionDialog wrapper — the dialog
          itself POSTs to /api/governance-decisions; we only need to close on success) */}
      {breachTarget && (
        <OwnerDecisionDialog
          key={`breach:${breachTarget.eventId}`}
          open={!!breachTarget}
          onOpenChange={(v) => !v && setBreachTarget(null)}
          serviceId={breachTarget.serviceId}
          slaEventId={breachTarget.eventId}
          decisionType="BREACH_RESPONSE"
          decisionOptions={[
            { value: 'REMEDIATION_AUTHORIZED', label: 'Remediation Authorized' },
            { value: 'RESOURCES_AUTHORIZED', label: 'Resources Authorized' },
            { value: 'EMERGENCY_CHANGE_DIRECTED', label: 'Emergency Change Directed' },
          ]}
          dialogTitle="Record Breach Response"
          dialogDescription={
            <span>
              Breach on <span className="font-medium">{breachTarget.serviceName}</span> —{' '}
              {breachTarget.message.slice(0, 100)} — detected <FormattedDate date={breachTarget.createdAt} />.
              Your response is persisted to the audit trail and CM Leaders are notified.
            </span>
          }
          onSubmitted={() => setBreachTarget(null)}
        />
      )}

      {/* Lifecycle Direction dialog */}
      {lifecycleTarget && (
        <LifecycleDirectionDialogWrapper
          open={!!lifecycleTarget}
          onOpenChange={(v) => !v && setLifecycleTarget(null)}
          serviceId={lifecycleTarget.serviceId}
          serviceName={lifecycleTarget.serviceName}
        />
      )}

      {/* Catalog mark-reviewed confirmation */}
      {catalogTarget && (
        <CatalogReviewedConfirmDialog
          open={!!catalogTarget}
          onOpenChange={(v) => !v && setCatalogTarget(null)}
          serviceName={catalogTarget.serviceName}
          pending={markReviewedMutation.isPending}
          onConfirm={() =>
            markReviewedMutation.mutate({ serviceId: catalogTarget.serviceId })
          }
        />
      )}
    </div>
  );
}

/* --------------------- Lifecycle Direction Dialog wrapper --------------------- */

function LifecycleDirectionDialogWrapper({
  open,
  onOpenChange,
  serviceId,
  serviceName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serviceId: string;
  serviceName: string;
}) {
  return (
    <OwnerDecisionDialog
      key={`lifecycle:${serviceId}`}
      open={open}
      onOpenChange={onOpenChange}
      serviceId={serviceId}
      decisionType="LIFECYCLE_DIRECTION"
      decisionOptions={[
        { value: 'APPROVED', label: 'Continue — Active lifecycle confirmed' },
        { value: 'ESCALATED', label: 'Escalate — Retirement candidate' },
      ]}
      dialogTitle="Record Lifecycle Direction"
      dialogDescription={
        <span>
          Record your governance direction for <span className="font-medium">{serviceName}</span>. The
          rationale is persisted to the audit trail.
        </span>
      }
    />
  );
}

/* --------------------- Catalog Reviewed Confirm --------------------- */

function CatalogReviewedConfirmDialog({
  open,
  onOpenChange,
  serviceName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serviceName: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-emerald-600" /> Mark Catalog Accurate
          </DialogTitle>
          <DialogDescription>
            Confirm that the catalog entry for <span className="font-medium">{serviceName}</span> is
            accurate. This stamps <code className="text-[11px]">lastReviewedAt</code> to now and records
            a <code className="text-[11px]">CATALOG_ACCURACY</code> governance decision in the audit
            trail.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Marking…' : 'Mark Reviewed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
