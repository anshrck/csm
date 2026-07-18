'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  PlusCircle,
  FileText,
  Clock,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Activity,
  HeartPulse,
  Inbox,
  MessageSquare,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  type Demand,
  type Service,
  type SlaEvent,
  type SlaHealth,
  DEMAND_PIPELINE,
  DEMAND_STATUS_LABELS,
} from '@/lib/types';
import type { Ticket } from '@/lib/tickets';
import {
  PageHeader,
  StatCard,
  SectionCard,
  DemandStatusBadge,
  SlaClassBadge,
  SlaHealthBadge,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  Money,
  Days,
  EmptyState,
  LoadingState,
  Button,
  Badge,
} from '@/components/shared';
import { cn } from '@/lib/utils';

/* ----------------------------- Response types ----------------------------- */

interface StatsResponse {
  totalDemands: number;
  byStatus: Record<string, number>;
  slaWarnings: number;
  slaBreaches: number;
  pendingApprovals: number;
  openChanges: number;
  pipeline?: { status: string; count: number }[];
  slaByService?: {
    serviceId: string;
    serviceName: string;
    slaClass: string;
    health: SlaHealth;
    events: number;
  }[];
  recentActivity?: {
    id: string;
    demandId: string;
    demandTitle: string;
    eventType: string;
    actorName: string;
    createdAt: string;
  }[];
  totalOpenTickets?: number;
  totalActiveDemands?: number;
  avgCsat?: number | null;
  reopenRate?: number | null;
}

interface OverviewResponse {
  totalOpenTickets: number;
  totalActiveDemands: number;
  slaBreaches: number;
  slaWarnings: number;
  avgCsat: number | null;
  reopenRate: number | null;
}

interface TicketsStatsResponse {
  byStatus: Record<string, number>;
  waitingCustomer: number;
  unassigned: number;
  reopened: number;
  slaBreached: number;
}

interface KnowledgeSummary {
  id: string;
  title: string;
  type: string;
  serviceName: string | null;
  snippet: string;
  updatedAt: string;
}

interface CommunicationRow {
  id: string;
  demandId: string | null;
  subject: string;
  body: string;
  authorName: string;
  createdAt: string;
}

/* ----------------------------- Component ----------------------------- */

