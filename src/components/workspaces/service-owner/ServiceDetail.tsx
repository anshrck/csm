'use client';

/**
 * ServiceDetail — full drill-down view for a single owned service.
 *
 * Tabs: Summary | Health | Tickets | SLA | Problems | Known Errors | Changes |
 *       Customers | Knowledge | Lifecycle | Audit
 *
 * Data sources (all scoped to the serviceId prop):
 *   - GET /api/services/[id]              → service meta + SLA profile + rollup
 *   - GET /api/tickets?serviceId=…        → tickets
 *   - GET /api/sla-clocks?serviceId=…     → SLA clocks for this service's tickets
 *   - GET /api/problems?serviceId=…       → problems
 *   - GET /api/changes                    → changes (filtered client-side)
 *   - GET /api/knowledge?serviceId=…&summary=1 → knowledge articles
 *   - GET /api/audit-logs?entityType=Service&entityId=… → audit log
 *
 * Lifecycle tab exposes a [Mark Reviewed] action that PATCHes the service's
 * lastReviewedAt to "now" via /api/services/[id].
 */

import * as React from 'react';
import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Briefcase,
  Gauge,
  Bug,
  GitBranch,
  Users,
  BookOpen,
  RefreshCw,
  History,
  Package,
  ShieldAlert,
  AlertTriangle,
  Activity,
  ClipboardCheck,
  ExternalLink,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiPatch } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  KeyValue,
  DataTable,
  Badge,
  Button,
  type Column,
} from '@/components/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SERVICE_DOMAIN_LABELS,
  SERVICE_LAYER_LABELS,
  type Problem,
  type Change,
  type ServiceStatus,
  type SlaClass,
} from '@/lib/types';
import { ChangeStatusBadge } from '@/components/shared';

import {
  useServiceDetail,
  useServiceTickets,
  useOwnerSlaClocks,
  useServiceProblems,
  useServiceChanges,
  useServiceKnowledge,
  useEntityAuditLogs,
  useServiceSlaEvents,
  deriveHealth,
  type ServiceDetailDto,
  type KnowledgeArticleSummary,
  type AuditLogRow,
} from './_hooks';
import { ServiceHealthBadge } from './_components/ServiceHealthBadge';
import { RiskScoreBadge, riskScoreBand } from './_components/RiskScoreBadge';
import { SlaClockBadge } from './_components/SlaClockBadge';
import { TicketMiniTable } from './_components/TicketMiniTable';
import type { Ticket, SlaClockRow } from '@/lib/tickets';
import { formatMins } from '@/lib/tickets';

/**
 * The /api/sla-clocks route returns ticketNumber/ticketTitle/etc on each row,
 * but the SlaClockRow type in @/lib/tickets omits them. This local extension
 * keeps the table render type-safe without modifying the foundation type.
 */
type SlaClockRowWithTicket = SlaClockRow & {
  ticketNumber?: string;
  ticketTitle?: string;
};

const PROBLEM_STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  UNDER_INVESTIGATION: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  ROOT_CAUSE_IDENTIFIED: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
  DECISION: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  KNOWN_ERROR: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  LINKED_TO_CHANGE: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
};

const LIFECYCLE_LABELS: Record<string, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  UNDER_REVIEW: 'Under Review',
  RETIREMENT_CANDIDATE: 'Retirement Candidate',
  RETIRED: 'Retired',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  SERVICE_CATALOG_REVIEWED: 'Catalog reviewed',
  OWNER_RISK_CREATED: 'Risk created',
  OWNER_RISK_UPDATED: 'Risk updated',
  SERVICE_CREATED: 'Service created',
  SERVICE_UPDATED: 'Service updated',
};

