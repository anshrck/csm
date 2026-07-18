'use client';

/**
 * ServiceTickets — Service Owner's incident/ticket view for their owned services.
 *
 * The shared `/api/tickets` route already filters to services the caller owns
 * when their role is SERVICE_OWNER. This component renders a tailored command
 * surface with KPIs and a sortable DataTable focused on incident oversight.
 *
 * KPI strip: Open Incidents on My Services, SLA Breaches, P1/P2 Count, Avg Resolution.
 * DataTable: ticket number, title, priority, status, service, SLA status, assignee.
 * Click row → ticket-detail (read-only for SERVICE_OWNER).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Siren,
  ShieldAlert,
  Inbox,
  TimerReset,
  AlertOctagon,
  TrendingUp,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  type Ticket,
  type TicketStatus,
  type TicketPriority,
  type TicketType,
  type TicketSlaHealth,
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_SHORT,
  TICKET_STATUS_LABELS,
  deriveSlaHealth,
  formatMins,
} from '@/lib/tickets';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  DataTable,
  type Column,
  Badge,
} from '@/components/shared';
import { AgingBadge, OverdueSlaIndicator } from '@/components/workspaces/shared/QueueControls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const statusStyles: Record<TicketStatus, string> = {
  NEW: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  TRIAGED: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  ASSIGNED: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
  IN_PROGRESS: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  WAITING_CUSTOMER: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  RESOLVED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  CLOSED: 'bg-muted text-muted-foreground border-border',
  CANCELED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium border text-xs', statusStyles[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

const priorityStyles: Record<TicketPriority, string> = {
  P1: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  P2: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  P3: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  P4: 'bg-muted text-muted-foreground border-border',
};

function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge variant="outline" className={cn('font-semibold border text-xs tabular-nums', priorityStyles[priority])}>
      {TICKET_PRIORITY_SHORT[priority]}
    </Badge>
  );
}

const slaHealthMeta: Record<TicketSlaHealth, { label: string; cls: string }> = {
  on_track: { label: 'On track', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300' },
  at_risk: { label: 'At risk', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  breached: { label: 'Breached', cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300' },
  met: { label: 'Met', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  none: { label: 'No SLA', cls: 'bg-muted text-muted-foreground border-border' },
};

function SlaHealthPill({ health }: { health: TicketSlaHealth }) {
  const meta = slaHealthMeta[health];
  return (
    <Badge variant="outline" className={cn('font-medium border text-[11px]', meta.cls)}>
      {meta.label}
    </Badge>
  );
}

const STATUS_OPTIONS: TicketStatus[] = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'CANCELED',
];
const PRIORITY_OPTIONS: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];
const TYPE_OPTIONS: TicketType[] = ['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT'];

export default function ServiceTickets() {
  const { navigate } = useApp();

  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<TicketType | 'all'>('INCIDENT');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Build the query string — the API auto-scopes to owned services for SERVICE_OWNER.
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '500', sort: 'recent' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (serviceFilter !== 'all') params.set('serviceId', serviceFilter);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [statusFilter, priorityFilter, typeFilter, serviceFilter, search]);

  const ticketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', 'service-incidents', queryString],
    queryFn: () => apiGet<Ticket[]>(`/api/tickets?${queryString}`),
    staleTime: 15_000,
  });

  const tickets = ticketsQ.data ?? [];

  // Distinct services (for the service filter dropdown).
  const services = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (t.serviceId && t.serviceName) map.set(t.serviceId, t.serviceName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tickets]);

  // ---- KPI strip ----------------------------------------------------------
  const kpis = useMemo(() => {
    const openIncidents = tickets.filter(
      (t) => t.type === 'INCIDENT' && !['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status),
    ).length;
    const breaches = tickets.filter((t) =>
      (t.slaClocks ?? []).some((c) => c.status === 'BREACHED'),
    ).length;
    const highPriority = tickets.filter(
      (t) => (t.priority === 'P1' || t.priority === 'P2') &&
        !['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status),
    ).length;
    const resolved = tickets.filter((t) => t.resolvedAt);
    let avgResolutionMins: number | null = null;
    if (resolved.length > 0) {
      const sumMins = resolved.reduce(
        (sum, t) =>
          sum +
          Math.max(
            0,
            Math.round(
              (new Date(t.resolvedAt as string).getTime() -
                new Date(t.createdAt).getTime()) /
                60_000,
            ),
          ),
        0,
      );
      avgResolutionMins = Math.round(sumMins / resolved.length);
    }
    return { openIncidents, breaches, highPriority, avgResolutionMins };
  }, [tickets]);

  const hasFilters =
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    typeFilter !== 'all' ||
    serviceFilter !== 'all' ||
    search.trim().length > 0;

  // ---- Columns ------------------------------------------------------------
  const columns: Column<Ticket>[] = useMemo(
    () => [
      {
        key: 'number',
        header: 'Number',
        render: (t) => <span className="font-mono text-xs font-medium text-primary">{t.number}</span>,
        headerClassName: 'w-28',
        className: 'w-28',
      },
      {
        key: 'title',
        header: 'Title',
        render: (t) => (
          <div className="min-w-0 max-w-[320px]">
            <div className="font-medium text-sm truncate">{t.title}</div>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <AgingBadge createdAt={t.createdAt} />
              {t.serviceCustomerName && (
                <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                  · {t.serviceCustomerName}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'priority',
        header: 'Priority',
        render: (t) => <TicketPriorityBadge priority={t.priority} />,
        headerClassName: 'w-20',
        className: 'w-20',
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => <TicketStatusBadge status={t.status} />,
        headerClassName: 'w-32',
        className: 'w-32',
      },
      {
        key: 'service',
        header: 'Service',
        render: (t) => (
          <span className="text-xs">{t.serviceName ?? <span className="text-muted-foreground">—</span>}</span>
        ),
        headerClassName: 'w-44',
        className: 'w-44',
      },
      {
        key: 'sla',
        header: 'SLA Status',
        render: (t) => {
          const health = deriveSlaHealth(t.slaClocks);
          const breached = (t.slaClocks ?? []).some((c) => c.status === 'BREACHED');
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <SlaHealthPill health={health} />
              {breached && <OverdueSlaIndicator overdue label="SLA overdue" />}
            </div>
          );
        },
        headerClassName: 'w-44',
        className: 'w-44',
      },
      {
        key: 'assignee',
        header: 'Assignee',
        render: (t) =>
          t.assignedUserName ? (
            <div className="flex items-center gap-1.5">
              <UserAvatar name={t.assignedUserName} size="sm" />
              <span className="text-xs truncate max-w-[100px]">{t.assignedUserName}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Unassigned</span>
          ),
        headerClassName: 'w-40',
        className: 'w-40',
      },
      {
        key: 'created',
        header: 'Created',
        render: (t) => (
          <div className="text-xs text-muted-foreground">
            <RelativeTime date={t.createdAt} />
          </div>
        ),
        headerClassName: 'w-28 text-right',
        className: 'w-28 text-right',
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Incidents"
        description="Tickets raised against the services you own. Read-only oversight of triage, SLA performance, and resolution activity — coordinate with the SCM Worker or CM Leader for any change."
        icon={<Siren className="h-5 w-5" />}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Open Incidents"
          value={kpis.openIncidents}
          hint="Incidents not yet resolved/closed on my services"
          icon={<Inbox className="h-4 w-4" />}
        />
        <StatCard
          label="SLA Breaches"
          value={kpis.breaches}
          hint="Tickets with ≥1 BREACHED clock"
          tone={kpis.breaches > 0 ? 'danger' : 'success'}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <StatCard
          label="P1 / P2 Open"
          value={kpis.highPriority}
          hint="Critical & high priority, not yet resolved"
          tone={kpis.highPriority > 0 ? 'warning' : 'success'}
          icon={<AlertOctagon className="h-4 w-4" />}
        />
        <StatCard
          label="Avg Resolution"
          value={kpis.avgResolutionMins == null ? '—' : formatMins(kpis.avgResolutionMins)}
          hint="Mean time-to-resolve across resolved tickets"
          icon={<TimerReset className="h-4 w-4" />}
        />
      </div>

      <SectionCard
        title="Ticket list"
        description="Filtered to services where you are the Service Owner."
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Input
            placeholder="Search by title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-xs"
          />

          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as TicketType | 'all')}
          >
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>{TICKET_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as TicketStatus | 'all')}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{TICKET_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={priorityFilter}
            onValueChange={(v) => setPriorityFilter(v as TicketPriority | 'all')}
          >
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITY_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>{TICKET_PRIORITY_SHORT[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={serviceFilter}
            onValueChange={setServiceFilter}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {ticketsQ.isLoading ? (
          <LoadingState rows={6} />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<Siren className="h-10 w-10 text-muted-foreground/50" />}
            title={hasFilters ? 'No tickets match your filters' : 'No tickets on your services'}
            description={
              hasFilters
                ? 'Try adjusting your filters.'
                : 'No tickets have been raised against the services you own. New tickets will appear here automatically.'
            }
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Showing {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
            </p>
            <DataTable
              columns={columns}
              rows={tickets}
              onRowClick={(t) => navigate('ticket-detail', { id: t.id })}
              empty="No matching tickets."
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}
