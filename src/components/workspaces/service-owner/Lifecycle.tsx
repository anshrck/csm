'use client';

/**
 * Service Owner — Service Lifecycle view.
 *
 * Kanban-style board with 5 lifecycle columns: PLANNED, ACTIVE, UNDER_REVIEW,
 * RETIREMENT_CANDIDATE, RETIRED. Each service is rendered as a card under its
 * lifecycleStage column.
 *
 * Card content: name, SLA class, customer count (entitlements), ticket trend
 * (up/down/flat), problem count, CSAT, last catalog review, next review due.
 *
 * Actions per card:
 *   - Request catalog update (toast + navigate to portfolio)
 *   - Mark reviewed (PATCH service lastReviewedAt = now)
 *   - Propose retirement (PATCH lifecycleStage = RETIREMENT_CANDIDATE + governance
 *     decision LIFECYCLE_DIRECTION)
 *   - Set replacement guidance (toast + INTERNAL_NOTE communication)
 *   - Record lifecycle direction (POST governance decision LIFECYCLE_DIRECTION)
 *
 * Data: GET /api/services?owner=me (grouped by lifecycleStage client-side).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Service } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  Badge,
  Button,
  RelativeTime,
  FormattedDate,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Briefcase,
  Users,
  Bug,
  Star,
  Calendar,
  ArrowRightCircle,
  Flag,
  Compass,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useOwnerServices } from './_hooks';

// ---- Lifecycle column definitions ----

const LIFECYCLE_COLUMNS: {
  key: string;
  label: string;
  description: string;
  accent: string;
  dot: string;
}[] = [
  {
    key: 'PLANNED',
    label: 'Planned',
    description: 'Approved for build; not yet operating.',
    accent: 'border-sky-300 dark:border-sky-800',
    dot: 'bg-sky-500',
  },
  {
    key: 'ACTIVE',
    label: 'Active',
    description: 'Operating in production with active entitlements.',
    accent: 'border-emerald-300 dark:border-emerald-800',
    dot: 'bg-emerald-500',
  },
  {
    key: 'UNDER_REVIEW',
    label: 'Under Review',
    description: 'Catalog accuracy or viability being evaluated.',
    accent: 'border-amber-300 dark:border-amber-800',
    dot: 'bg-amber-500',
  },
  {
    key: 'RETIREMENT_CANDIDATE',
    label: 'Retirement Candidate',
    description: 'Proposed for retirement; replacement guidance required.',
    accent: 'border-orange-300 dark:border-orange-800',
    dot: 'bg-orange-500',
  },
  {
    key: 'RETIRED',
    label: 'Retired',
    description: 'No longer operating; entitlements withdrawn.',
    accent: 'border-rose-300 dark:border-rose-800',
    dot: 'bg-rose-500',
  },
];

const REVIEW_STALE_DAYS = 90;

function isReviewStale(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > REVIEW_STALE_DAYS * 86400000;
}

// ---- Auxiliary data interfaces ----

interface ServiceStats {
  serviceId: string;
  customerCount: number;
  openTickets: number;
  ticketTrend: 'up' | 'down' | 'flat';
  problemCount: number;
  csat: number | null;
}

// ---- Component ----

export default function Lifecycle() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();

  // Auxiliary stats per service: customers, tickets (with trend), problems, CSAT.
  // We piggy-back on /api/service-owner/service-health which already aggregates
  // most of this, then enrich with customer counts from entitlements.
  const healthQ = useQuery<{
    serviceId: string;
    openIncidents: number;
    p1p2Count: number;
    problems: number;
    csat: number | null;
  }[]>({
    queryKey: ['service-owner', 'service-health', 'lifecycle'],
    queryFn: () => apiGet('/api/service-owner/service-health'),
    staleTime: 30_000,
  });

  // Tickets per service for last 14 days vs prior 14 days → trend.
  const ticketsTrendQ = useQuery<{ serviceId: string; current: number; previous: number }[]>({
    queryKey: ['tickets', 'lifecycle-trend'],
    queryFn: async () => {
      const all = await apiGet<{ id: string; serviceId: string; createdAt: string; status: string }[]>(
        '/api/tickets?status=ALL',
      );
      const now = Date.now();
      const fourteenDaysAgo = now - 14 * 86400000;
      const twentyEightDaysAgo = now - 28 * 86400000;
      const byService = new Map<string, { current: number; previous: number }>();
      for (const t of all) {
        const created = new Date(t.createdAt).getTime();
        const entry = byService.get(t.serviceId) ?? { current: 0, previous: 0 };
        if (created >= fourteenDaysAgo) entry.current++;
        else if (created >= twentyEightDaysAgo) entry.previous++;
        byService.set(t.serviceId, entry);
      }
      return Array.from(byService.entries()).map(([serviceId, v]) => ({ serviceId, ...v }));
    },
    staleTime: 60_000,
  });

  // Entitlements → derive customer counts per service.
  const entitlementsQ = useQuery<{ serviceId: string; customerCount: number }[]>({
    queryKey: ['entitlements', 'lifecycle-summary'],
    queryFn: async () => {
      // We use /api/services?owner=me to get offerings[] then call
      // /api/entitlements to count customers per offering. The simplest path
      // is to fetch all services and use offerings count as a proxy for
      // customer count when entitlements aren't directly enumerable per service.
      // Here we fetch entitlements for the owned services via offerings.
      const services = await apiGet<Service[]>('/api/services?owner=me');
      const offerings = services.flatMap((s) => s.offerings ?? []);
      // We can't enumerate entitlements per service without a customer session,
      // so we approximate: 1 customer per offering (the typical case is one
      // customer per offering in this demo).
      const byService = new Map<string, number>();
      for (const o of offerings) {
        byService.set(o.serviceId, (byService.get(o.serviceId) ?? 0) + 1);
      }
      return Array.from(byService.entries()).map(([serviceId, customerCount]) => ({
        serviceId,
        customerCount,
      }));
    },
    staleTime: 60_000,
  });

  const services = servicesQ.data ?? [];
  const health = healthQ.data ?? [];
  const trends = ticketsTrendQ.data ?? [];
  const entitlements = entitlementsQ.data ?? [];

  // ---- Group services by lifecycleStage ----
  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const col of LIFECYCLE_COLUMNS) map.set(col.key, []);
    for (const s of services) {
      const stage = s.lifecycleStage ?? (s.status === 'RETIRED' ? 'RETIRED' : 'ACTIVE');
      const list = map.get(stage) ?? map.get('ACTIVE')!;
      list.push(s);
    }
    return map;
  }, [services]);

  const statsFor = (serviceId: string): ServiceStats => {
    const h = health.find((x) => x.serviceId === serviceId);
    const t = trends.find((x) => x.serviceId === serviceId);
    const e = entitlements.find((x) => x.serviceId === serviceId);
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (t) {
      if (t.current > t.previous) trend = 'up';
      else if (t.current < t.previous) trend = 'down';
    }
    return {
      serviceId,
      customerCount: e?.customerCount ?? 0,
      openTickets: h?.openIncidents ?? 0,
      ticketTrend: trend,
      problemCount: h?.problems ?? 0,
      csat: h?.csat ?? null,
    };
  };

  // ---- Mutations ----
  const markReviewedMut = useMutation({
    mutationFn: (service: Service) => apiPatch(`/api/services/${service.id}`, { lastReviewedAt: true }),
    onSuccess: (_data, service) => {
      toast.success('Catalog review recorded', {
        description: `"${service.name}" marked reviewed ${new Date().toLocaleDateString()}.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-services'] });
      qc.invalidateQueries({ queryKey: ['service-owner', 'service-health'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeRetirementMut = useMutation({
    mutationFn: async (service: Service) => {
      await apiPatch(`/api/services/${service.id}`, { lifecycleStage: 'RETIREMENT_CANDIDATE' });
      await apiPost('/api/governance-decisions', {
        serviceId: service.id,
        decisionType: 'LIFECYCLE_DIRECTION',
        decision: 'APPROVED',
        rationale: `Service "${service.name}" proposed for retirement. Moving to RETIREMENT_CANDIDATE lifecycle stage pending replacement guidance.`,
      });
    },
    onSuccess: (_data, service) => {
      toast.info('Retirement proposed', {
        description: `"${service.name}" moved to Retirement Candidate. Governance decision recorded.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-services'] });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveStageMut = useMutation({
    mutationFn: (args: { service: Service; stage: string }) =>
      apiPatch(`/api/services/${args.service.id}`, { lifecycleStage: args.stage }),
    onSuccess: (_data, args) => {
      toast.success('Lifecycle stage updated', {
        description: `"${args.service.name}" → ${args.stage}.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-services'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Direction dialog (records a LIFECYCLE_DIRECTION governance decision) ----
  const [directionTarget, setDirectionTarget] = useState<Service | null>(null);
  const [directionRationale, setDirectionRationale] = useState('');
  const [directionDecision, setDirectionDecision] = useState<'APPROVED' | 'ESCALATED' | 'REJECTED'>('APPROVED');

  const recordDirectionMut = useMutation({
    mutationFn: (args: { service: Service; rationale: string; decision: 'APPROVED' | 'ESCALATED' | 'REJECTED' }) =>
      apiPost('/api/governance-decisions', {
        serviceId: args.service.id,
        decisionType: 'LIFECYCLE_DIRECTION',
        decision: args.decision,
        rationale: args.rationale,
      }),
    onSuccess: (_data, args) => {
      toast.success('Lifecycle direction recorded', {
        description: `Governance decision for "${args.service.name}" persisted.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      setDirectionTarget(null);
      setDirectionRationale('');
      setDirectionDecision('APPROVED');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Replacement guidance dialog (records an INTERNAL_NOTE communication) ----
  const [replacementTarget, setReplacementTarget] = useState<Service | null>(null);
  const [replacementText, setReplacementText] = useState('');

  const recordReplacementMut = useMutation({
    mutationFn: (args: { service: Service; guidance: string }) =>
      apiPost('/api/communications', {
        serviceId: args.service.id,
        direction: 'INTERNAL_NOTE',
        channel: 'PORTAL',
        subject: `Replacement guidance for "${args.service.name}"`,
        body: args.guidance,
      }),
    onSuccess: (_data, args) => {
      toast.success('Replacement guidance recorded', {
        description: `Internal note for "${args.service.name}".`,
      });
      qc.invalidateQueries({ queryKey: ['communications'] });
      setReplacementTarget(null);
      setReplacementText('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = servicesQ.isLoading;

  // ---- Summary ----
  const summary = useMemo(() => {
    const total = services.length;
    const active = grouped.get('ACTIVE')?.length ?? 0;
    const underReview = grouped.get('UNDER_REVIEW')?.length ?? 0;
    const retirementCandidate = grouped.get('RETIREMENT_CANDIDATE')?.length ?? 0;
    const staleReviews = services.filter((s) => isReviewStale(s.lastReviewedAt)).length;
    return { total, active, underReview, retirementCandidate, staleReviews };
  }, [services, grouped]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Lifecycle"
        description="Kanban view of every service you own, grouped by lifecycle stage. Each card surfaces the operational signals you need to decide whether a service stays Active, moves Under Review, becomes a Retirement Candidate, or is Retired."
        icon={<RefreshCw className="h-6 w-6" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Owned Services" value={summary.total} hint="All stages" />
        <StatCard label="Active" value={summary.active} tone="success" />
        <StatCard label="Under Review" value={summary.underReview} tone="warning" />
        <StatCard label="Retirement Candidate" value={summary.retirementCandidate} tone="danger" />
        <StatCard
          label="Stale Catalog Review"
          value={summary.staleReviews}
          tone="warning"
          hint={`> ${REVIEW_STALE_DAYS} days`}
        />
      </div>

      {loading ? (
        <LoadingState rows={5} />
      ) : services.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Briefcase className="h-8 w-8" />}
            title="No services owned"
            description="You don't currently own any services. Once you do, they will appear here grouped by lifecycle stage."
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {LIFECYCLE_COLUMNS.map((col) => {
            const colServices = grouped.get(col.key) ?? [];
            return (
              <div
                key={col.key}
                className={cn(
                  'rounded-lg border-2 border-t-4 bg-card flex flex-col min-h-[20rem]',
                  col.accent,
                )}
              >
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', col.dot)} />
                      <h3 className="text-sm font-semibold">{col.label}</h3>
                    </div>
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      {colServices.length}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{col.description}</p>
                </div>
                <div className="flex-1 p-2 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
                  {colServices.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground italic text-center py-8">
                      No services in this stage.
                    </div>
                  ) : (
                    colServices.map((s) => (
                      <ServiceLifecycleCard
                        key={s.id}
                        service={s}
                        stats={statsFor(s.id)}
                        onMarkReviewed={() => markReviewedMut.mutate(s)}
                        onProposeRetirement={() => proposeRetirementMut.mutate(s)}
                        onRecordDirection={() => {
                          setDirectionTarget(s);
                          setDirectionRationale('');
                          setDirectionDecision('APPROVED');
                        }}
                        onSetReplacementGuidance={() => {
                          setReplacementTarget(s);
                          setReplacementText('');
                        }}
                        onRequestCatalogUpdate={() => {
                          toast.info('Catalog update requested', {
                            description: `Navigating to "${s.name}" portfolio entry to review catalog accuracy.`,
                          });
                          navigate('portfolio');
                        }}
                        onMoveStage={(stage) => moveStageMut.mutate({ service: s, stage })}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lifecycle direction dialog */}
      <Dialog open={!!directionTarget} onOpenChange={(o) => !o && setDirectionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Lifecycle Direction</DialogTitle>
            <DialogDescription>
              {directionTarget?.name}
              <br />
              Persist a governance decision documenting the lifecycle direction you are setting for this service. The decision is recorded in the audit trail and notified to CM Leader.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="direction-decision" className="text-xs">Decision</Label>
              <Select value={directionDecision} onValueChange={(v) => setDirectionDecision(v as 'APPROVED' | 'ESCALATED' | 'REJECTED')}>
                <SelectTrigger id="direction-decision" className="mt-1 h-9 text-sm">
                  <SelectValue placeholder="Decision" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">APPROVED — proceed with direction</SelectItem>
                  <SelectItem value="ESCALATED">ESCALATED — defer to Governance Owner</SelectItem>
                  <SelectItem value="REJECTED">REJECTED — reverse direction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="direction-rationale" className="text-xs">Rationale (required)</Label>
              <Textarea
                id="direction-rationale"
                value={directionRationale}
                onChange={(e) => setDirectionRationale(e.target.value)}
                placeholder="Describe the rationale for this lifecycle direction. Reference operational signals, customer demand, or strategic alignment."
                className="mt-1 min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDirectionTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (directionTarget && directionRationale.trim()) {
                  recordDirectionMut.mutate({
                    service: directionTarget,
                    rationale: directionRationale,
                    decision: directionDecision,
                  });
                }
              }}
              disabled={recordDirectionMut.isPending || !directionRationale.trim()}
            >
              <Compass className="h-3.5 w-3.5 mr-1" /> Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replacement guidance dialog */}
      <Dialog open={!!replacementTarget} onOpenChange={(o) => !o && setReplacementTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Replacement Guidance</DialogTitle>
            <DialogDescription>
              {replacementTarget?.name}
              <br />
              Document the replacement strategy for this service. The note is recorded as an internal communication visible to CM Leader and SCM workers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="replacement-text" className="text-xs">Replacement guidance</Label>
              <Textarea
                id="replacement-text"
                value={replacementText}
                onChange={(e) => setReplacementText(e.target.value)}
                placeholder="Describe the replacement service, migration path, timeline, and customer communication plan."
                className="mt-1 min-h-[120px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReplacementTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (replacementTarget && replacementText.trim()) {
                  recordReplacementMut.mutate({ service: replacementTarget, guidance: replacementText });
                }
              }}
              disabled={recordReplacementMut.isPending || !replacementText.trim()}
            >
              <ArrowRightCircle className="h-3.5 w-3.5 mr-1" /> Save guidance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Service lifecycle card ----

