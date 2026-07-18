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
  RelativeTime,
  FormattedDate,
  Button,
  Badge,
} from '@/components/shared';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
  TrendingUp,
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

/* --------------------- Inline helpers --------------------- */

function PriorityDot({ priority }: { priority: string }) {
  const cls =
    priority === 'P1'
      ? 'bg-rose-500'
      : priority === 'P2'
        ? 'bg-amber-500'
        : priority === 'P3'
          ? 'bg-teal-500'
          : 'bg-sky-500';
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${cls}`}
      title={priority}
      aria-label={`Priority ${priority}`}
    />
  );
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

type BreachDecision = 'REMEDIATION_AUTHORIZED' | 'RESOURCES_AUTHORIZED' | 'EMERGENCY_CHANGE_DIRECTED';

const BREACH_DECISION_LABELS: Record<BreachDecision, string> = {
  REMEDIATION_AUTHORIZED: 'Remediation Authorized',
  RESOURCES_AUTHORIZED: 'Resources Authorized',
  EMERGENCY_CHANGE_DIRECTED: 'Emergency Change Directed',
};

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
            Record your governance response to this SLA breach on <span className="font-medium">{serviceName}</span>. The decision is persisted to the audit trail and CM Leaders are notified.
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

/* --------------------- Main --------------------- */

export default function Dashboard() {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();
  const demandsQ = useAcceptedDemands();
  const changesQ = useAllChanges();

  // Operational stats from the new split endpoints.
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

  // Open tickets on services owned by this Service Owner (server enforces
  // the owned-service scope based on the caller's id). Full ticket shape so
  // we can group by priority for the "Incidents on My Services" panel.
  const openTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'owner-dashboard', 'open'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER',
      ),
    staleTime: 30_000,
  });
  const openTicketCount = openTicketsQ.data?.length ?? 0;

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

  // Demands awaiting commitment approval on MY services
  const governanceDemands = useMemo(
    () =>
      (demandsQ.data ?? []).filter((d) => d.relatedServiceIds.some((sid) => myServiceIds.has(sid))),
    [demandsQ.data, myServiceIds],
  );

  // Changes touching my services (open status only).
  const changesTouchingMyServices = useMemo(() => {
    const all = changesQ.data ?? [];
    return all.filter(
      (c) =>
        c.status !== 'CLOSED' &&
        c.status !== 'REJECTED' &&
        c.affectedServiceIds.some((sid) => myServiceIds.has(sid)),
    );
  }, [changesQ.data, myServiceIds]);

  // Incidents on my services grouped by priority.
  const incidentsByPriority = useMemo(() => {
    const counts: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const t of openTicketsQ.data ?? []) {
      const p = (t.priority ?? 'P4').toUpperCase();
      if (p in counts) counts[p] += 1;
    }
    return counts;
  }, [openTicketsQ.data]);

  // SLA breaches by service — from the new /api/stats/sla endpoint, scoped
  // to owned services.
  const slaBreachesByService = useMemo(() => {
    return (slaStatsQ.data?.byService ?? [])
      .filter((s) => myServiceIds.has(s.serviceId))
      .filter((s) => s.breaches > 0 || s.warnings > 0)
      .sort((a, b) => b.breaches - a.breaches || b.warnings - a.warnings);
  }, [slaStatsQ.data, myServiceIds]);

  // Customer sentiment — from /api/stats/customer-health, scoped to
  // customers consuming my services.
  const customerSentiment = customerHealthQ.data?.byCustomer ?? [];

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';

  /* --- Governance decisions for breach responses (per service) --- */
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

  // Set of slaEventIds that already have a BREACH_RESPONSE decision recorded
  const respondedBreachEventIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of breachDecisionsQ.data ?? []) {
      if (d.slaEventId) s.add(d.slaEventId);
    }
    return s;
  }, [breachDecisionsQ.data]);

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

  const loading =
    servicesQ.isLoading || slaQ.isLoading || problemsQ.isLoading || demandsQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Owner — Accountability Dashboard"
        description="What you see creates governance obligations. Breach notifications and accepted commitments are accountability events that require your response."
        icon={<Briefcase className="h-6 w-6" />}
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {/* Top stat cards — operational view */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Incidents on My Services"
              value={openTicketCount}
              icon={<Activity className="h-4 w-4" />}
              hint={`${incidentsByPriority.P1} P1 · ${incidentsByPriority.P2} P2`}
              tone={incidentsByPriority.P1 > 0 ? 'danger' : openTicketCount > 0 ? 'warning' : 'default'}
              onClick={() => navigate('tickets')}
            />
            <StatCard
              label="SLA Breaches by Service"
              value={slaBreachesByService.length}
              icon={<ShieldAlert className="h-4 w-4" />}
              hint="Services with active breaches or warnings"
              tone={slaBreachesByService.length > 0 ? 'danger' : 'success'}
              onClick={() => navigate('sla')}
            />
            <StatCard
              label="Open Problems"
              value={problems.length}
              icon={<Bug className="h-4 w-4" />}
              hint="Under investigation on your services"
              tone={problems.length > 0 ? 'warning' : 'default'}
              onClick={() => navigate('problems')}
            />
            <StatCard
              label="Changes Touching My Services"
              value={changesTouchingMyServices.length}
              icon={<GitBranch className="h-4 w-4" />}
              hint="In-flight changes affecting your portfolio"
              tone={changesTouchingMyServices.length > 0 ? 'warning' : 'default'}
              onClick={() => navigate('changes')}
            />
            <StatCard
              label="Customer Sentiment"
              value={
                customerSentiment.length > 0
                  ? `${customerSentiment.filter((c) => c.health === 'green').length}/${customerSentiment.length} green`
                  : '—'
              }
              icon={<Star className="h-4 w-4" />}
              hint="Customer health scorecards for your services"
              tone="default"
            />
            <StatCard
              label="Governance Approvals"
              value={governanceDemands.length}
              icon={<Gavel className="h-4 w-4" />}
              tone="success"
              hint="Accepted demands awaiting commitment"
              onClick={() => navigate('governance')}
            />
          </div>

          {/* Incidents on My Services + SLA Breaches by Service */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Incidents on My Services"
              description="Open tickets on services you own, grouped by priority. P1s demand your immediate attention."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('tickets')} className="gap-1">
                  Open queue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {/* Priority buckets */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {([
                  { key: 'P1', tone: 'rose' },
                  { key: 'P2', tone: 'amber' },
                  { key: 'P3', tone: 'teal' },
                  { key: 'P4', tone: 'sky' },
                ] as const).map((b) => {
                  const cls = {
                    rose: 'border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
                    amber: 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
                    teal: 'border-teal-200 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300',
                    sky: 'border-sky-200 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300',
                  }[b.tone];
                  return (
                    <div key={b.key} className={`rounded-md border p-2 text-center ${cls}`}>
                      <div className="text-lg font-semibold tabular-nums">{incidentsByPriority[b.key]}</div>
                      <div className="text-[10px] uppercase tracking-wide opacity-80">{b.key}</div>
                    </div>
                  );
                })}
              </div>

              {(openTicketsQ.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-7 w-7 text-emerald-500" />}
                  title="No open incidents"
                  description="No tickets are currently open on your services."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-80 overflow-y-auto scrollbar-thin">
                  {(openTicketsQ.data ?? [])
                    .slice()
                    .sort((a, b) => {
                      const order: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
                      return (
                        (order[a.priority] ?? 4) - (order[b.priority] ?? 4) ||
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                      );
                    })
                    .slice(0, 8)
                    .map((t) => (
                      <li
                        key={t.id}
                        className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors cursor-pointer"
                        onClick={() => navigate('ticket-detail', { id: t.id })}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">{t.number}</span>
                              <PriorityDot priority={t.priority} />
                              <span className="text-sm font-medium truncate">{t.title}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground truncate">
                              {t.serviceName ?? serviceName(t.serviceId ?? '')} · {t.serviceCustomerName ?? '—'}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {t.status.replace(/_/g, ' ').toLowerCase()}
                          </Badge>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="SLA Breaches by Service"
              description="Per-service breach and warning counts on your owned services."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('sla')} className="gap-1">
                  Open SLA <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {slaStatsQ.isLoading ? (
                <LoadingState rows={3} />
              ) : slaBreachesByService.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-7 w-7 text-emerald-500" />}
                  title="No active breaches or warnings"
                  description="All SLA commitments on your services are within target."
                />
              ) : (
                <ul className="divide-y -mx-2 max-h-80 overflow-y-auto scrollbar-thin">
                  {slaBreachesByService.map((s) => (
                    <li
                      key={s.serviceId}
                      className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors cursor-pointer"
                      onClick={() => navigate('sla')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{s.serviceName}</span>
                            <SlaClassBadge slaClass={s.slaClass as 'A' | 'B' | 'C' | 'D'} />
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {s.breaches > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">
                                {s.breaches} breach{s.breaches > 1 ? 'es' : ''}
                              </span>
                            )}
                            {s.breaches > 0 && s.warnings > 0 && <span> · </span>}
                            {s.warnings > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                {s.warnings} warning{s.warnings > 1 ? 's' : ''}
                              </span>
                            )}
                            {s.compliancePct != null && (
                              <span className="ml-2 text-muted-foreground/80">
                                · {s.compliancePct}% compliance
                              </span>
                            )}
                          </div>
                        </div>
                        <SlaHealthBadge health={s.breaches > 0 ? 'red' : 'amber'} />
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
            description="A breach notification is an accountability event that requires your response. Each unresolved breach on your services is listed here — record a governance response to close the accountability loop."
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
                {openBreaches.map((b) => {
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

          {/* Two-column: portfolio snapshot + governance approvals */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Service Portfolio Snapshot"
              description="Current health of services under your ownership."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('portfolio')}>
                  All services <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {services.length === 0 ? (
                <EmptyState
                  icon={<Briefcase className="h-7 w-7" />}
                  title="No services in your portfolio"
                  description="Services you own will appear here."
                />
              ) : (
                <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
                  {services.map((s) => {
                    const sEvents = mySlaEvents.filter((e) => e.serviceId === s.id);
                    const health = deriveHealth(sEvents);
                    const openIncidents = sEvents.filter(
                      (e) => !e.resolvedAt && (e.eventType === 'BREACHED' || e.eventType === 'WARNING'),
                    ).length;
                    return (
                      <li
                        key={s.id}
                        className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                        onClick={() => navigate('portfolio')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{s.name}</span>
                            <SlaClassBadge slaClass={s.slaClass} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {s.chapter} · {s.layer}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {openIncidents > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 font-medium">
                              <Activity className="h-3 w-3" /> {openIncidents}
                            </span>
                          )}
                          <SlaHealthBadge health={health} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Pending Governance Approvals"
              description="Accepted demands on your services — service commitments requiring your approval."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('governance')}>
                  Open <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {governanceDemands.length === 0 ? (
                <EmptyState
                  icon={<Gavel className="h-7 w-7" />}
                  title="No commitments awaiting approval"
                  description="When a demand on your service is accepted, you approve the service commitment here."
                />
              ) : (
                <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
                  {governanceDemands.map((d) => (
                    <li
                      key={d.id}
                      className="py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                      onClick={() => navigate('demand-detail', { id: d.id })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{d.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {d.serviceCustomerName} · SCM: {d.assignedScmWorkerName ?? 'Unassigned'}
                          </div>
                          {d.commitmentNotes && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                              “{d.commitmentNotes}”
                            </p>
                          )}
                        </div>
                        <DemandStatusBadge status={d.status} className="shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Two-column: open problems + known errors */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              className="lg:col-span-2"
              title="Open Problems on Your Services"
              description="When Problem Management investigates a recurring failure, that context feeds your SLA governance communication."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('problems')}>
                  All problems <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {problems.length === 0 ? (
                <EmptyState
                  icon={<Bug className="h-7 w-7" />}
                  title="No open problem records"
                  description="Active problems on your services will be listed here."
                />
              ) : (
                <ul className="divide-y">
                  {problems.map((p) => (
                    <li
                      key={p.id}
                      className="py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                      onClick={() => navigate('problems')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{p.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {p.serviceName ?? serviceName(p.serviceId)} · {p.status.replace(/_/g, ' ').toLowerCase()}
                          </div>
                          {p.rootCauseDescription && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              Root cause: {p.rootCauseDescription}
                            </p>
                          )}
                        </div>
                        <RelativeTime date={p.createdAt} className="text-xs text-muted-foreground shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Active Known Errors"
              description="Problems with documented workarounds awaiting permanent fix."
            >
              {knownErrors.length === 0 ? (
                <EmptyState
                  icon={<BookOpen className="h-7 w-7" />}
                  title="No active known errors"
                  description="Known errors for your services will surface here with workaround context."
                />
              ) : (
                <ul className="space-y-2.5">
                  {knownErrors.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                          Known Error
                        </span>
                      </div>
                      <div className="text-sm font-medium mt-1.5">{p.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.serviceName ?? serviceName(p.serviceId)}
                      </div>
                      {p.workaroundDescription && (
                        <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed">
                          <span className="font-medium">Workaround:</span> {p.workaroundDescription}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 pt-3 border-t">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <p className="leading-relaxed">
                    Known errors stay visible to your customers through the SCM communications
                    thread. Ensure workarounds are accurate before publication.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Customer Sentiment panel */}
          <SectionCard
            title="Customer Sentiment"
            description="Per-customer health scorecard across your owned services. Green ≥80 · Amber 60-80 · Red <60."
            actions={
              <Button variant="ghost" size="sm" onClick={() => navigate('portfolio')} className="gap-1">
                Open portfolio <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {customerHealthQ.isLoading ? (
              <LoadingState rows={3} />
            ) : customerSentiment.length === 0 ? (
              <EmptyState
                icon={<Star className="h-8 w-8" />}
                title="No customer sentiment data"
                description="Customers consuming your services will appear here once they raise tickets or demands."
              />
            ) : (
              <ul className="divide-y -mx-2 max-h-96 overflow-y-auto scrollbar-thin">
                {customerSentiment.map((c) => {
                  const toneCls =
                    c.health === 'green'
                      ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : c.health === 'amber'
                        ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                        : 'border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300';
                  return (
                    <li
                      key={c.orgNodeId}
                      className="px-2 py-2.5 hover:bg-muted/30 rounded-md transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.orgNodeName}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                            <span>{c.openTickets} open tickets</span>
                            <span>·</span>
                            <span>{c.activeDemands} active demands</span>
                            {c.slaBreaches > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-rose-600 dark:text-rose-400 font-medium">
                                  {c.slaBreaches} breach{c.slaBreaches > 1 ? 'es' : ''}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {c.avgCsat != null && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                              {c.avgCsat}
                            </span>
                          )}
                          <Badge variant="outline" className={`text-[10px] ${toneCls}`}>
                            {c.healthScore}
                          </Badge>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
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
