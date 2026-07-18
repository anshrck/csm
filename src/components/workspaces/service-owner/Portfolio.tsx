'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import type { Service, ServiceOffering, SlaProfile, SlaEvent, Change, Problem } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  KeyValue,
  DataTable,
  Badge,
  Button,
  type Column,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Briefcase,
  ClipboardCheck,
  Clock,
  Gauge,
  History,
  Package,
  RefreshCw,
  CheckCircle2,
  Megaphone,
  ShieldAlert,
  Bug,
  GitBranch,
  BookOpen,
  Users,
  ExternalLink,
  Stethoscope,
  AlertTriangle,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useAllChanges,
  useOwnerProblems,
  deriveHealth,
} from './_hooks';
import { SERVICE_DOMAIN_LABELS, SERVICE_LAYER_LABELS } from '@/lib/types';

const LIFECYCLE_LABELS: Record<string, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  UNDER_REVIEW: 'Under Review',
  RETIREMENT_CANDIDATE: 'Retirement Candidate',
  RETIRED: 'Retired',
};

/* --------------------- Main --------------------- */

export default function Portfolio() {
  const { navigate } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const changesQ = useAllChanges();
  const problemsQ = useOwnerProblems();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);
  const slaEvents = slaQ.data ?? [];
  const changes = changesQ.data ?? [];
  const problems = problemsQ.data ?? [];

  const lastEventFor = (serviceId: string) =>
    slaEvents
      .filter((e) => e.serviceId === serviceId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

  const columns: Column<Service>[] = [
    {
      key: 'name',
      header: 'Service',
      render: (s) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{s.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {SERVICE_DOMAIN_LABELS[s.domain]} · {s.chapter}
          </div>
        </div>
      ),
    },
    {
      key: 'layer',
      header: 'Layer',
      render: (s) => <span className="text-sm">{SERVICE_LAYER_LABELS[s.layer]}</span>,
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'slaClass',
      header: 'SLA Class',
      render: (s) => <SlaClassBadge slaClass={s.slaClass} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge
          variant="outline"
          className={
            s.status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
              : s.status === 'PLANNED'
                ? 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300'
                : 'bg-muted text-muted-foreground'
          }
        >
          {s.status}
        </Badge>
      ),
    },
    {
      key: 'health',
      header: 'Current Health',
      render: (s) => {
        const sEvents = slaEvents.filter((e) => e.serviceId === s.id);
        return <SlaHealthBadge health={deriveHealth(sEvents)} />;
      },
    },
    {
      key: 'lastReviewed',
      header: 'Last Reviewed',
      render: (s) => {
        const reviewedAt = (s as Service & { lastReviewedAt?: string | null }).lastReviewedAt;
        if (!reviewedAt) return <span className="text-xs text-muted-foreground">—</span>;
        const ninetyDaysAgo = Date.now() - 90 * 86400000;
        const isStale = new Date(reviewedAt).getTime() < ninetyDaysAgo;
        return (
          <div className="text-xs">
            <div className={isStale ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-muted-foreground'}>
              <FormattedDate date={reviewedAt} />
            </div>
            {isStale && <div className="text-[10px] text-amber-700 dark:text-amber-300">overdue review</div>}
          </div>
        );
      },
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
    {
      key: 'lastEvent',
      header: 'Last SLA Event',
      render: (s) => {
        const ev = lastEventFor(s.id);
        if (!ev) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="text-xs">
            <div className="font-medium">{ev.eventType.replace(/_/g, ' ')}</div>
            <div className="text-muted-foreground">
              <RelativeTime date={ev.createdAt} />
            </div>
          </div>
        );
      },
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Portfolio"
        description="Every service in your ownership has a current, accurate catalog entry. Review service metadata, SLA profile, offerings, lifecycle stage, and recent activity. Row click opens the full service detail view."
        icon={<Briefcase className="h-6 w-6" />}
      />

      {/* Catalog accuracy banner */}
      <SectionCard
        title="Catalog Accuracy Obligation"
        description="The catalog entry your customers see must reflect the live service. Verify metadata, support levels, and SLA targets remain accurate. Services overdue for review (>90 days) are flagged below."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {services.slice(0, 4).map((s) => {
            const reviewedAt = (s as Service & { lastReviewedAt?: string | null }).lastReviewedAt;
            const stale = !reviewedAt || Date.now() - new Date(reviewedAt).getTime() > 90 * 86400000;
            return (
              <div
                key={s.id}
                className="rounded-lg border p-3 cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setSelectedId(s.id)}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  <ClipboardCheck
                    className={`h-3.5 w-3.5 ${stale ? 'text-amber-500' : 'text-emerald-500'}`}
                  />
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">
                    {stale ? 'Stale' : 'Current'}
                  </span>
                </div>
                <div className="text-sm font-medium mt-1.5 line-clamp-2">{s.name}</div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {reviewedAt ? (
                    <>Reviewed <FormattedDate date={reviewedAt} /></>
                  ) : (
                    <>Never reviewed</>
                  )}
                </div>
              </div>
            );
          })}
          {services.length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground py-2">
              No services in portfolio.
            </div>
          )}
        </div>
      </SectionCard>

      {servicesQ.isLoading ? (
        <LoadingState rows={6} />
      ) : services.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Briefcase className="h-10 w-10" />}
            title="No services in your portfolio"
            description="Services where you are the assigned owner will be listed here."
          />
        </SectionCard>
      ) : (
        <DataTable
          columns={columns}
          rows={services}
          onRowClick={(s) => setSelectedId(s.id)}
          empty="No services found."
        />
      )}

      {selectedId && (
        <ServiceDetailDialog
          serviceId={selectedId}
          onClose={() => setSelectedId(null)}
          slaEvents={slaEvents.filter((e) => e.serviceId === selectedId)}
          changes={changes.filter((c) => c.affectedServiceIds.includes(selectedId))}
          problems={problems.filter((p) => p.serviceId === selectedId)}
          myServiceIds={myServiceIds}
          onOpenFullDetail={(id) => {
            setSelectedId(null);
            navigate('service-detail', { id });
          }}
        />
      )}
    </div>
  );
}