export default function Dashboard() {
  const { navigate } = useApp();

  // Blended overview + tickets stats (new split endpoints).
  const overviewQ = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiGet<OverviewResponse>('/api/stats/overview'),
    staleTime: 30_000,
  });
  const ticketStatsQ = useQuery({
    queryKey: ['stats', 'tickets'],
    queryFn: () => apiGet<TicketsStatsResponse>('/api/stats/tickets'),
    staleTime: 30_000,
  });

  // Legacy /api/stats (kept as a backward-compatible aggregator — provides
  // slaByService + recentActivity + pipeline).
  const statsQ = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet<StatsResponse>('/api/stats'),
    staleTime: 30_000,
  });

  const demandsQ = useQuery({
    queryKey: ['demands', 'mine'],
    queryFn: () => apiGet<Demand[]>('/api/demands?mine=1'),
  });
  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });
  const slaEventsQ = useQuery({
    queryKey: ['sla-events'],
    queryFn: () => apiGet<SlaEvent[]>('/api/sla-events'),
  });

  // Tickets — open + waiting-customer subsets (used by the operational panels).
  const openTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'customer-dashboard', 'open'],
    queryFn: () =>
      apiGet<Ticket[]>(
        '/api/tickets?status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER&sort=sla',
    ),
    staleTime: 30_000,
  });
  const waitingTicketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'customer-dashboard', 'waiting'],
    queryFn: () => apiGet<Ticket[]>('/api/tickets?status=WAITING_CUSTOMER'),
    staleTime: 30_000,
  });

  // Recent support messages — communications addressed TO this customer.
  const commsQ = useQuery<CommunicationRow[]>({
    queryKey: ['communications', 'recent'],
    queryFn: () => apiGet<CommunicationRow[]>('/api/communications'),
    staleTime: 60_000,
  });

  // Recommended knowledge — three most recently published articles.
  const knowledgeQ = useQuery<KnowledgeSummary[]>({
    queryKey: ['knowledge', 'recommended'],
    queryFn: () =>
      apiGet<KnowledgeSummary[]>('/api/knowledge?status=PUBLISHED&summary=1'),
    staleTime: 60_000,
  });

  const demands = demandsQ.data ?? [];
  const services = servicesQ.data ?? [];
  const slaEvents = slaEventsQ.data ?? [];
  const stats = statsQ.data;
  const overview = overviewQ.data;
  const ticketStats = ticketStatsQ.data;
  const openTickets = openTicketsQ.data ?? [];
  const waitingTickets = waitingTicketsQ.data ?? [];
  const comms = commsQ.data ?? [];
  const knowledge = knowledgeQ.data ?? [];

  const pendingDemands = useMemo(
    () =>
      demands
        .filter((d) => d.status === 'QUOTED')
        .sort((a, b) => (b.quotedAt ?? '').localeCompare(a.quotedAt ?? '')),
    [demands],
  );

  const slaHealthByService = useMemo(() => {
    const map = new Map<string, { health: SlaHealth; warnings: number; breaches: number }>();
    for (const ev of slaEvents) {
      const cur = map.get(ev.serviceId) ?? { health: 'green' as SlaHealth, warnings: 0, breaches: 0 };
      if (ev.eventType === 'BREACHED') {
        cur.breaches += 1;
        cur.health = 'red';
      } else if (ev.eventType === 'WARNING' && cur.health !== 'red') {
        cur.warnings += 1;
        cur.health = 'amber';
      }
      map.set(ev.serviceId, cur);
    }
    return map;
  }, [slaEvents]);

  const recentActivity = stats?.recentActivity ?? [];

  const myOpenTicketCount = overview?.totalOpenTickets ?? openTickets.length;
  const waitingCustomerCount =
    ticketStats?.waitingCustomer ?? waitingTickets.length;
  const slaBreaches = overview?.slaBreaches ?? stats?.slaBreaches ?? 0;
  const slaWarnings = overview?.slaWarnings ?? stats?.slaWarnings ?? 0;
  const totalDemands = overview?.totalActiveDemands ?? stats?.totalDemands ?? demands.length;

  const loading = demandsQ.isLoading || statsQ.isLoading;

  const slaHealthRows = useMemo(() => {
    if (stats?.slaByService && stats.slaByService.length > 0) {
      return stats.slaByService.map((s) => ({
        id: s.serviceId,
        name: s.serviceName,
        slaClass: s.slaClass as Service['slaClass'],
        health: s.health,
        detail: s.events > 0 ? `${s.events} active event(s)` : 'No active events',
      }));
    }
    return services.map((s) => {
      const h = slaHealthByService.get(s.id);
      return {
        id: s.id,
        name: s.name,
        slaClass: s.slaClass,
        health: (h?.health ?? 'green') as SlaHealth,
        detail: h?.breaches ? `${h.breaches} breach(es)` : h?.warnings ? `${h.warnings} warning(s)` : 'No active events',
      };
    });
  }, [stats, services, slaHealthByService]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your service operations overview — tickets, demands, SLA posture, and recommended knowledge."
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <Button onClick={() => navigate('submit-demand')} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Demand
          </Button>
        }
      />

      {/* Operational stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="My Open Tickets"
          value={loading ? '—' : myOpenTicketCount}
          icon={<Inbox className="h-4 w-4" />}
          hint="Tickets raised by your org still in flight"
          tone={myOpenTicketCount > 0 ? 'warning' : 'default'}
          onClick={() => navigate('tickets')}
        />
        <StatCard
          label="Waiting for My Response"
          value={loading ? '—' : waitingCustomerCount}
          icon={<Clock className="h-4 w-4" />}
          hint="Tickets paused until you reply"
          tone={waitingCustomerCount > 0 ? 'warning' : 'default'}
          onClick={() => navigate('tickets')}
        />
        <StatCard
          label="SLA Breached"
          value={loading ? '—' : slaBreaches}
          icon={<ShieldAlert className="h-4 w-4" />}
          hint="Targets missed on your services"
          tone={slaBreaches > 0 ? 'danger' : 'success'}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="SLA At Risk"
          value={loading ? '—' : slaWarnings}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint="Approaching threshold — action now"
          tone={slaWarnings > 0 ? 'warning' : 'success'}
          onClick={() => navigate('sla')}
        />
        <StatCard
          label="My Active Demands"
          value={loading ? '—' : totalDemands}
          icon={<FileText className="h-4 w-4" />}
          hint="All demands you have submitted"
          onClick={() => navigate('demands')}
        />
      </div>

      {/* My Open Tickets + Waiting for My Response */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="My Open Tickets"
          description="Tickets raised by your organisation that are still open — sorted by SLA due date."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('tickets')} className="gap-1">
              All tickets <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {openTicketsQ.isLoading ? (
            <LoadingState rows={3} />
          ) : openTickets.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="No open tickets"
              description="Raise a ticket from the service catalog when you need help."
            />
          ) : (
            <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
              {openTickets.slice(0, 8).map((t) => (
                <li
                  key={t.id}
                  className="py-2.5 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
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
                        {t.serviceName ?? 'General'} · {t.status.replace(/_/g, ' ').toLowerCase()}
                      </div>
                    </div>
                    <SlaStatusPill ticket={t} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Waiting for My Response"
          description="Tickets paused until you reply — your response unblocks SLA clocks."
          actions={
            waitingCustomerCount > 0 ? (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {waitingCustomerCount} waiting
              </Badge>
            ) : null
          }
        >
          {waitingTickets.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="Nothing waiting on you"
              description="Tickets needing your response will appear here."
            />
          ) : (
            <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
              {waitingTickets.map((t) => (
                <li
                  key={t.id}
                  className="py-2.5 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
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
                        {t.serviceName ?? 'General'} · waiting since{' '}
                        <RelativeTime date={t.updatedAt} />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('ticket-detail', { id: t.id });
                      }}
                    >
                      Reply
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Demand pipeline */}
      <SectionCard
        title="Demand Pipeline"
        description="Your demands grouped by lifecycle stage. Click a card to open details."
      >
        {demandsQ.isLoading ? (
          <LoadingState rows={3} />
        ) : demands.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No demands yet"
            description="Submit your first demand to start the SCM engagement workflow."
            action={
              <Button onClick={() => navigate('submit-demand')} className="gap-2">
                <PlusCircle className="h-4 w-4" /> New Demand
              </Button>
            }
          />
        ) : (
          <PipelineLanes
            demands={demands}
            onSelect={(d) => navigate('demand-detail', { id: d.id })}
          />
        )}
      </SectionCard>

      {/* Pending My Action + Recent Support Messages */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Pending My Action"
          description="Quotes awaiting your accept or decline decision."
          actions={
            pendingDemands.length > 0 ? (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {pendingDemands.length} pending
              </Badge>
            ) : null
          }
        >
          {pendingDemands.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="Nothing pending"
              description="You have no quotes awaiting your decision right now."
            />
          ) : (
            <ul className="divide-y">
              {pendingDemands.map((d) => (
                <li
                  key={d.id}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate('demand-detail', { id: d.id })}
                        className="text-sm font-medium hover:text-primary hover:underline text-left truncate"
                      >
                        {d.title}
                      </button>
                      <DemandStatusBadge status={d.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <UserAvatar name={d.assignedScmWorkerName ?? 'Unassigned'} size="sm" />
                        {d.assignedScmWorkerName ?? 'Unassigned'}
                      </span>
                      {d.quotedAt && (
                        <span className="inline-flex items-center gap-1">
                          Quoted <FormattedDate date={d.quotedAt} />
                        </span>
                      )}
                      {d.estimatedEffortDays != null && <Days value={d.estimatedEffortDays} />}
                      {d.estimatedCost != null && <Money value={d.estimatedCost} />}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('demand-detail', { id: d.id })}
                    className="gap-1 shrink-0"
                  >
                    Review Quote <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent Support Messages"
          description="Latest communications sent to your organisation by the SCM team."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('demands')} className="gap-1">
              All threads <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {comms.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" />}
              title="No messages yet"
              description="Communications from your SCM team will surface here."
            />
          ) : (
            <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
              {comms.slice(0, 6).map((c) => (
                <li
                  key={c.id}
                  className="py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                  onClick={() => c.demandId && navigate('demand-detail', { id: c.demandId })}
                >
                  <div className="flex items-start gap-3">
                    <UserAvatar name={c.authorName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium truncate">{c.subject}</p>
                        <RelativeTime date={c.createdAt} className="text-xs text-muted-foreground shrink-0" />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.body}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/80">from {c.authorName}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* SLA Health + Recommended Knowledge */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="SLA Health"
          description="Per-service health across your entitled catalog."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('sla')} className="gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {servicesQ.isLoading && !stats?.slaByService ? (
            <LoadingState rows={4} />
          ) : slaHealthRows.length === 0 ? (
            <EmptyState
              icon={<HeartPulse className="h-8 w-8" />}
              title="No entitled services"
              description="Your organisation has no active service entitlements yet."
            />
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
              {slaHealthRows.map((s) => (
                <li
                  key={s.id}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => navigate('catalog')}
                      className="text-sm font-medium hover:text-primary hover:underline text-left truncate block"
                    >
                      {s.name}
                    </button>
                    <p className="text-xs text-muted-foreground truncate">{s.detail}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SlaClassBadge slaClass={s.slaClass} />
                    <SlaHealthBadge health={s.health} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recommended Knowledge"
          description="Recently published articles from the knowledge base."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('knowledge')} className="gap-1">
              Browse all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {knowledgeQ.isLoading ? (
            <LoadingState rows={3} />
          ) : knowledge.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title="No articles published"
              description="Knowledge articles will appear here as they are published."
            />
          ) : (
            <ul className="space-y-2">
              {knowledge.slice(0, 3).map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border p-3 hover:border-primary/40 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => navigate('knowledge')}
                >
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{a.title}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.snippet}</p>
                  {a.serviceName && (
                    <p className="mt-1 text-[11px] text-muted-foreground/80">{a.serviceName}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Recent Activity */}
      <SectionCard
        title="Recent Activity"
        description="Latest events across your demands."
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('demands')} className="gap-1">
            All demands <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {recentActivity.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No recent activity"
            description="Events from your submitted demands will appear here."
          />
        ) : (
          <ol className="relative space-y-3">
            {recentActivity.map((e, i) => (
              <li key={e.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full mt-1.5',
                      i === 0 ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                  />
                  {i < recentActivity.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="flex-1 pb-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      onClick={() => navigate('demand-detail', { id: e.demandId })}
                      className="text-sm font-medium hover:text-primary hover:underline text-left truncate"
                    >
                      {e.demandTitle || 'Untitled demand'}
                    </button>
                    <RelativeTime date={e.createdAt} className="text-xs text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">
                    {e.eventType.toLowerCase().replace(/_/g, ' ')} · by {e.actorName}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}

/* ----------------------------- Inline helpers ----------------------------- */

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
      className={cn('inline-block h-2 w-2 rounded-full shrink-0', cls)}
      title={priority}
      aria-label={`Priority ${priority}`}
    />
  );
}

function SlaStatusPill({ ticket }: { ticket: Ticket }) {
  // Derive SLA status from ticket.slaClocks (lightweight).
  const clocks = ticket.slaClocks ?? [];
  if (clocks.length === 0) {
    return <span className="text-[10px] text-muted-foreground">No SLA</span>;
  }
  const hasBreached = clocks.some((c) => c.status === 'BREACHED');
  const hasRunning = clocks.some((c) => c.status === 'RUNNING');
  if (hasBreached) {
    return (
      <Badge
        variant="outline"
        className="border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 text-[10px]"
      >
        Breached
      </Badge>
    );
  }
  if (hasRunning) {
    const soonest = clocks
      .filter((c) => c.status === 'RUNNING' && c.dueAt)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
    if (!soonest) {
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          On track
        </Badge>
      );
    }
    const dueMs = new Date(soonest.dueAt).getTime();
    const diffH = (dueMs - Date.now()) / 3_600_000;
    if (diffH <= 2) {
      return (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px]"
        >
          Due {Math.max(0, Math.round(diffH))}h
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Due {Math.round(diffH)}h
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-300">
      Met
    </Badge>
  );
}

/* ---------------- Inline Pipeline Lanes Widget ---------------- */

function PipelineLanes({
  demands,
  onSelect,
}: {
  demands: Demand[];
  onSelect: (d: Demand) => void;
}) {
  const byStatus = useMemo(() => {
    const map = new Map<string, Demand[]>();
    for (const s of DEMAND_PIPELINE) map.set(s, []);
    for (const d of demands) {
      const arr = map.get(d.status);
      if (arr) arr.push(d);
    }
    return map;
  }, [demands]);

  const terminal = demands.filter(
    (d) => d.status === 'CLOSED' || d.status === 'REJECTED' || d.status === 'REDIRECTED',
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {DEMAND_PIPELINE.map((status) => {
          const items = byStatus.get(status) ?? [];
          return (
            <div key={status} className="flex flex-col rounded-lg border bg-muted/30 min-h-[160px]">
              <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DEMAND_STATUS_LABELS[status]}
                </span>
                <Badge variant="secondary" className="text-[10px] h-5 min-w-5 justify-center">
                  {items.length}
                </Badge>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-thin max-h-64">
                {items.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 text-center py-3">Empty</p>
                ) : (
                  items.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelect(d)}
                      className="w-full text-left rounded-md border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-2.5"
                    >
                      <p className="text-xs font-medium line-clamp-2 leading-snug">{d.title}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          <RelativeTime date={d.updatedAt} />
                        </span>
                        {d.estimatedCost != null && (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            <Money value={d.estimatedCost} />
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      {terminal.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Terminal ({terminal.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {terminal.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelect(d)}
                className="inline-flex items-center gap-2 rounded-md border bg-card hover:border-primary/40 transition-colors px-2.5 py-1.5"
              >
                <DemandStatusBadge status={d.status} className="text-[10px]" />
                <span className="text-xs font-medium truncate max-w-[200px]">{d.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