export default function ServiceDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const serviceQ = useServiceDetail(id);
  const ticketsQ = useServiceTickets(id);
  const clocksQ = useOwnerSlaClocks({ serviceId: id });
  const problemsQ = useServiceProblems(id);
  const changesQ = useServiceChanges(id);
  const knowledgeQ = useServiceKnowledge(id);
  const auditQ = useEntityAuditLogs('Service', id, 100);
  const slaEventsQ = useServiceSlaEvents(id);

  const service = serviceQ.data;
  const tickets = ticketsQ.data ?? [];
  const clocks = clocksQ.data ?? [];
  const problems = problemsQ.data ?? [];
  const changes = changesQ.data ?? [];
  const knowledge = knowledgeQ.data ?? [];
  const audit = auditQ.data ?? [];
  const slaEvents = slaEventsQ.data ?? [];

  const knownErrors = useMemo(
    () => problems.filter((p) => p.status === 'KNOWN_ERROR'),
    [problems],
  );
  const openProblems = useMemo(
    () => problems.filter((p) => p.status !== 'CLOSED'),
    [problems],
  );

  const health = deriveHealth(slaEvents);
  const breaches = clocks.filter((c) => c.status === 'BREACHED').length;
  const warnings = slaEvents.filter(
    (e) => e.eventType === 'WARNING' && !e.resolvedAt,
  ).length;
  const riskScore = Math.min(
    100,
    breaches * 30 +
      tickets.filter((t) => t.priority === 'P1' || t.priority === 'P2').length * 15 +
      0 +
      knownErrors.length * 5,
  );

  const markReviewed = useMutation({
    mutationFn: () =>
      apiPatch<ServiceDetailDto>(`/api/services/${id}`, {
        lastReviewedAt: true,
      }),
    onSuccess: () => {
      toast.success('Catalog review recorded', {
        description: 'The last-reviewed date has been stamped to now.',
      });
      qc.invalidateQueries({ queryKey: ['service-detail', id] });
      qc.invalidateQueries({ queryKey: ['owner-services'] });
      qc.invalidateQueries({ queryKey: ['service-owner', 'service-health'] });
    },
    onError: (e: Error) =>
      toast.error('Could not mark reviewed', { description: e.message }),
  });

  if (serviceQ.isLoading) {
    return (
      <div className="space-y-5">
        <BackHeader onClick={() => navigate('service-health')} />
        <LoadingState rows={6} />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="space-y-5">
        <BackHeader onClick={() => navigate('service-health')} />
        <SectionCard>
          <EmptyState
            icon={<Briefcase className="h-10 w-10 text-muted-foreground/50" />}
            title="Service not found"
            description="The service you are looking for does not exist or you do not have access."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate('service-health')}>
                Back to Service Health
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackHeader onClick={() => navigate('service-health')} />

      {/* Header */}
      <PageHeader
        title={service.name}
        description={service.description}
        icon={<Briefcase className="h-6 w-6" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <SlaClassBadge slaClass={service.slaClass as SlaClass} />
            <ServiceHealthBadge health={health} />
            <RiskScoreBadge score={riskScore} showLabel />
            <Badge
              variant="outline"
              className={
                service.status === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                  : service.status === 'PLANNED'
                    ? 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300'
                    : 'bg-muted text-muted-foreground'
              }
            >
              {service.status}
            </Badge>
          </div>
        }
      />

      {/* Owner strip */}
      <SectionCard>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KeyValue
            label="Service Owner"
            value={
              service.serviceOwnerName ? (
                <div className="flex items-center gap-2">
                  <UserAvatar name={service.serviceOwnerName} size="sm" />
                  <span className="text-sm">{service.serviceOwnerName}</span>
                </div>
              ) : (
                '—'
              )
            }
          />
          <KeyValue
            label="Technical Owner"
            value={
              service.technicalOwnerName ? (
                <div className="flex items-center gap-2">
                  <UserAvatar name={service.technicalOwnerName} size="sm" />
                  <span className="text-sm">{service.technicalOwnerName}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <KeyValue label="Domain" value={SERVICE_DOMAIN_LABELS[service.domain]} />
          <KeyValue label="Layer" value={SERVICE_LAYER_LABELS[service.layer]} />
        </dl>
      </SectionCard>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto gap-1">
          <TabsTrigger value="summary" className="text-xs">Summary</TabsTrigger>
          <TabsTrigger value="health" className="text-xs">Health</TabsTrigger>
          <TabsTrigger value="tickets" className="text-xs">
            Tickets ({tickets.length})
          </TabsTrigger>
          <TabsTrigger value="sla" className="text-xs">SLA</TabsTrigger>
          <TabsTrigger value="problems" className="text-xs">
            Problems ({openProblems.length})
          </TabsTrigger>
          <TabsTrigger value="known-errors" className="text-xs">
            Known Errors ({knownErrors.length})
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-xs">
            Changes ({changes.length})
          </TabsTrigger>
          <TabsTrigger value="customers" className="text-xs">Customers</TabsTrigger>
          <TabsTrigger value="knowledge" className="text-xs">
            Knowledge ({knowledge.length})
          </TabsTrigger>
          <TabsTrigger value="lifecycle" className="text-xs">Lifecycle</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs">Audit</TabsTrigger>
        </TabsList>

        {/* ---- Summary ---- */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          <SectionCard title="Description">
            <p className="text-sm leading-relaxed text-foreground/90">
              {service.description}
            </p>
          </SectionCard>
          <SectionCard title="Service metadata">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KeyValue label="Customer Value" value={service.customerValue ?? '—'} />
              <KeyValue label="Commodity Type" value={service.commodityType ?? '—'} />
              <KeyValue label="Support Levels" value={service.supportLevels ?? '—'} />
              <KeyValue label="Chapter" value={service.chapter} />
              <KeyValue
                label="Catalog entry created"
                value={<FormattedDate date={service.createdAt} />}
              />
              <KeyValue
                label="Last reviewed"
                value={
                  service.lastReviewedAt ? (
                    <div className="flex items-center gap-1.5">
                      <FormattedDate date={service.lastReviewedAt} />
                      <span className="text-xs text-muted-foreground">
                        (<RelativeTime date={service.lastReviewedAt} />)
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">never</span>
                  )
                }
              />
              <KeyValue
                label="Lifecycle stage"
                value={
                  service.lifecycleStage
                    ? LIFECYCLE_LABELS[service.lifecycleStage] ?? service.lifecycleStage
                    : 'Active'
                }
              />
              <KeyValue
                label="SLA event count"
                value={service.slaEventCount ?? slaEvents.length}
              />
            </dl>
          </SectionCard>

          {service.offerings && service.offerings.length > 0 && (
            <SectionCard title={`Offerings (${service.offerings.length})`}>
              <ul className="space-y-2">
                {service.offerings.map((o) => (
                  <li key={o.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium flex items-center gap-2">
                          <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                          {o.name}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {o.description}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[11px]">
                        {o.requestType.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Fulfillment: {o.fulfillmentDays} days</span>
                      <span>·</span>
                      <span>{o.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {service.slaProfile && (
            <SectionCard title="SLA profile">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <KeyValue
                  label="Availability target"
                  value={`${service.slaProfile.availabilityTarget}%`}
                />
                <KeyValue
                  label="P1 response"
                  value={`${service.slaProfile.p1ResponseMins} min`}
                />
                <KeyValue
                  label="P1 resolution"
                  value={`${service.slaProfile.p1ResolutionMins} min`}
                />
                <KeyValue
                  label="P2 response"
                  value={`${service.slaProfile.p2ResponseMins} min`}
                />
                <KeyValue
                  label="P2 resolution"
                  value={`${service.slaProfile.p2ResolutionMins} min`}
                />
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* ---- Health ---- */}
        <TabsContent value="health" className="mt-4 space-y-4">
          <SectionCard title="Current health posture">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Health
                </div>
                <ServiceHealthBadge health={health} />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Risk score
                </div>
                <RiskScoreBadge score={riskScore} showLabel />
              </div>
              <KeyValue label="Open incidents" value={tickets.filter((t) => !['CLOSED', 'CANCELED', 'RESOLVED'].includes(t.status)).length} />
              <KeyValue label="SLA breaches" value={breaches} />
              <KeyValue label="SLA warnings" value={warnings} />
              <KeyValue label="Open problems" value={openProblems.length} />
              <KeyValue label="Known errors" value={knownErrors.length} />
              <KeyValue label="Active changes" value={changes.filter((c) => c.status !== 'CLOSED' && c.status !== 'REJECTED').length} />
            </div>
          </SectionCard>

          {slaEvents.length > 0 && (
            <SectionCard title="Recent SLA events">
              <ul className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin">
                {slaEvents
                  .slice()
                  .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                  .slice(0, 20)
                  .map((e) => (
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
                          <span className="font-medium">
                            {e.eventType.replace(/_/g, ' ').toLowerCase()}
                          </span>
                          <RelativeTime date={e.createdAt} className="text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground mt-0.5">{e.message}</p>
                      </div>
                    </li>
                  ))}
              </ul>
            </SectionCard>
          )}
        </TabsContent>

        {/* ---- Tickets ---- */}
        <TabsContent value="tickets" className="mt-4">
          <SectionCard
            title={`Tickets on this service (${tickets.length})`}
            description="All tickets raised against this service — incidents, service requests, questions, complaints."
          >
            {ticketsQ.isLoading ? (
              <LoadingState rows={4} />
            ) : tickets.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-8 w-8 text-muted-foreground/50" />}
                title="No tickets on this service"
                description="Tickets raised against this service will appear here."
              />
            ) : (
              <TicketMiniTable
                tickets={tickets}
                onSelect={(t) => navigate('ticket-detail', { id: t.id })}
              />
            )}
          </SectionCard>
        </TabsContent>

        {/* ---- SLA ---- */}
        <TabsContent value="sla" className="mt-4 space-y-4">
          <SectionCard
            title="SLA clocks"
            description="Response and resolution clocks for tickets on this service. BREACHED clocks demand your governance response."
          >
            {clocksQ.isLoading ? (
              <LoadingState rows={3} />
            ) : clocks.length === 0 ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8 text-muted-foreground/50" />}
                title="No active SLA clocks"
                description="No tickets on this service currently have SLA clocks running."
              />
            ) : (
              <SlaClocksTable clocks={clocks as SlaClockRowWithTicket[]} onTicketClick={(tId) => navigate('ticket-detail', { id: tId })} />
            )}
          </SectionCard>

          <SectionCard title="Compliance metrics">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KeyValue
                label="Total SLA events"
                value={service.slaEventsByType ? service.slaEventCount ?? 0 : slaEvents.length}
              />
              <KeyValue
                label="Closed in time"
                value={service.slaEventsByType?.CLOSED_IN_TIME ?? 0}
              />
              <KeyValue
                label="Breached"
                value={service.slaEventsByType?.BREACHED ?? 0}
              />
              <KeyValue
                label="Warnings"
                value={service.slaEventsByType?.WARNING ?? 0}
              />
            </dl>
          </SectionCard>
        </TabsContent>

        {/* ---- Problems ---- */}
        <TabsContent value="problems" className="mt-4">
          <SectionCard
            title={`Problems on this service (${openProblems.length} open)`}
            description="Problem records under investigation on this service."
          >
            {problemsQ.isLoading ? (
              <LoadingState rows={3} />
            ) : openProblems.length === 0 ? (
              <EmptyState
                icon={<Bug className="h-8 w-8 text-muted-foreground/50" />}
                title="No open problems"
                description="Active problem records will appear here."
              />
            ) : (
              <ProblemsTable problems={openProblems} />
            )}
          </SectionCard>
        </TabsContent>

        {/* ---- Known Errors ---- */}
        <TabsContent value="known-errors" className="mt-4">
          <SectionCard
            title={`Known errors (${knownErrors.length})`}
            description="Problems with documented workarounds awaiting permanent fix."
          >
            {knownErrors.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-8 w-8 text-muted-foreground/50" />}
                title="No active known errors"
                description="Known errors for this service will surface here with workaround context."
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
                    {p.rootCauseDescription && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Root cause: {p.rootCauseDescription}
                      </p>
                    )}
                    {p.workaroundDescription && (
                      <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed">
                        <span className="font-medium">Workaround:</span>{' '}
                        {p.workaroundDescription}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        {/* ---- Changes ---- */}
        <TabsContent value="changes" className="mt-4">
          <SectionCard
            title={`Changes affecting this service (${changes.length})`}
            description="Changes whose affected-service list includes this service."
          >
            {changesQ.isLoading ? (
              <LoadingState rows={3} />
            ) : changes.length === 0 ? (
              <EmptyState
                icon={<GitBranch className="h-8 w-8 text-muted-foreground/50" />}
                title="No changes affecting this service"
                description="Changes targeting this service will appear here."
              />
            ) : (
              <ChangesTable changes={changes} />
            )}
          </SectionCard>
        </TabsContent>

        {/* ---- Customers ---- */}
        <TabsContent value="customers" className="mt-4">
          <SectionCard
            title="Customers consuming this service"
            description="Customers derived from tickets raised against this service."
          >
            <CustomersTab tickets={tickets} />
          </SectionCard>
        </TabsContent>

        {/* ---- Knowledge ---- */}
        <TabsContent value="knowledge" className="mt-4">
          <SectionCard
            title={`Knowledge articles (${knowledge.length})`}
            description="How-to guides, FAQs, runbooks, and known-error articles linked to this service."
          >
            {knowledgeQ.isLoading ? (
              <LoadingState rows={3} />
            ) : knowledge.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-8 w-8 text-muted-foreground/50" />}
                title="No knowledge articles"
                description="Articles linked to this service will appear here."
              />
            ) : (
              <ul className="space-y-2">
                {knowledge.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-md border p-3 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                        {a.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {a.type.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {a.status.toLowerCase()}
                        </Badge>
                        {a.publishedAt && (
                          <span>published <FormattedDate date={a.publishedAt} /></span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => navigate('knowledge')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        {/* ---- Lifecycle ---- */}
        <TabsContent value="lifecycle" className="mt-4 space-y-4">
          <SectionCard
            title="Lifecycle stage"
            description="The service's position in its lifecycle. Update the stage when the service transitions between planned, active, review, and retirement."
          >
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KeyValue
                label="Current stage"
                value={
                  service.lifecycleStage
                    ? LIFECYCLE_LABELS[service.lifecycleStage] ?? service.lifecycleStage
                    : 'Active (default)'
                }
              />
              <KeyValue
                label="Last catalog review"
                value={
                  service.lastReviewedAt ? (
                    <FormattedDate date={service.lastReviewedAt} />
                  ) : (
                    <span className="text-muted-foreground italic">never</span>
                  )
                }
              />
            </dl>
            <div className="mt-4 pt-3 border-t flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => markReviewed.mutate()}
                disabled={markReviewed.isPending}
                className="gap-1.5"
              >
                {markReviewed.isPending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <ClipboardCheck className="h-3.5 w-3.5" />
                )}
                {markReviewed.isPending ? 'Recording…' : 'Mark Reviewed'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Stamps <code className="text-[11px]">lastReviewedAt</code> to now. The action
                is recorded in the audit trail.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Lifecycle stages reference">
            <ul className="text-xs text-muted-foreground space-y-1.5">
              {Object.entries(LIFECYCLE_LABELS).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] w-32 justify-center">
                    {k}
                  </Badge>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>

        {/* ---- Audit ---- */}
        <TabsContent value="audit" className="mt-4">
          <SectionCard
            title="Audit trail"
            description="Governance and lifecycle actions recorded against this service."
          >
            {auditQ.isLoading ? (
              <LoadingState rows={4} />
            ) : audit.length === 0 ? (
              <EmptyState
                icon={<History className="h-8 w-8 text-muted-foreground/50" />}
                title="No audit entries"
                description="Audit log entries for this service will appear here."
              />
            ) : (
              <AuditTimeline rows={audit} />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function BackHeader({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Service Health
    </button>
  );
}

function SlaClocksTable({
  clocks,
  onTicketClick,
}: {
  clocks: SlaClockRowWithTicket[];
  onTicketClick: (ticketId: string) => void;
}) {
  const columns: Column<SlaClockRowWithTicket>[] = [
    {
      key: 'ticket',
      header: 'Ticket',
      render: (c) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTicketClick(c.ticketId);
          }}
          className="font-mono text-xs text-primary hover:underline"
        >
          {c.ticketNumber ?? c.ticketId.slice(-8)}
        </button>
      ),
      headerClassName: 'w-32',
      className: 'w-32',
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <span className="text-xs font-medium">{c.type.charAt(0) + c.type.slice(1).toLowerCase()}</span>
      ),
      headerClassName: 'w-24',
      className: 'w-24',
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <SlaClockBadge status={c.status} />,
      headerClassName: 'w-28',
      className: 'w-28',
    },
    {
      key: 'due',
      header: 'Due',
      render: (c) => <FormattedDate date={c.dueAt} className="text-xs" />,
      headerClassName: 'w-28',
      className: 'w-28',
    },
    {
      key: 'remaining',
      header: 'Remaining',
      render: (c) => {
        if (c.status !== 'RUNNING') return <span className="text-xs text-muted-foreground">—</span>;
        const mins = c.remainingMins ?? 0;
        const tone = mins < 0 ? 'text-rose-700 dark:text-rose-300' : mins <= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300';
        return (
          <span className={`text-xs font-medium tabular-nums ${tone}`}>
            {mins < 0 ? `Breached ${formatMins(-mins)} ago` : `${formatMins(mins)} left`}
          </span>
        );
      },
      headerClassName: 'w-32',
      className: 'w-32',
    },
    {
      key: 'percent',
      header: '% left',
      render: (c) => {
        if (c.status !== 'RUNNING' || c.percentRemaining == null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const tone =
          c.percentRemaining <= 25
            ? 'text-rose-700 dark:text-rose-300'
            : c.percentRemaining <= 50
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-emerald-700 dark:text-emerald-300';
        return (
          <span className={`text-xs tabular-nums font-medium ${tone}`}>
            {c.percentRemaining}%
          </span>
        );
      },
      headerClassName: 'w-20 text-right',
      className: 'w-20 text-right',
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={clocks as SlaClockRowWithTicket[]}
      onRowClick={(c) => onTicketClick(c.ticketId)}
      empty="No SLA clocks."
    />
  );
}

function ProblemsTable({ problems }: { problems: Problem[] }) {
  const columns: Column<Problem>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (p) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="text-sm font-medium truncate">{p.title}</div>
          {p.rootCauseDescription && (
            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
              {p.rootCauseDescription}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <Badge
          variant="outline"
          className={`text-[11px] border ${PROBLEM_STATUS_STYLES[p.status] ?? 'bg-muted text-muted-foreground border-border'}`}
        >
          {p.status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
      ),
      headerClassName: 'w-32',
      className: 'w-32',
    },
    {
      key: 'workaround',
      header: 'Workaround',
      render: (p) =>
        p.workaroundDescription ? (
          <span className="text-xs text-foreground/80 line-clamp-1 max-w-[200px]">
            {p.workaroundDescription}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">none</span>
        ),
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (p) => <RelativeTime date={p.updatedAt} className="text-xs text-muted-foreground" />,
      headerClassName: 'w-24 text-right',
      className: 'w-24 text-right',
    },
  ];
  return <DataTable columns={columns} rows={problems} empty="No problems." />;
}

function ChangesTable({ changes }: { changes: Change[] }) {
  const columns: Column<Change>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (c) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="text-sm font-medium truncate">{c.title}</div>
          {c.implementationPlan && (
            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
              {c.implementationPlan}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge
          variant="outline"
          className={`text-[11px] ${
            c.type === 'EMERGENCY'
              ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300'
              : c.type === 'NORMAL'
                ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
          }`}
        >
          {c.type.toLowerCase()}
        </Badge>
      ),
      headerClassName: 'w-24',
      className: 'w-24',
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ChangeStatusBadge status={c.status} className="text-[11px]" />,
      headerClassName: 'w-28',
      className: 'w-28',
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (c) => <RelativeTime date={c.updatedAt} className="text-xs text-muted-foreground" />,
      headerClassName: 'w-24 text-right',
      className: 'w-24 text-right',
    },
  ];
  return <DataTable columns={columns} rows={changes} empty="No changes." />;
}

function CustomersTab({ tickets }: { tickets: Ticket[] }) {
  const customers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; tickets: number; open: number; p1p2: number }>();
    for (const t of tickets) {
      const id = t.serviceCustomerId;
      const name = t.serviceCustomerName ?? 'Unknown';
      const entry = map.get(id) ?? { id, name, tickets: 0, open: 0, p1p2: 0 };
      entry.tickets += 1;
      if (!['CLOSED', 'CANCELED', 'RESOLVED'].includes(t.status)) entry.open += 1;
      if (t.priority === 'P1' || t.priority === 'P2') entry.p1p2 += 1;
      map.set(id, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
  }, [tickets]);

  if (customers.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-muted-foreground/50" />}
        title="No customer activity"
        description="Customers who have raised tickets against this service will appear here."
      />
    );
  }

  return (
    <DataTable
      columns={[
        {
          key: 'name',
          header: 'Customer',
          render: (c) => (
            <div className="flex items-center gap-2">
              <UserAvatar name={c.name} size="sm" />
              <span className="text-sm font-medium">{c.name}</span>
            </div>
          ),
        },
        {
          key: 'tickets',
          header: 'Total tickets',
          render: (c) => <span className="text-sm tabular-nums">{c.tickets}</span>,
          headerClassName: 'w-28 text-right',
          className: 'w-28 text-right',
        },
        {
          key: 'open',
          header: 'Open',
          render: (c) => (
            <span className={`text-sm tabular-nums ${c.open > 0 ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
              {c.open}
            </span>
          ),
          headerClassName: 'w-20 text-right',
          className: 'w-20 text-right',
        },
        {
          key: 'p1p2',
          header: 'P1/P2',
          render: (c) => (
            <span className={`text-sm tabular-nums ${c.p1p2 > 0 ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>
              {c.p1p2}
            </span>
          ),
          headerClassName: 'w-20 text-right',
          className: 'w-20 text-right',
        },
      ]}
      rows={customers}
      empty="No customers."
    />
  );
}

function AuditTimeline({ rows }: { rows: AuditLogRow[] }) {
  return (
    <ol className="relative space-y-3 max-h-[28rem] overflow-y-auto scrollbar-thin">
      {rows.map((r, i) => (
        <li key={r.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={`flex items-center justify-center h-6 w-6 rounded-full border bg-card ${
                i === 0 ? 'border-primary text-primary' : 'border-muted-foreground/30 text-muted-foreground'
              }`}
            >
              <History className="h-3 w-3" />
            </div>
            {i < rows.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {AUDIT_ACTION_LABELS[r.action] ?? r.action.replace(/_/g, ' ').toLowerCase()}
              </span>
              <RelativeTime date={r.createdAt} className="text-xs text-muted-foreground shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground">by {r.actorName}</p>
            {r.after != null ? (
              <pre className="text-[11px] text-foreground/70 mt-1 bg-muted/40 rounded p-2 overflow-x-auto">
                {JSON.stringify(r.after, null, 2)}
              </pre>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