/* --------------------- Service Detail Dialog (quick view) --------------------- */

function ServiceDetailDialog({
  serviceId,
  onClose,
  slaEvents,
  changes,
  problems,
  myServiceIds,
  onOpenFullDetail,
}: {
  serviceId: string;
  onClose: () => void;
  slaEvents: SlaEvent[];
  changes: Change[];
  problems: Problem[];
  myServiceIds: Set<string>;
  onOpenFullDetail: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<
    Service & {
      offerings?: ServiceOffering[];
      slaProfile?: SlaProfile | null;
      lastReviewedAt?: string | null;
      nextReviewDue?: string | null;
      lifecycleStage?: string | null;
      slaEventCount?: number;
      slaEventsByType?: { WARNING: number; BREACHED: number; CLOSED_IN_TIME: number };
    }
  >({
    queryKey: ['service', serviceId],
    queryFn: () => apiGet(`/api/services/${serviceId}`),
  });

  const [reviewPending, setReviewPending] = useState(false);

  const markReviewed = useMutation({
    mutationFn: () => apiPatch(`/api/services/${serviceId}`, { lastReviewedAt: 'now' }),
    onSuccess: () => {
      // Also record a CATALOG_ACCURACY governance decision.
      apiPost('/api/governance-decisions', {
        serviceId,
        decisionType: 'CATALOG_ACCURACY',
        decision: 'APPROVED',
        rationale: `Catalog entry reviewed and confirmed accurate by Service Owner on ${new Date().toLocaleDateString()}.`,
      })
        .then(() => {
          toast.success('Catalog marked as accurate', {
            description: 'lastReviewedAt updated + CATALOG_ACCURACY governance decision recorded.',
          });
        })
        .catch(() => {
          toast.warning('Catalog stamp saved, but governance decision failed');
        });
      qc.invalidateQueries({ queryKey: ['service', serviceId] });
      qc.invalidateQueries({ queryKey: ['owner-services'] });
      setReviewPending(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setReviewPending(false);
    },
  });

  const recentEvents = slaEvents
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 8);
  const recentChanges = changes
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);

  const knownErrors = problems.filter((p) => p.knownErrorId || p.status === 'KNOWN_ERROR');
  const openProblems = problems.filter((p) => p.status !== 'CLOSED');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        {isLoading || !data ? (
          <div className="py-8">
            <LoadingState rows={4} />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <SlaClassBadge slaClass={data.slaClass} />
                  <SlaHealthBadge health={deriveHealth(slaEvents)} />
                  <Badge variant="outline">{SERVICE_DOMAIN_LABELS[data.domain]}</Badge>
                  <Badge variant="outline">{SERVICE_LAYER_LABELS[data.layer]}</Badge>
                  {data.lifecycleStage && (
                    <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300">
                      {LIFECYCLE_LABELS[data.lifecycleStage] ?? data.lifecycleStage}
                    </Badge>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onOpenFullDetail(serviceId)}>
                  <ExternalLink className="h-3 w-3" /> Open Full Detail
                </Button>
              </div>
              <DialogTitle className="text-xl mt-2">{data.name}</DialogTitle>
              <DialogDescription>{data.chapter} chapter</DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="health" className="text-xs">Health</TabsTrigger>
                <TabsTrigger value="sla" className="text-xs">SLA Clocks</TabsTrigger>
                <TabsTrigger value="incidents" className="text-xs">Incidents</TabsTrigger>
                <TabsTrigger value="customers" className="text-xs">Customers</TabsTrigger>
                <TabsTrigger value="problems" className="text-xs">Problems</TabsTrigger>
              </TabsList>
              <TabsList className="grid w-full grid-cols-3 md:grid-cols-5 h-auto mt-1">
                <TabsTrigger value="knownErrors" className="text-xs">Known Errors</TabsTrigger>
                <TabsTrigger value="changes" className="text-xs">Changes</TabsTrigger>
                <TabsTrigger value="knowledge" className="text-xs">Knowledge</TabsTrigger>
                <TabsTrigger value="lifecycle" className="text-xs">Lifecycle</TabsTrigger>
                <TabsTrigger value="audit" className="text-xs">Audit</TabsTrigger>
              </TabsList>

              {/* Overview tab */}
              <TabsContent value="overview" className="space-y-4 mt-4">
                <p className="text-sm leading-relaxed text-foreground/90">{data.description}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <KeyValue label="Customer Value" value={data.customerValue} />
                  <KeyValue label="Commodity Type" value={data.commodityType} />
                  <KeyValue label="Support Levels" value={data.supportLevels} />
                  <KeyValue label="Catalog Entry Created" value={<FormattedDate date={data.createdAt} />} />
                  <KeyValue
                    label="Last Reviewed"
                    value={data.lastReviewedAt ? <FormattedDate date={data.lastReviewedAt} /> : 'Never'}
                  />
                  <KeyValue
                    label="Next Review Due"
                    value={data.nextReviewDue ? <FormattedDate date={data.nextReviewDue} /> : '—'}
                  />
                  <KeyValue label="Lifecycle Stage" value={data.lifecycleStage ? (LIFECYCLE_LABELS[data.lifecycleStage] ?? data.lifecycleStage) : '—'} />
                  <KeyValue label="Technical Owner" value={data.technicalOwnerName ?? '—'} />
                </dl>

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    className="h-7 gap-1.5"
                    onClick={() => {
                      setReviewPending(true);
                      markReviewed.mutate();
                    }}
                    disabled={reviewPending}
                  >
                    {reviewPending ? <Clock className="h-3 w-3 animate-pulse" /> : <CheckCircle2 className="h-3 w-3" />}
                    Mark Catalog Accurate
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => toast.info('Catalog update requested', { description: 'The CE Worker will be notified to update the catalog entry.' })}>
                    <Megaphone className="h-3 w-3" /> Request Catalog Update
                  </Button>
                </div>
              </TabsContent>

              {/* Health tab */}
              <TabsContent value="health" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <HealthTile label="Active Breaches" value={slaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt).length} tone="danger" icon={<ShieldAlert className="h-4 w-4" />} />
                  <HealthTile label="Active Warnings" value={slaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt).length} tone="warning" icon={<AlertTriangle className="h-4 w-4" />} />
                  <HealthTile label="Open Problems" value={openProblems.length} tone="warning" icon={<Bug className="h-4 w-4" />} />
                  <HealthTile label="Known Errors" value={knownErrors.length} tone="danger" icon={<BookOpen className="h-4 w-4" />} />
                </div>
                <div className="rounded-lg border p-4 bg-muted/30">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">SLA Event Breakdown</div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                        {data.slaEventsByType?.WARNING ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Warnings</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                        {data.slaEventsByType?.BREACHED ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Breaches</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {data.slaEventsByType?.CLOSED_IN_TIME ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Closed in time</div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* SLA Clocks tab */}
              <TabsContent value="sla" className="space-y-4 mt-4">
                <SlaClocksTab serviceId={serviceId} />
              </TabsContent>

              {/* Incidents tab */}
              <TabsContent value="incidents" className="space-y-4 mt-4">
                <IncidentsTab serviceId={serviceId} />
              </TabsContent>

              {/* Customers tab */}
              <TabsContent value="customers" className="space-y-4 mt-4">
                <CustomersTab serviceId={serviceId} />
              </TabsContent>

              {/* Problems tab */}
              <TabsContent value="problems" className="space-y-4 mt-4">
                {openProblems.length === 0 ? (
                  <EmptyState icon={<Bug className="h-7 w-7" />} title="No open problems" description="No active problems on this service." />
                ) : (
                  <ul className="divide-y">
                    {openProblems.map((p) => (
                      <li key={p.id} className="py-2.5">
                        <div className="text-sm font-medium">{p.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.status.replace(/_/g, ' ').toLowerCase()}
                          {p.rootCauseDescription && ` · ${p.rootCauseDescription.slice(0, 80)}…`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              {/* Known Errors tab */}
              <TabsContent value="knownErrors" className="space-y-4 mt-4">
                {knownErrors.length === 0 ? (
                  <EmptyState icon={<BookOpen className="h-7 w-7" />} title="No known errors" description="No known errors documented for this service." />
                ) : (
                  <ul className="space-y-2">
                    {knownErrors.map((p) => (
                      <li key={p.id} className="rounded-md border border-orange-200 dark:border-orange-900/50 bg-orange-50/40 dark:bg-orange-950/20 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-800 dark:text-orange-300">
                          <BookOpen className="h-3 w-3" /> Known Error
                        </div>
                        <div className="text-sm font-medium mt-1">{p.title}</div>
                        {p.workaroundDescription && (
                          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                            <span className="font-medium">Workaround:</span> {p.workaroundDescription}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              {/* Changes tab */}
              <TabsContent value="changes" className="space-y-4 mt-4">
                {recentChanges.length === 0 ? (
                  <EmptyState icon={<GitBranch className="h-7 w-7" />} title="No changes" description="No recent changes affecting this service." />
                ) : (
                  <ul className="space-y-2">
                    {recentChanges.map((c) => (
                      <li key={c.id} className="text-xs border rounded-md p-2">
                        <div className="font-medium">{c.title}</div>
                        <div className="text-muted-foreground mt-0.5">
                          {c.status} · {c.type} · <RelativeTime date={c.createdAt} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              {/* Knowledge tab */}
              <TabsContent value="knowledge" className="space-y-4 mt-4">
                <KnowledgeTab serviceId={serviceId} />
              </TabsContent>

              {/* Lifecycle tab */}
              <TabsContent value="lifecycle" className="space-y-4 mt-4">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">Service Lifecycle</span>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <KeyValue label="Lifecycle Stage" value={data.lifecycleStage ? (LIFECYCLE_LABELS[data.lifecycleStage] ?? data.lifecycleStage) : '—'} />
                    <KeyValue label="Service Status" value={data.status} />
                    <KeyValue label="Last Reviewed" value={data.lastReviewedAt ? <FormattedDate date={data.lastReviewedAt} /> : 'Never'} />
                    <KeyValue label="Next Review Due" value={data.nextReviewDue ? <FormattedDate date={data.nextReviewDue} /> : '—'} />
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="h-7 gap-1.5" onClick={() => { setReviewPending(true); markReviewed.mutate(); }} disabled={reviewPending}>
                    {reviewPending ? <Clock className="h-3 w-3 animate-pulse" /> : <CheckCircle2 className="h-3 w-3" />}
                    Mark Catalog Accurate
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => toast.info('Catalog update requested', { description: 'The CE Worker will be notified to update the catalog entry.' })}>
                    <Megaphone className="h-3 w-3" /> Request Catalog Update
                  </Button>
                </div>
              </TabsContent>

              {/* Audit tab */}
              <TabsContent value="audit" className="space-y-4 mt-4">
                <AuditTab serviceId={serviceId} />
              </TabsContent>

              {/* SLA tab (kept for compat — legacy "SLA Profile" content) */}
              <TabsContent value="slaProfile" className="space-y-4 mt-4">
                {data.slaProfile ? (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Gauge className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">SLA Profile — Class {data.slaProfile.slaClass}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <KeyValue label="Availability Target" value={`${data.slaProfile.availabilityTarget}%`} />
                      <KeyValue label="P1 Response" value={`${data.slaProfile.p1ResponseMins} min`} />
                      <KeyValue label="P1 Resolution" value={`${data.slaProfile.p1ResolutionMins} min`} />
                      <KeyValue label="P2 Response" value={`${data.slaProfile.p2ResponseMins} min`} />
                      <KeyValue label="P2 Resolution" value={`${data.slaProfile.p2ResolutionMins} min`} />
                    </div>
                  </div>
                ) : (
                  <EmptyState icon={<Gauge className="h-7 w-7" />} title="No SLA profile attached" description="Attach an SLA profile to publish measurable commitments." />
                )}
              </TabsContent>

              {/* Offerings tab (kept for compat) */}
              <TabsContent value="offerings" className="space-y-2 mt-4">
                {data.offerings && data.offerings.length > 0 ? (
                  data.offerings.map((o) => (
                    <div key={o.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                            {o.name}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{o.description}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {o.requestType.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Fulfillment: {o.fulfillmentDays} days</span>
                        <span>·</span>
                        <span>{o.active ? 'Active' : 'Inactive'}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState icon={<Package className="h-7 w-7" />} title="No offerings published" description="Define requestable offerings for this service." />
                )}
              </TabsContent>

              {/* Activity tab (kept for compat — recent SLA events + changes) */}
              <TabsContent value="activity" className="space-y-4 mt-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" /> Recent SLA Events
                  </h4>
                  {recentEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent SLA events.</p>
                  ) : (
                    <ul className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                      {recentEvents.map((e) => (
                        <li key={e.id} className="flex items-start gap-2 text-xs">
                          <span
                            className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                              e.eventType === 'BREACHED'
                                ? 'bg-rose-500'
                                : e.eventType === 'WARNING'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium">{e.eventType.replace(/_/g, ' ')}</span>
                              <RelativeTime date={e.createdAt} className="text-muted-foreground" />
                            </div>
                            <p className="text-muted-foreground mt-0.5">{e.message}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Recent Changes
                  </h4>
                  {recentChanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent changes.</p>
                  ) : (
                    <ul className="space-y-2">
                      {recentChanges.map((c) => (
                        <li key={c.id} className="text-xs border rounded-md p-2">
                          <div className="font-medium">{c.title}</div>
                          <div className="text-muted-foreground mt-0.5">
                            {c.status} · {c.type} · <RelativeTime date={c.createdAt} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={() => onOpenFullDetail(serviceId)} className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Open Full Detail
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Sub-tabs --------------------- */

function HealthTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'default' | 'warning' | 'danger' | 'success';
  icon: React.ReactNode;
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

function SlaClocksTab({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useQuery<Array<{ id: string; ticketNumber?: string; ticketTitle?: string; type: string; status: string; dueAt: string; breachedAt: string | null; remainingMins: number | null }>>({
    queryKey: ['sla-clocks', 'service', serviceId],
    queryFn: () => apiGet(`/api/sla-clocks?serviceId=${encodeURIComponent(serviceId)}`),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (!data || data.length === 0)
    return <EmptyState icon={<Gauge className="h-7 w-7" />} title="No SLA clocks" description="No SLA clocks running for tickets on this service." />;

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
      {data.slice(0, 12).map((c) => (
        <div key={c.id} className="rounded-md border p-2.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge
              variant="outline"
              className={
                c.status === 'BREACHED'
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300'
                  : c.status === 'MET'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                    : c.status === 'RUNNING'
                      ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300'
                      : 'bg-muted text-muted-foreground'
              }
            >
              {c.type} · {c.status}
            </Badge>
            {c.ticketNumber && <span className="font-mono text-muted-foreground">{c.ticketNumber}</span>}
          </div>
          {c.ticketTitle && <div className="text-foreground/80 truncate">{c.ticketTitle}</div>}
          <div className="text-muted-foreground mt-0.5">
            Due <FormattedDate date={c.dueAt} />
            {c.breachedAt && <> · Breached <RelativeTime date={c.breachedAt} /></>}
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentsTab({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useQuery<Array<{ id: string; number: string; title: string; priority: string; status: string }>>({
    queryKey: ['tickets', 'service', serviceId],
    queryFn: () => apiGet(`/api/tickets?serviceId=${encodeURIComponent(serviceId)}`),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (!data || data.length === 0)
    return <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="No incidents" description="No tickets raised on this service." />;

  return (
    <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
      {data.slice(0, 10).map((t) => (
        <li key={t.id} className="py-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-muted-foreground">{t.number}</span>
            <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>
            <span className="text-foreground/80 truncate flex-1 min-w-0">{t.title}</span>
          </div>
          <div className="text-muted-foreground mt-0.5">{t.status.replace(/_/g, ' ').toLowerCase()}</div>
        </li>
      ))}
    </ul>
  );
}

function CustomersTab({ serviceId }: { serviceId: string }) {
  // We don't have a per-service customer endpoint; fall back to customer-impact list and filter.
  const { data, isLoading } = useQuery<Array<{ customerId: string; customerName: string; activeTickets: number; activeBreaches: number; averageCsat: number | null }>>({
    queryKey: ['service-owner', 'customer-impact'],
    queryFn: () => apiGet('/api/service-owner/customer-impact'),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (!data || data.length === 0)
    return <EmptyState icon={<Users className="h-7 w-7" />} title="No customer data" description="No customer impact data available for this service." />;

  return (
    <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
      {data.map((c) => (
        <li key={c.customerId} className="py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm">{c.customerName}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{c.activeTickets} tickets</span>
              {c.activeBreaches > 0 && (
                <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300">
                  {c.activeBreaches} breaches
                </Badge>
              )}
            </div>
          </div>
          {c.averageCsat != null && (
            <div className="text-muted-foreground mt-0.5">CSAT {c.averageCsat}★</div>
          )}
        </li>
      ))}
    </ul>
  );
}

function KnowledgeTab({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useQuery<Array<{ id: string; title: string; type: string; status: string }>>({
    queryKey: ['knowledge', 'service', serviceId],
    queryFn: () => apiGet(`/api/knowledge?serviceId=${encodeURIComponent(serviceId)}&summary=1`),
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (!data || data.length === 0)
    return <EmptyState icon={<BookOpen className="h-7 w-7" />} title="No knowledge articles" description="No knowledge articles published for this service." />;

  return (
    <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
      {data.slice(0, 10).map((k) => (
        <li key={k.id} className="py-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{k.title}</span>
            <Badge variant="outline" className="text-[10px]">{k.type}</Badge>
            <Badge variant="outline" className="text-[10px]">{k.status}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useQuery<Array<{ id: string; actorName: string; action: string; createdAt: string }>>({
    queryKey: ['audit-logs', 'service', serviceId],
    queryFn: () => apiGet(`/api/audit-logs?entityType=Service&entityId=${encodeURIComponent(serviceId)}&limit=20`),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (!data || data.length === 0)
    return <EmptyState icon={<History className="h-7 w-7" />} title="No audit history" description="No audit log entries for this service." />;

  return (
    <ul className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
      {data.map((a) => (
        <li key={a.id} className="py-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{a.action.replace(/_/g, ' ').toLowerCase()}</span>
            <RelativeTime date={a.createdAt} className="text-muted-foreground" />
          </div>
          <div className="text-muted-foreground">by {a.actorName}</div>
        </li>
      ))}
    </ul>
  );
}
