'use client';

/**
 * ServiceIncidents — Service Owner's incident command queue.
 *
 * Surfaces every ticket on the services you own with dense SLA-aware columns
 * and one-click queue presets:
 *   - Active P1/P2
 *   - SLA Breached
 *   - Due in Next Hour
 *   - Waiting Customer
 *   - Reopened
 *   - Unassigned
 *   - Major Incident Candidates
 *
 * Owner-specific actions are surfaced per-row and via the row-action menu:
 *   - Watch ticket (toast)
 *   - Add internal owner note (CommentThread in ticket-detail)
 *   - Request update (toast / POST communication)
 *   - Authorize emergency response (BreachResponseDialog)
 *   - Link to problem (EntityLinks in ticket-detail)
 *
 * Row click → navigate('ticket-detail', { id: ticket.id }).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Siren,
  ShieldAlert,
  Inbox,
  TimerReset,
  AlertOctagon,
  Eye,
  MessageSquarePlus,
  RefreshCw,
  Zap,
  Link2,
  Filter,
  RotateCcw,
  Bookmark,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  DataTable,
  Badge,
  Button,
  type Column,
} from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  Ticket,
  TicketStatus,
  TicketPriority,
  TicketType,
  TicketSlaHealth,
} from '@/lib/tickets';
import {
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_SHORT,
  TICKET_STATUS_LABELS,
  deriveSlaHealth,
  formatMins,
} from '@/lib/tickets';
import type { SlaClockRow } from '@/lib/tickets';
import { AgingBadge, OverdueSlaIndicator } from '@/components/workspaces/shared/QueueControls';

import { useOwnerServices } from './_hooks';
import { SlaClockBadge } from './_components/SlaClockBadge';
import { BreachResponseDialog } from './_components/BreachResponseDialog';

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

const priorityStyles: Record<TicketPriority, string> = {
  P1: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  P2: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  P3: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  P4: 'bg-muted text-muted-foreground border-border',
};

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium border text-[11px]', statusStyles[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge variant="outline" className={cn('font-semibold border text-[11px] tabular-nums', priorityStyles[priority])}>
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

/* ----------------------------- Queue presets ----------------------------- */

interface QueuePreset {
  id: string;
  label: string;
  description: string;
  apply: (filters: Filters) => Filters;
  icon: React.ReactNode;
  tone: 'default' | 'danger' | 'warning';
}

const PRESETS: QueuePreset[] = [
  {
    id: 'active-p1p2',
    label: 'Active P1 / P2',
    description: 'Critical & high priority, not yet resolved',
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    tone: 'danger',
    apply: (f) => ({ ...f, priority: 'P1,P2', status: 'NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER', slaStatus: 'all' }),
  },
  {
    id: 'sla-breached',
    label: 'SLA Breached',
    description: 'Tickets with ≥1 BREACHED clock',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    tone: 'danger',
    apply: (f) => ({ ...f, slaStatus: 'BREACHED', status: 'all', priority: 'all' }),
  },
  {
    id: 'due-next-hour',
    label: 'Due in Next Hour',
    description: 'RUNNING clocks with ≤60 min remaining',
    icon: <TimerReset className="h-3.5 w-3.5" />,
    tone: 'warning',
    apply: (f) => ({ ...f, slaStatus: 'AT_RISK', status: 'all', priority: 'all' }),
  },
  {
    id: 'waiting-customer',
    label: 'Waiting Customer',
    description: 'Tickets paused on customer response',
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    tone: 'default',
    apply: (f) => ({ ...f, status: 'WAITING_CUSTOMER', priority: 'all', slaStatus: 'all' }),
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    description: 'Tickets with no assignee',
    icon: <Inbox className="h-3.5 w-3.5" />,
    tone: 'default',
    apply: (f) => ({ ...f, status: 'NEW,TRIAGED', priority: 'all', slaStatus: 'all' }),
  },
  {
    id: 'major-candidates',
    label: 'Major Incident Candidates',
    description: 'P1 incidents, in-progress or newer',
    icon: <Siren className="h-3.5 w-3.5" />,
    tone: 'danger',
    apply: (f) => ({ ...f, type: 'INCIDENT', priority: 'P1', status: 'NEW,TRIAGED,ASSIGNED,IN_PROGRESS', slaStatus: 'all' }),
  },
];