interface ServiceLifecycleCardProps {
  service: Service;
  stats: ServiceStats;
  onMarkReviewed: () => void;
  onProposeRetirement: () => void;
  onRecordDirection: () => void;
  onSetReplacementGuidance: () => void;
  onRequestCatalogUpdate: () => void;
  onMoveStage: (stage: string) => void;
}

function ServiceLifecycleCard({
  service,
  stats,
  onMarkReviewed,
  onProposeRetirement,
  onRecordDirection,
  onSetReplacementGuidance,
  onRequestCatalogUpdate,
  onMoveStage,
}: ServiceLifecycleCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const stale = isReviewStale(service.lastReviewedAt);

  return (
    <div className="rounded-md border bg-background p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onRequestCatalogUpdate}
          className="text-left min-w-0 flex-1"
        >
          <h4 className="text-sm font-semibold truncate hover:underline">{service.name}</h4>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{service.description}</p>
        </button>
        <Badge variant="outline" className="text-[10px] shrink-0">
          Class {service.slaClass}
        </Badge>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-1 mt-2.5 text-[11px]">
        <div className="rounded bg-muted/40 px-1.5 py-1 flex flex-col items-center">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="font-semibold tabular-nums mt-0.5">{stats.customerCount}</span>
          <span className="text-[9px] text-muted-foreground">cust.</span>
        </div>
        <div className="rounded bg-muted/40 px-1.5 py-1 flex flex-col items-center">
          <TrendIcon trend={stats.ticketTrend} />
          <span className="font-semibold tabular-nums mt-0.5">{stats.openTickets}</span>
          <span className="text-[9px] text-muted-foreground">tickets</span>
        </div>
        <div className="rounded bg-muted/40 px-1.5 py-1 flex flex-col items-center">
          <Bug className="h-3 w-3 text-muted-foreground" />
          <span className="font-semibold tabular-nums mt-0.5">{stats.problemCount}</span>
          <span className="text-[9px] text-muted-foreground">probs.</span>
        </div>
        <div className="rounded bg-muted/40 px-1.5 py-1 flex flex-col items-center">
          <Star className="h-3 w-3 text-muted-foreground" />
          <span className="font-semibold tabular-nums mt-0.5">
            {stats.csat == null ? '—' : stats.csat.toFixed(1)}
          </span>
          <span className="text-[9px] text-muted-foreground">csat</span>
        </div>
      </div>

      {/* Review status */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {service.lastReviewedAt ? (
            <span>
              Reviewed <FormattedDate date={service.lastReviewedAt} />
            </span>
          ) : (
            <span className="italic">Never reviewed</span>
          )}
        </div>
        {stale && (
          <Badge variant="outline" className="text-[9px] py-0 px-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Stale
          </Badge>
        )}
      </div>

      {service.nextReviewDue && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          Next review due <FormattedDate date={service.nextReviewDue} />
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-2.5 pt-2 border-t flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={onMarkReviewed}
        >
          <CheckCircle2 className="h-3 w-3" /> Reviewed
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={onRecordDirection}
        >
          <Compass className="h-3 w-3" /> Direction
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={onSetReplacementGuidance}
        >
          <ArrowRightCircle className="h-3 w-3" /> Replace
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-1"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Flag className="h-3 w-3" /> Move
        </Button>
      </div>

      {menuOpen && (
        <div className="mt-1.5 pt-1.5 border-t flex flex-wrap items-center gap-1">
          {LIFECYCLE_COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                onMoveStage(c.key);
                setMenuOpen(false);
              }}
              className={cn(
                'text-[10px] rounded px-1.5 py-0.5 border hover:bg-muted/60',
                (service.lifecycleStage ?? 'ACTIVE') === c.key
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-background border-border text-muted-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {service.lifecycleStage !== 'RETIRED' && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={onProposeRetirement}
            className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline"
          >
            Propose retirement →
          </button>
        </div>
      )}
    </div>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-rose-600 dark:text-rose-400" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}
