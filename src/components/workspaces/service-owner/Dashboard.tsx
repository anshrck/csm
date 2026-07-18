'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import {
  PageHeader,
  StatCard,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  DemandStatusBadge,
  ChangeStatusBadge,
  RelativeTime,
  FormattedDate,
  Button,
  Badge,
  DataTable,
  type Column,
} from '@/components/shared';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
  Briefcase,
  TriangleAlert,
  ShieldAlert,
  Bug,
  Gavel,
  ArrowRight,
  ClipboardList,
  BookOpen,
  Activity,
  ChevronRight,
  Clock,
  CheckCircle2,
  Gavel as GavelIcon,
  GitBranch,
  Star,
  AlertOctagon,
  ListTodo,
  Flame,
  CalendarClock,
  Stethoscope,
  Megaphone,
  HeartPulse,
  History,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useOwnerProblems,
  useAcceptedDemands,
  useAllChanges,
  deriveHealth,
} from './_hooks';
import type { Ticket } from '@/lib/tickets';
import type {
  ServiceHealthSummary,
  CustomerImpactSummary,
  OwnerRiskItem,
} from '@/lib/types';

/* --------------------- Stats endpoint response types --------------------- */

interface TicketsStatsResponse {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  unassigned: number;
  waitingCustomer: number;
  reopened: number;
  slaBreached: number;
}

interface SlaStatsResponse {
  compliancePct: number | null;
  activeBreaches: number;
  activeWarnings: number;
  byService: {
    serviceId: string;
    serviceName: string;
    slaClass: string;
    compliancePct: number | null;
    breaches: number;
    warnings: number;
  }[];
}

interface CustomerHealthEntry {
  orgNodeId: string;
  orgNodeName: string;
  openTickets: number;
  activeDemands: number;
  slaBreaches: number;
  avgCsat: number | null;
  healthScore: number;
  health: 'green' | 'amber' | 'red';
}

interface CustomerHealthResponse {
  byCustomer: CustomerHealthEntry[];
}

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

type BreachDecision = 'REMEDIATION_AUTHORIZED' | 'RESOURCES_AUTHORIZED' | 'EMERGENCY_CHANGE_DIRECTED';

const BREACH_DECISION_LABELS: Record<BreachDecision, string> = {
  REMEDIATION_AUTHORIZED: 'Remediation Authorized',
  RESOURCES_AUTHORIZED: 'Resources Authorized',
  EMERGENCY_CHANGE_DIRECTED: 'Emergency Change Directed',
};

/* --------------------- Required action item types --------------------- */

type RequiredActionType =
  | 'BREACH_RESPONSE'
  | 'COMMITMENT_APPROVAL'
  | 'KNOWN_ERROR_REVIEW'
  | 'CATALOG_REVIEW'
  | 'EMERGENCY_PIR'
  | 'LOW_CSAT'
  | 'PROBLEM_DECISION';

const ACTION_LABELS: Record<RequiredActionType, { label: string; tone: string; icon: React.ReactNode }> = {
  BREACH_RESPONSE: {
    label: 'Breach Response Missing',
    tone: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  },
  COMMITMENT_APPROVAL: {
    label: 'Commitment Approval',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
    icon: <Gavel className="h-3.5 w-3.5" />,
  },
  KNOWN_ERROR_REVIEW: {
    label: 'Known Error Review',
    tone: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
    icon: <BookOpen className="h-3.5 w-3.5" />,
  },
  CATALOG_REVIEW: {
    label: 'Catalog Review Overdue',
    tone: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
    icon: <ClipboardList className="h-3.5 w-3.5" />,
  },
  EMERGENCY_PIR: {
    label: 'Emergency PIR Due',
    tone: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
    icon: <Flame className="h-3.5 w-3.5" />,
  },
  LOW_CSAT: {
    label: 'Low CSAT Review',
    tone: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
    icon: <Star className="h-3.5 w-3.5" />,
  },
  PROBLEM_DECISION: {
    label: 'Problem Decision',
    tone: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
    icon: <Stethoscope className="h-3.5 w-3.5" />,
  },
};