interface Filters {
  serviceId: string;
  priority: string;
  status: string;
  type: string;
  customerId: string;
  slaStatus: string;
  age: string;
  search: string;
}

const DEFAULT_FILTERS: Filters = {
  serviceId: 'all',
  priority: 'all',
  status: 'all',
  type: 'all',
  customerId: 'all',
  slaStatus: 'all',
  age: 'all',
  search: '',
};

/* ------------------------------- Component ------------------------------- */

export default function ServiceIncidents() {
  const { navigate } = useApp();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [breachTarget, setBreachTarget] = useState<{
    serviceId: string;
    slaEventId: string;
    serviceName: string;
    ticketNumber: string;
  } | null>(null);

  const servicesQ = useOwnerServices();

  // ---- fetch tickets (auto-scoped to owned services by the API) ----
  const ticketsQ = useQuery<Ticket[]>({
    queryKey: ['owner-incidents', 'all'],
    queryFn: () => apiGet<Ticket[]>('/api/tickets?limit=500&sort=recent'),
    staleTime: 15_000,
  });

  // ---- fetch SLA clocks for the same scope ----
  const clocksQ = useQuery<SlaClockRow[]>({
    queryKey: ['owner-incidents', 'clocks'],
    queryFn: () => apiGet<SlaClockRow[]>('/api/sla-clocks'),
    staleTime: 15_000,
  });

  const tickets = ticketsQ.data ?? [];
  const clocks = clocksQ.data ?? [];
  const services = servicesQ.data ?? [];

  // Map ticketId → clocks for quick SLA lookup.
  const clocksByTicket = useMemo(() => {
    const m = new Map<string, SlaClockRow[]>();
    for (const c of clocks) {
      const arr = m.get(c.ticketId) ?? [];
      arr.push(c);
      m.set(c.ticketId, arr);
    }
    return m;
  }, [clocks]);

  // Distinct services + customers for filter dropdowns.
  const serviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (t.serviceId && t.serviceName) map.set(t.serviceId, t.serviceName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tickets]);

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (t.serviceCustomerId && t.serviceCustomerName) {
        map.set(t.serviceCustomerId, t.serviceCustomerName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tickets]);

  // ---- client-side filtering ----
  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (filters.serviceId !== 'all' && t.serviceId !== filters.serviceId) return false;
      if (filters.priority !== 'all' && !filters.priority.split(',').includes(t.priority)) return false;
      if (filters.status !== 'all' && !filters.status.split(',').includes(t.status)) return false;
      if (filters.type !== 'all' && t.type !== filters.type) return false;
      if (filters.customerId !== 'all' && t.serviceCustomerId !== filters.customerId) return false;
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        if (
          !t.title.toLowerCase().includes(q) &&
          !t.number.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      // SLA status filter
      if (filters.slaStatus !== 'all') {
        const tClocks = clocksByTicket.get(t.id) ?? [];
        if (filters.slaStatus === 'BREACHED') {
          if (!tClocks.some((c) => c.status === 'BREACHED')) return false;
        } else if (filters.slaStatus === 'AT_RISK') {
          if (
            !tClocks.some(
              (c) =>
                c.status === 'RUNNING' &&
                c.percentRemaining !== null &&
                c.percentRemaining <= 25,
            )
          ) {
            return false;
          }
        } else if (filters.slaStatus === 'RUNNING') {
          if (!tClocks.some((c) => c.status === 'RUNNING')) return false;
        } else if (filters.slaStatus === 'MET') {
          if (!tClocks.every((c) => c.status === 'MET') || tClocks.length === 0) return false;
        }
      }
      // Age filter
      if (filters.age !== 'all') {
        const ageDays = Math.floor(
          (Date.now() - new Date(t.createdAt).getTime()) / 86400000,
        );
        if (filters.age === '0-1' && ageDays > 1) return false;
        if (filters.age === '2-3' && (ageDays < 2 || ageDays > 3)) return false;
        if (filters.age === '4-7' && (ageDays < 4 || ageDays > 7)) return false;
        if (filters.age === '7+' && ageDays < 7) return false;
      }
      return true;
    });
  }, [tickets, filters, clocksByTicket]);

  // ---- KPI strip ----
  const kpis = useMemo(() => {
    const openIncidents = tickets.filter(
      (t) =>
        t.type === 'INCIDENT' &&
        !['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status),
    ).length;
    const breaches = tickets.filter((t) =>
      (clocksByTicket.get(t.id) ?? []).some((c) => c.status === 'BREACHED'),
    ).length;
    const highPriority = tickets.filter(
      (t) =>
        (t.priority === 'P1' || t.priority === 'P2') &&
        !['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status),
    ).length;
    const unassigned = tickets.filter(
      (t) => !t.assignedUserId && !['RESOLVED', 'CLOSED', 'CANCELED'].includes(t.status),
    ).length;
    const waiting = tickets.filter((t) => t.status === 'WAITING_CUSTOMER').length;
    const atRisk = tickets.filter((t) =>
      (clocksByTicket.get(t.id) ?? []).some(
        (c) =>
          c.status === 'RUNNING' &&
          c.percentRemaining !== null &&
          c.percentRemaining <= 25,
      ),
    ).length;
    return { openIncidents, breaches, highPriority, unassigned, waiting, atRisk };
  }, [tickets, clocksByTicket]);

  const hasFilters =
    filters.serviceId !== 'all' ||
    filters.priority !== 'all' ||
    filters.status !== 'all' ||
    filters.type !== 'all' ||
    filters.customerId !== 'all' ||
    filters.slaStatus !== 'all' ||
    filters.age !== 'all' ||
    filters.search.trim().length > 0;

  const applyPreset = (preset: QueuePreset) => {
    setActivePreset(preset.id);
    setFilters(preset.apply({ ...DEFAULT_FILTERS, serviceId: filters.serviceId }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setActivePreset(null);
  };

  // ---- columns ----
  const columns: Column<Ticket>[] = useMemo(
    () => [
      {
        key: 'number',
        header: 'Number',
        render: (t) => (
          <span className="font-mono text-xs font-medium text-primary">{t.number}</span>
        ),
        headerClassName: 'w-28',
        className: 'w-28',
      },
      {
        key: 'title',
        header: 'Title',
        render: (t) => (
          <div className="min-w-0 max-w-[280px]">
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
        key: 'service',
        header: 'Service',
        render: (t) => (
          <span className="text-xs truncate max-w-[140px] block">
            {t.serviceName ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
        headerClassName: 'w-36',
        className: 'w-36',
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
        key: 'assignee',
        header: 'Assigned',
        render: (t) =>
          t.assignedUserName ? (
            <div className="flex items-center gap-1.5">
              <UserAvatar name={t.assignedUserName} size="sm" />
              <span className="text-xs truncate max-w-[90px]">{t.assignedUserName}</span>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">Unassigned</span>
          ),
        headerClassName: 'w-36',
        className: 'w-36',
      },
      {
        key: 'responseSla',
        header: 'Response SLA',
        render: (t) => {
          const tClocks = clocksByTicket.get(t.id) ?? [];
          const response = tClocks.find((c) => c.type === 'RESPONSE');
          if (!response) return <span className="text-[11px] text-muted-foreground">—</span>;
          return (
            <div className="flex flex-col gap-0.5">
              <SlaClockBadge status={response.status} />
              {response.status === 'RUNNING' && response.remainingMins != null && (
                <span
                  className={cn(
                    'text-[10px] tabular-nums',
                    response.remainingMins < 0
                      ? 'text-rose-700 dark:text-rose-300'
                      : response.remainingMins <= 60
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-muted-foreground',
                  )}
                >
                  {response.remainingMins < 0
                    ? `${formatMins(-response.remainingMins)} over`
                    : `${formatMins(response.remainingMins)} left`}
                </span>
              )}
            </div>
          );
        },
        headerClassName: 'w-32',
        className: 'w-32',
      },
      {
        key: 'resolutionSla',
        header: 'Resolution SLA',
        render: (t) => {
          const tClocks = clocksByTicket.get(t.id) ?? [];
          const resolution = tClocks.find((c) => c.type === 'RESOLUTION');
          if (!resolution) return <span className="text-[11px] text-muted-foreground">—</span>;
          return (
            <div className="flex flex-col gap-0.5">
              <SlaClockBadge status={resolution.status} />
              {resolution.status === 'RUNNING' && resolution.remainingMins != null && (
                <span
                  className={cn(
                    'text-[10px] tabular-nums',
                    resolution.remainingMins < 0
                      ? 'text-rose-700 dark:text-rose-300'
                      : resolution.remainingMins <= 60
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-muted-foreground',
                  )}
                >
                  {resolution.remainingMins < 0
                    ? `${formatMins(-resolution.remainingMins)} over`
                    : `${formatMins(resolution.remainingMins)} left`}
                </span>
              )}
            </div>
          );
        },
        headerClassName: 'w-32',
        className: 'w-32',
      },
      {
        key: 'age',
        header: 'Age',
        render: (t) => {
          const days = Math.floor(
            (Date.now() - new Date(t.createdAt).getTime()) / 86400000,
          );
          return (
            <span className="text-xs tabular-nums text-muted-foreground">
              {days === 0 ? 'today' : days === 1 ? '1d' : `${days}d`}
            </span>
          );
        },
        headerClassName: 'w-16 text-right',
        className: 'w-16 text-right',
      },
      {
        key: 'updated',
        header: 'Last update',
        render: (t) => (
          <RelativeTime date={t.updatedAt} className="text-[11px] text-muted-foreground" />
        ),
        headerClassName: 'w-24 text-right',
        className: 'w-24 text-right',
      },
      {
        key: 'actions',
        header: '',
        render: (t) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              title="Watch ticket"
              onClick={() => toast.info(`Watching ${t.number}`, { description: 'You will be notified of updates.' })}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              title="Add internal owner note"
              onClick={() => navigate('ticket-detail', { id: t.id })}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
            {(clocksByTicket.get(t.id) ?? []).some((c) => c.status === 'BREACHED') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950"
                title="Authorize emergency response"
                onClick={() =>
                  setBreachTarget({
                    serviceId: t.serviceId ?? '',
                    slaEventId: (clocksByTicket.get(t.id) ?? []).find((c) => c.status === 'BREACHED')?.id ?? '',
                    serviceName: t.serviceName ?? '',
                    ticketNumber: t.number,
                  })
                }
              >
                <Zap className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
        headerClassName: 'w-24 text-right',
        className: 'w-24 text-right',
      },
    ],
    [clocksByTicket, navigate],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Incidents"
        description="Tickets raised against the services you own. Read-only oversight of triage, SLA performance, and resolution activity — coordinate with the SCM Worker or CM Leader for any change."
        icon={<Siren className="h-5 w-5" />}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Open incidents"
          value={kpis.openIncidents}
          icon={<Inbox className="h-4 w-4" />}
          hint="Not yet resolved/closed"
        />
        <StatCard
          label="SLA breached"
          value={kpis.breaches}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={kpis.breaches > 0 ? 'danger' : 'success'}
          hint="Tickets with ≥1 breach"
        />
        <StatCard
          label="At risk"
          value={kpis.atRisk}
          icon={<TimerReset className="h-4 w-4" />}
          tone={kpis.atRisk > 0 ? 'warning' : 'default'}
          hint="≤25% SLA time remaining"
        />
        <StatCard
          label="P1 / P2 open"
          value={kpis.highPriority}
          icon={<AlertOctagon className="h-4 w-4" />}
          tone={kpis.highPriority > 0 ? 'warning' : 'success'}
          hint="Critical & high priority"
        />
        <StatCard
          label="Unassigned"
          value={kpis.unassigned}
          icon={<Inbox className="h-4 w-4" />}
          tone={kpis.unassigned > 0 ? 'warning' : 'default'}
          hint="No assignee yet"
        />
        <StatCard
          label="Waiting customer"
          value={kpis.waiting}
          icon={<RefreshCw className="h-4 w-4" />}
          tone="default"
          hint="Paused on customer"
        />
      </div>

      {/* Queue presets */}
      <SectionCard
        title="Queue presets"
        description="One-click saved filters for the most common oversight workflows."
      >
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const toneCls = {
              default: 'border-border bg-background hover:bg-muted/40',
              danger: 'border-rose-200 bg-rose-50/40 text-rose-800 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
              warning: 'border-amber-200 bg-amber-50/40 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
            }[p.tone];
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  toneCls,
                  activePreset === p.id && 'ring-2 ring-primary/40',
                )}
                title={p.description}
              >
                {p.icon}
                {p.label}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Ticket queue"
        description="Filtered to services where you are the Service Owner. Click a row to open ticket detail."
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search number / title…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="h-9 max-w-xs"
          />

          <Select
            value={filters.serviceId}
            onValueChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))}
          >
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my services</SelectItem>
              {serviceOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.priority}
            onValueChange={(v) => setFilters((f) => ({ ...f, priority: v }))}
          >
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITY_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {TICKET_PRIORITY_SHORT[p]}
                </SelectItem>
              ))}
              <SelectItem value="P1,P2">P1 + P2</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.status}
            onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          >
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {TICKET_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.type}
            onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>
                  {TICKET_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.customerId}
            onValueChange={(v) => setFilters((f) => ({ ...f, customerId: v }))}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customerOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.slaStatus}
            onValueChange={(v) => setFilters((f) => ({ ...f, slaStatus: v }))}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="SLA status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All SLA</SelectItem>
              <SelectItem value="BREACHED">Breached</SelectItem>
              <SelectItem value="AT_RISK">At risk (≤25%)</SelectItem>
              <SelectItem value="RUNNING">Running</SelectItem>
              <SelectItem value="MET">Met</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.age}
            onValueChange={(v) => setFilters((f) => ({ ...f, age: v }))}
          >
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Age" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any age</SelectItem>
              <SelectItem value="0-1">0-1 days</SelectItem>
              <SelectItem value="2-3">2-3 days</SelectItem>
              <SelectItem value="4-7">4-7 days</SelectItem>
              <SelectItem value="7+">7+ days</SelectItem>
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 text-xs"
              onClick={resetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>

        {ticketsQ.isLoading || clocksQ.isLoading ? (
          <LoadingState rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Siren className="h-10 w-10 text-muted-foreground/50" />}
            title={hasFilters ? 'No tickets match your filters' : 'No tickets on your services'}
            description={
              hasFilters
                ? 'Try adjusting your filters or selecting a different preset.'
                : 'No tickets have been raised against the services you own.'
            }
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Showing {filtered.length} of {tickets.length} ticket
              {tickets.length === 1 ? '' : 's'}
              {activePreset && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary">
                  <Bookmark className="h-3 w-3" />
                  {PRESETS.find((p) => p.id === activePreset)?.label}
                </span>
              )}
            </p>
            <DataTable
              columns={columns}
              rows={filtered}
              onRowClick={(t) => navigate('ticket-detail', { id: t.id })}
              empty="No matching tickets."
            />
          </>
        )}
      </SectionCard>

      {/* Breach response dialog */}
      {breachTarget && breachTarget.slaEventId && breachTarget.serviceId && (
        <BreachResponseDialog
          open={!!breachTarget}
          onOpenChange={(v) => !v && setBreachTarget(null)}
          serviceId={breachTarget.serviceId}
          slaEventId={breachTarget.slaEventId}
          serviceName={breachTarget.serviceName}
          breachMessage={`SLA breach on ticket ${breachTarget.ticketNumber}`}
          onSubmitted={() => setBreachTarget(null)}
        />
      )}
    </div>
  );
}