function riskTone(risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string) {
  switch (risk) {
    case 'CRITICAL':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300';
    case 'HIGH':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300';
    case 'MEDIUM':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300';
    default:
      return 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300';
  }
}

interface RequiredAction {
  id: string;
  type: RequiredActionType;
  title: string;
  service: string;
  customerImpact?: string;
  age: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actionLabel: string;
  onAction: () => void;
}

/* --------------------- Breach Response Dialog --------------------- */

function BreachResponseDialog({
  open,
  onOpenChange,
  serviceName,
  breachMessage,
  breachDate,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serviceName: string;
  breachMessage: string;
  breachDate: string;
  pending: boolean;
  onConfirm: (decision: BreachDecision, rationale: string, resourcesAuthorized: string) => void;
}) {
  const [decision, setDecision] = useState<BreachDecision | ''>('');
  const [rationale, setRationale] = useState('');
  const [resourcesAuthorized, setResourcesAuthorized] = useState('');

  const handleClose = (v: boolean) => {
    if (!v) {
      setDecision('');
      setRationale('');
      setResourcesAuthorized('');
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-600" /> Record Breach Response
          </DialogTitle>
          <DialogDescription>
            Record your governance response to this SLA breach on{' '}
            <span className="font-medium">{serviceName}</span>. The decision is persisted to the audit
            trail and CM Leaders are notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-3 text-xs">
            <div className="font-medium text-rose-800 dark:text-rose-300">{serviceName}</div>
            <div className="text-rose-900/80 dark:text-rose-200/80 mt-1">{breachMessage}</div>
            <div className="text-muted-foreground mt-1">
              Detected <FormattedDate date={breachDate} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="breach-decision">Governance decision (required)</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as BreachDecision)}>
              <SelectTrigger id="breach-decision" className="w-full">
                <SelectValue placeholder="Select a response type…" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BREACH_DECISION_LABELS) as BreachDecision[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {BREACH_DECISION_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="breach-rationale">Rationale (required)</Label>
            <Textarea
              id="breach-rationale"
              rows={4}
              placeholder="Explain the breach context, root cause hypothesis, and why this response is the right governance action."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="breach-resources">Resources authorized (optional)</Label>
            <Input
              id="breach-resources"
              placeholder="e.g. 2 FTE for 5 days, $25k remediation budget"
              value={resourcesAuthorized}
              onChange={(e) => setResourcesAuthorized(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm(decision as BreachDecision, rationale.trim(), resourcesAuthorized.trim())
            }
            disabled={pending || !decision || !rationale.trim()}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Recording…' : 'Record Response'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Main Command Center --------------------- */

export default function Dashboard() {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();
  const demandsQ = useAcceptedDemands();
  const changesQ = useAllChanges();

  // Operational stats from the split endpoints (scoped to owned services).
  const ticketStatsQ = useQuery<TicketsStatsResponse>({
    queryKey: ['stats', 'tickets'],
    queryFn: () => apiGet<TicketsStatsResponse>('/api/stats/tickets'),
    staleTime: 30_000,
  });
  const slaStatsQ = useQuery<SlaStatsResponse>({
    queryKey: ['stats', 'sla'],
    queryFn: () => apiGet<SlaStatsResponse>('/api/stats/sla'),
    staleTime: 30_000,
  });
  const customerHealthQ = useQuery<CustomerHealthResponse>({
    queryKey: ['stats', 'customer-health'],
    queryFn: () => apiGet<CustomerHealthResponse>('/api/stats/customer-health'),
    staleTime: 60_000,
  });

  // Service-health summary (per-service KPIs incl. CSAT, risk score, lastReviewed).
  const serviceHealthQ = useQuery<ServiceHealthSummary[]>({
    queryKey: ['service-owner', 'service-health'],
    queryFn: () => apiGet<ServiceHealthSummary[]>('/api/service-owner/service-health'),
    staleTime: 30_000,
  });
  const customerImpactQ = useQuery<CustomerImpactSummary[]>({
    queryKey: ['service-owner', 'customer-impact'],
    queryFn: () => apiGet<CustomerImpactSummary[]>('/api/service-owner/customer-impact'),
    staleTime: 30_000,
  });
  const riskQ = useQuery<OwnerRiskItem[]>({
    queryKey: ['service-owner', 'risk-register'],
    queryFn: () => apiGet<OwnerRiskItem[]>('/api/service-owner/risk-register'),
    staleTime: 30_000,
  });

  // Open tickets on owned services for P1/P2 incident counts.
  const openTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'owner-dashboard', 'open'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER',
      ),
    staleTime: 30_000,
  });

  // Low-CSAT surveys on owned-service tickets.
  const lowCsatQ = useQuery<Array<{ id: string; rating: number; comment: string | null; entityId: string; entityType: string; customerName?: string; createdAt: string }>>({
    queryKey: ['surveys', 'low-csat', 'owner'],
    queryFn: () => apiGet('/api/surveys'),
    staleTime: 60_000,
  });

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);

  const mySlaEvents = useMemo(
    () => (slaQ.data ?? []).filter((e) => myServiceIds.has(e.serviceId)),
    [slaQ.data, myServiceIds],
  );

  const openBreaches = useMemo(
    () => mySlaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt),
    [mySlaEvents],
  );
  const openWarnings = useMemo(
    () => mySlaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt),
    [mySlaEvents],
  );

  const problems = problemsQ.data ?? [];
  const knownErrors = problems.filter((p) => p.knownErrorId || p.status === 'KNOWN_ERROR');
  const decisionNeeded = problems.filter((p) => p.status === 'DECISION');

  const governanceDemands = useMemo(
    () =>
      (demandsQ.data ?? []).filter((d) =>
        d.relatedServiceIds.some((sid) => myServiceIds.has(sid)),
      ),
    [demandsQ.data, myServiceIds],
  );

  // Changes touching my services.
  const myChanges = useMemo(() => {
    const all = changesQ.data ?? [];
    return all.filter((c) => c.affectedServiceIds.some((sid) => myServiceIds.has(sid)));
  }, [changesQ.data, myServiceIds]);

  const highRiskChanges = useMemo(
    () =>
      myChanges.filter(
        (c) =>
          c.status !== 'CLOSED' &&
          c.status !== 'REJECTED' &&
          (c.type === 'EMERGENCY' || c.complexity === 'COMPLEX'),
      ),
    [myChanges],
  );

  const emergencyPirDue = useMemo(
    () => myChanges.filter((c) => c.isEmergencyPostReviewDue),
    [myChanges],
  );

  // Catalog review overdue (>90 days).
  const catalogOverdue = useMemo(() => {
    const ninetyDaysAgo = Date.now() - 90 * 86400000;
    return (serviceHealthQ.data ?? []).filter((s) => {
      const last = s.lastReviewedAt ? new Date(s.lastReviewedAt).getTime() : 0;
      return last < ninetyDaysAgo;
    });
  }, [serviceHealthQ.data]);

  // Low-CSAT (rating <= 2) on owned services.
  const lowCsatSurveys = useMemo(() => {
    return (lowCsatQ.data ?? []).filter((s) => s.rating <= 2);
  }, [lowCsatQ.data]);

  // Incidents by priority.
  const incidentsByPriority = useMemo(() => {
    const counts: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const t of openTicketsQ.data ?? []) {
      const p = (t.priority ?? 'P4').toUpperCase();
      if (p in counts) counts[p] += 1;
    }
    return counts;
  }, [openTicketsQ.data]);

  const p1p2Count = incidentsByPriority.P1 + incidentsByPriority.P2;

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';

  /* --- Governance decisions for breach responses --- */
  const breachDecisionsQ = useQuery({
    queryKey: ['governance-decisions', 'breach', Array.from(myServiceIds).sort().join(',')] as const,
    queryFn: async (): Promise<GovernanceDecision[]> => {
      if (myServiceIds.size === 0) return [];
      const results = await Promise.all(
        Array.from(myServiceIds).map((sid) =>
          apiGet<GovernanceDecision[]>(
            `/api/governance-decisions?serviceId=${encodeURIComponent(sid)}&decisionType=BREACH_RESPONSE`,
          ),
        ),
      );
      return results.flat();
    },
    enabled: myServiceIds.size > 0,
    staleTime: 30_000,
  });

  const respondedBreachEventIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of breachDecisionsQ.data ?? []) {
      if (d.slaEventId) s.add(d.slaEventId);
    }
    return s;
  }, [breachDecisionsQ.data]);

  // Decisions history (last 10 for the governance history panel).
  const ownerDecisionsQ = useQuery({
    queryKey: ['governance-decisions', 'owner-history', Array.from(myServiceIds).sort().join(',')] as const,
    queryFn: async (): Promise<GovernanceDecision[]> => {
      if (myServiceIds.size === 0) return [];
      const results = await Promise.all(
        Array.from(myServiceIds).map((sid) =>
          apiGet<GovernanceDecision[]>(`/api/governance-decisions?serviceId=${encodeURIComponent(sid)}`),
        ),
      );
      return results.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 10);
    },
    enabled: myServiceIds.size > 0,
    staleTime: 30_000,
  });

  /* --- Breach response dialog state --- */
  const [breachTarget, setBreachTarget] = useState<{
    eventId: string;
    serviceId: string;
    serviceName: string;
    message: string;
    createdAt: string;
  } | null>(null);

  const breachResponseMutation = useMutation({
    mutationFn: (args: {
      serviceId: string;
      slaEventId: string;
      decision: BreachDecision;
      rationale: string;
      resourcesAuthorized: string;
    }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.serviceId,
        slaEventId: args.slaEventId,
        decisionType: 'BREACH_RESPONSE',
        decision: args.decision,
        rationale: args.rationale,
        resourcesAuthorized: args.resourcesAuthorized || undefined,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Governance response recorded', {
        description: `Breach response "${BREACH_DECISION_LABELS[vars.decision]}" recorded for ${serviceName(vars.serviceId)}.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      setBreachTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --- Build the Required Actions list (primary section) --- */
  const requiredActions: RequiredAction[] = useMemo(() => {
    const actions: RequiredAction[] = [];

    // 1. Breach response missing
    for (const b of openBreaches) {
      if (!respondedBreachEventIds.has(b.id)) {
        actions.push({
          id: `breach-${b.id}`,
          type: 'BREACH_RESPONSE',
          title: b.message.slice(0, 120) || `SLA breach on ${serviceName(b.serviceId)}`,
          service: serviceName(b.serviceId),
          customerImpact: b.serviceCustomerId ? 'Customer impacted' : 'Service-wide',
          age: b.createdAt,
          risk: 'CRITICAL',
          actionLabel: 'Record Response',
          onAction: () =>
            setBreachTarget({
              eventId: b.id,
              serviceId: b.serviceId,
              serviceName: serviceName(b.serviceId),
              message: b.message,
              createdAt: b.createdAt,
            }),
        });
      }
    }

    // 2. Accepted demand needing commitment approval
    for (const d of governanceDemands) {
      actions.push({
        id: `commit-${d.id}`,
        type: 'COMMITMENT_APPROVAL',
        title: d.title,
        service: d.relatedServiceIds.map((sid) => serviceName(sid)).join(', '),
        customerImpact: d.serviceCustomerName ?? undefined,
        age: d.acceptedAt ?? d.createdAt,
        risk: 'HIGH',
        actionLabel: 'Review & Approve',
        onAction: () => navigate('governance'),
      });
    }

    // 3. Known error needing workaround approval (KNOWN_ERROR without workaroundDescription)
    for (const p of knownErrors) {
      if (!p.workaroundDescription) {
        actions.push({
          id: `ke-${p.id}`,
          type: 'KNOWN_ERROR_REVIEW',
          title: p.title,
          service: p.serviceName ?? serviceName(p.serviceId),
          customerImpact: 'Customers exposed to known error',
          age: p.updatedAt,
          risk: 'HIGH',
          actionLabel: 'Review Workaround',
          onAction: () => navigate('problems'),
        });
      }
    }

    // 4. Catalog review overdue
    for (const s of catalogOverdue) {
      actions.push({
        id: `catalog-${s.serviceId}`,
        type: 'CATALOG_REVIEW',
        title: `Catalog entry for ${s.serviceName} not reviewed in 90+ days`,
        service: s.serviceName,
        customerImpact: 'Published catalog may be stale',
        age: s.lastReviewedAt ?? new Date(0).toISOString(),
        risk: 'MEDIUM',
        actionLabel: 'Review Catalog',
        onAction: () => navigate('portfolio'),
      });
    }

    // 5. Emergency post-implementation review due
    for (const c of emergencyPirDue) {
      actions.push({
        id: `pir-${c.id}`,
        type: 'EMERGENCY_PIR',
        title: c.title,
        service: c.affectedServiceIds.map((sid) => serviceName(sid)).join(', '),
        customerImpact: 'Emergency change awaiting post-implementation review',
        age: c.createdAt,
        risk: 'HIGH',
        actionLabel: 'Conduct PIR',
        onAction: () => navigate('changes'),
      });
    }

    // 6. Low CSAT (rating <= 2) needing owner review
    for (const s of lowCsatSurveys.slice(0, 5)) {
      actions.push({
        id: `csat-${s.id}`,
        type: 'LOW_CSAT',
        title: `CSAT rating ${s.rating}★ submitted${s.comment ? `: "${s.comment.slice(0, 80)}"` : ''}`,
        service: serviceName(s.entityId),
        customerImpact: s.customerName ?? 'Customer',
        age: s.createdAt,
        risk: 'HIGH',
        actionLabel: 'Review Survey',
        onAction: () => navigate('portfolio'),
      });
    }

    // 7. Problem decision needed (status === DECISION)
    for (const p of decisionNeeded) {
      actions.push({
        id: `pdec-${p.id}`,
        type: 'PROBLEM_DECISION',
        title: p.title,
        service: p.serviceName ?? serviceName(p.serviceId),
        customerImpact: 'Problem awaiting your governance direction',
        age: p.updatedAt,
        risk: 'HIGH',
        actionLabel: 'Record Decision',
        onAction: () => navigate('problems'),
      });
    }

    // Sort by risk severity, then by age.
    const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return actions.sort((a, b) => {
      const sev = (severityOrder[a.risk] ?? 4) - (severityOrder[b.risk] ?? 4);
      if (sev !== 0) return sev;
      return new Date(a.age).getTime() - new Date(b.age).getTime();
    });
  }, [
    openBreaches,
    respondedBreachEventIds,
    governanceDemands,
    knownErrors,
    catalogOverdue,
    emergencyPirDue,
    lowCsatSurveys,
    decisionNeeded,
    serviceName,
    navigate,
  ]);

  /* --- Service Health Heatmap rows --- */
  const heatmapRows = useMemo(() => {
    return (serviceHealthQ.data ?? []).map((s) => ({
      id: s.serviceId,
      service: s,
      serviceName: s.serviceName,
      slaClass: s.slaClass as 'A' | 'B' | 'C' | 'D',
      health: s.health,
      p1p2: s.p1p2Count,
      openProblems: s.problems,
      openChanges: s.highRiskChanges,
      knownErrors: s.knownErrors,
      csat: s.csat,
      riskScore: s.riskScore,
      lastReviewedAt: s.lastReviewedAt,
    }));
  }, [serviceHealthQ.data]);

  const heatmapColumns: Column<(typeof heatmapRows)[number]>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.serviceName}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <SlaClassBadge slaClass={r.slaClass} />
          </div>
        </div>
      ),
    },
    {
      key: 'health',
      header: 'SLA Health',
      render: (r) => <SlaHealthBadge health={r.health} />,
    },
    {
      key: 'p1p2',
      header: 'Open P1/P2',
      render: (r) =>
        r.p1p2 > 0 ? (
          <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 font-semibold">
            {r.p1p2}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      key: 'problems',
      header: 'Problems',
      render: (r) =>
        r.openProblems > 0 ? (
          <span className="text-sm tabular-nums font-medium text-amber-700 dark:text-amber-300">{r.openProblems}</span>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'changes',
      header: 'Changes',
      render: (r) =>
        r.openChanges > 0 ? (
          <span className="text-sm tabular-nums font-medium text-violet-700 dark:text-violet-300">{r.openChanges}</span>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'knownErrors',
      header: 'Known Errors',
      render: (r) =>
        r.knownErrors > 0 ? (
          <span className="text-sm tabular-nums font-medium text-orange-700 dark:text-orange-300">{r.knownErrors}</span>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
    {
      key: 'csat',
      header: 'CSAT',
      render: (r) =>
        r.csat != null ? (
          <span className="inline-flex items-center gap-1 text-sm tabular-nums">
            <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
            {r.csat}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'riskScore',
      header: 'Risk Score',
      render: (r) => {
        const tone =
          r.riskScore >= 60
            ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300'
            : r.riskScore >= 30
              ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300';
        return (
          <Badge variant="outline" className={`tabular-nums font-semibold ${tone}`}>
            {r.riskScore}
          </Badge>
        );
      },
    },
  ];

  const loading =
    servicesQ.isLoading ||
    slaQ.isLoading ||
    problemsQ.isLoading ||
    demandsQ.isLoading ||
    serviceHealthQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Owner — Command Center"
        description="What you see creates governance obligations. Every breach notification, accepted commitment, and customer signal is an accountability event that requires your response."
        icon={<Briefcase className="h-6 w-6" />}
        actions={
          <Badge variant="outline" className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <HeartPulse className="h-3 w-3" /> {services.length} owned services
          </Badge>
        }
      />

      {/* Top Action Strip — 9 clickable StatCards */}
      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
            <StatCard
              label="Owned Services"
              value={services.length}
              icon={<Briefcase className="h-4 w-4" />}
              hint="Services in your portfolio"
              tone="default"
              onClick={() => navigate('portfolio')}
            />
            <StatCard
              label="Active P1/P2 Incidents"
              value={p1p2Count}
              icon={<Activity className="h-4 w-4" />}
              hint={`${incidentsByPriority.P1} P1 · ${incidentsByPriority.P2} P2`}
              tone={incidentsByPriority.P1 > 0 ? 'danger' : p1p2Count > 0 ? 'warning' : 'success'}
              onClick={() => navigate('service-incidents')}
            />
            <StatCard
              label="SLA Breaches"
              value={openBreaches.length}
              icon={<ShieldAlert className="h-4 w-4" />}
              hint="Active breaches needing response"
              tone={openBreaches.length > 0 ? 'danger' : 'success'}
              onClick={() => navigate('sla')}
            />
            <StatCard
              label="SLA Warnings"
              value={openWarnings.length}
              icon={<TriangleAlert className="h-4 w-4" />}
              hint="Running clocks at risk"
              tone={openWarnings.length > 0 ? 'warning' : 'default'}
              onClick={() => navigate('sla')}
            />
            <StatCard
              label="Open Problems"
              value={problems.length}
              icon={<Bug className="h-4 w-4" />}
              hint={`${decisionNeeded.length} awaiting decision`}
              tone={problems.length > 0 ? 'warning' : 'default'}
              onClick={() => navigate('problems')}
            />
            <StatCard
              label="Known Errors"
              value={knownErrors.length}
              icon={<BookOpen className="h-4 w-4" />}
              hint="Workarounds in production"
              tone={knownErrors.length > 0 ? 'warning' : 'default'}
              onClick={() => navigate('problems')}
            />
            <StatCard
              label="Pending Governance"
              value={governanceDemands.length}
              icon={<Gavel className="h-4 w-4" />}
              hint="Commitments awaiting approval"
              tone={governanceDemands.length > 0 ? 'success' : 'default'}
              onClick={() => navigate('governance')}
            />
            <StatCard
              label="High-Risk Changes"
              value={highRiskChanges.length}
              icon={<GitBranch className="h-4 w-4" />}
              hint="Emergency / complex in-flight"
              tone={highRiskChanges.length > 0 ? 'danger' : 'default'}
              onClick={() => navigate('changes')}
            />
            <StatCard
              label="Low CSAT Reviews"
              value={lowCsatSurveys.length}
              icon={<Star className="h-4 w-4" />}
              hint="Surveys rated 1-2 ★"
              tone={lowCsatSurveys.length > 0 ? 'danger' : 'success'}
              onClick={() => navigate('portfolio')}
            />
          </div>

          {/* My Required Actions (PRIMARY) */}
          <SectionCard
            title="My Required Actions"
            description="Items where the Service Owner must act — breach responses, commitment approvals, catalog reviews, known-error reviews, post-implementation reviews, low-CSAT follow-ups, and problem decisions."
            actions={
              requiredActions.length > 0 ? (
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  <ListTodo className="h-3 w-3 mr-1" /> {requiredActions.length} open
                </Badge>
              ) : undefined
            }
          >
            {requiredActions.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
                title="No required actions"
                description="All governance obligations are met — no breach responses, commitment approvals, or catalog reviews are pending."
              />
            ) : (
              <ul className="divide-y -mx-2 max-h-[460px] overflow-y-auto scrollbar-thin">
                {requiredActions.map((a) => {
                  const meta = ACTION_LABELS[a.type];
                  return (
                    <li
                      key={a.id}
                      className="px-2 py-3 hover:bg-muted/30 rounded-md transition-colors"
                    >
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant="outline" className={`gap-1.5 ${meta.tone}`}>
                              {meta.icon} {meta.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              <RelativeTime date={a.age} /> · {a.service}
                            </span>
                            <Badge variant="outline" className={`text-[10px] ${riskTone(a.risk)}`}>
                              {a.risk}
                            </Badge>
                          </div>
                          <div className="text-sm font-medium text-foreground/90">{a.title}</div>
                          {a.customerImpact && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Impact: {a.customerImpact}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <Button size="sm" onClick={a.onAction} className="h-7 gap-1.5">
                            {a.actionLabel} <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* Service Health Heatmap */}
          <SectionCard
            title="Service Health Heatmap"
            description="Per-service portfolio health at a glance — SLA health, open P1/P2, problems, changes, known errors, CSAT, and a derived risk score. Click a row for full service detail."
            actions={
              <Button variant="ghost" size="sm" onClick={() => navigate('portfolio')} className="gap-1">
                Open portfolio <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {serviceHealthQ.isLoading ? (
              <LoadingState rows={4} />
            ) : heatmapRows.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-7 w-7" />}
                title="No service health data"
                description="Owned services will appear here once the service-health aggregator runs."
              />
            ) : (
              <DataTable
                columns={heatmapColumns}
                rows={heatmapRows}
                onRowClick={(r) => navigate('service-detail', { id: r.id })}
                empty="No services."
              />
            )}
          </SectionCard>

          {/* Two-column: Customer Impact Feed + Governance History */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Customer Impact Feed"
              description="Impacted customers across your portfolio — active incidents, breach counts, and CSAT signals."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('portfolio')} className="gap-1">
                  Details <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {customerImpactQ.isLoading ? (
                <LoadingState rows={3} />
              ) : (customerImpactQ.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<Megaphone className="h-7 w-7" />}
                  title="No customer impact data"
                  description="Customers consuming your services will appear here."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-80 overflow-y-auto scrollbar-thin">
                  {(customerImpactQ.data ?? []).map((c) => {
                    const toneCls =
                      c.activeBreaches > 0
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : c.p1p2Tickets > 0
                          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
                    return (
                      <li
                        key={c.customerId}
                        className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{c.customerName}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                              <span>{c.activeTickets} active tickets</span>
                              <span>·</span>
                              <span>{c.p1p2Tickets} P1/P2</span>
                              {c.activeBreaches > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                                    {c.activeBreaches} breach{c.activeBreaches > 1 ? 'es' : ''}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {c.averageCsat != null && (
                              <span className="inline-flex items-center gap-1 text-xs">
                                <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                                {c.averageCsat}
                              </span>
                            )}
                            <Badge variant="outline" className={`text-[10px] ${toneCls}`}>
                              {c.activeBreaches > 0 ? 'breach' : c.p1p2Tickets > 0 ? 'risk' : 'ok'}
                            </Badge>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Governance History"
              description="Your last 10 recorded governance decisions — commitment approvals, escalations, breach responses, lifecycle directions, and catalog accuracy attestations."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('governance')} className="gap-1">
                  Open governance <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {(ownerDecisionsQ.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<History className="h-7 w-7" />}
                  title="No governance decisions recorded yet"
                  description="Your commitment approvals, escalations, and breach responses will appear here."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-80 overflow-y-auto scrollbar-thin">
                  {(ownerDecisionsQ.data ?? []).map((dec) => (
                    <li key={dec.id} className="px-2 py-2.5">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">
                              {DECISION_TYPE_LABELS[dec.decisionType] ?? dec.decisionType}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              on <span className="font-medium text-foreground/80">{serviceName(dec.serviceId)}</span>
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-foreground/80 line-clamp-2">
                            {dec.rationale}
                          </p>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {dec.decision.replace(/_/g, ' ').toLowerCase()} · {dec.decidedByName} · <RelativeTime date={dec.createdAt} />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Breach notifications → governance responses */}
          <SectionCard
            title="Breach Notifications → Governance Responses"
            description="Each unresolved breach on your services is listed here — record a governance response to close the accountability loop."
            actions={
              <Button variant="outline" size="sm" onClick={() => navigate('sla')}>
                Open SLA view <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            }
          >
            {openBreaches.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-8 w-8" />}
                title="No active breaches on your services"
                description="All SLA commitments within target. Continue monitoring warnings."
              />
            ) : (
              <div className="space-y-2.5">
                {openBreaches.slice(0, 5).map((b) => {
                  const responded = respondedBreachEventIds.has(b.id);
                  return (
                    <Alert
                      key={b.id}
                      variant="destructive"
                      className={
                        responded
                          ? 'border-emerald-300 dark:border-emerald-900/70 bg-emerald-50/40 dark:bg-emerald-950/20'
                          : 'border-rose-300 dark:border-rose-900/70 bg-rose-50/60 dark:bg-rose-950/30'
                      }
                    >
                      {responded ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      )}
                      <AlertTitle
                        className={
                          responded
                            ? 'flex flex-wrap items-center gap-2 text-emerald-800 dark:text-emerald-300'
                            : 'flex flex-wrap items-center gap-2 text-rose-800 dark:text-rose-300'
                        }
                      >
                        <span className="font-semibold">{serviceName(b.serviceId)}</span>
                        <span
                          className={
                            responded
                              ? 'text-xs font-normal text-emerald-600/80 dark:text-emerald-400/80'
                              : 'text-xs font-normal text-rose-600/80 dark:text-rose-400/80'
                          }
                        >
                          {responded ? 'response recorded' : 'breached'} <RelativeTime date={b.createdAt} />
                        </span>
                        {responded && (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            Governance response recorded
                          </Badge>
                        )}
                      </AlertTitle>
                      <AlertDescription
                        className={
                          responded
                            ? 'text-emerald-900/80 dark:text-emerald-200/80'
                            : 'text-rose-900/80 dark:text-rose-200/80'
                        }
                      >
                        {b.message}
                        <div className="mt-2">
                          {responded ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                              onClick={() => navigate('governance')}
                            >
                              View governance history <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
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
                              <GavelIcon className="h-3 w-3" /> Review &amp; Respond
                            </Button>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Breach response dialog */}
      <BreachResponseDialog
        open={!!breachTarget}
        onOpenChange={(v) => !v && setBreachTarget(null)}
        serviceName={breachTarget?.serviceName ?? ''}
        breachMessage={breachTarget?.message ?? ''}
        breachDate={breachTarget?.createdAt ?? ''}
        pending={breachResponseMutation.isPending}
        onConfirm={(decision, rationale, resourcesAuthorized) => {
          if (!breachTarget) return;
          breachResponseMutation.mutate({
            serviceId: breachTarget.serviceId,
            slaEventId: breachTarget.eventId,
            decision,
            rationale,
            resourcesAuthorized,
          });
        }}
      />
    </div>
  );
}
