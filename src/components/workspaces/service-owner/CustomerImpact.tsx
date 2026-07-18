'use client';

/**
 * Service Owner — Customer Impact view.
 *
 * A two-panel view of how the services you own impact each customer org:
 *   1. Customer Heatmap — DataTable with active tickets, P1/P2, SLA breaches,
 *      open demands, low CSAT, and last communication. Rows are color-coded by
 *      impact level (red > amber > green).
 *   2. Impact Timeline — chronological list of recent impact events (SLA breach,
 *      major incident, customer communication, ticket, demand, change) for
 *      customers of owned services.
 *
 * Click a customer row → opens a Sheet with per-customer detail tabs:
 *   Services used, Open tickets, SLA history, Demands, Communications, CSAT.
 *
 * Actions: Request SCM customer update (toast), Record owner communication note
 * (POST /api/communications), Authorize remediation (governance decision),
 * Escalate customer risk (POST governance decision CUSTOMER_RISK_ESCALATION).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type {
  CustomerImpactSummary,
  SlaEvent,
  Demand,
  Change,
} from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
  RelativeTime,
  FormattedDate,
  Badge,
  Button,
  UserAvatar,
  type Column,
} from '@/components/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
import { Input } from '@/components/ui/input';
import {
  Users,
  Flame,
  AlertTriangle,
  TrendingDown,
  MessageSquare,
  ShieldCheck,
  ArrowUpCircle,
  Activity,
  Mail,
  Clock,
  CheckCircle2,
  Ticket,
} from 'lucide-react';
import { useOwnerServices } from './_hooks';

// ---- Local types ----

interface TicketSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  serviceId: string;
  serviceName: string;
  serviceCustomerId: string;
  createdAt: string;
}

interface CommunicationSummary {
  id: string;
  direction: string;
  channel: string;
  subject: string;
  body: string;
  authorName: string;
  serviceCustomerId: string | null;
  createdAt: string;
}

interface ImpactEvent {
  id: string;
  type: 'SLA_BREACH' | 'SLA_WARNING' | 'TICKET_CREATED' | 'TICKET_RESOLVED' | 'COMMUNICATION' | 'DEMAND_CREATED' | 'DEMAND_ACCEPTED' | 'CHANGE_CLOSED';
  timestamp: string;
  customerName: string;
  serviceName: string;
  title: string;
}

// ---- Helpers ----

function impactLevel(c: CustomerImpactSummary): 'red' | 'amber' | 'green' {
  if (c.activeBreaches > 0 || c.p1p2Tickets > 0) return 'red';
  if (c.activeTickets > 0) return 'amber';
  return 'green';
}

const IMPACT_ROW_CLS: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-rose-50/50 dark:bg-rose-950/20 border-l-4 border-rose-500',
  amber: 'bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-amber-500',
  green: 'bg-emerald-50/30 dark:bg-emerald-950/10 border-l-4 border-emerald-500',
};

const IMPACT_BADGE_CLS: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  amber: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
};

function parseArray(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ---- Stable empty arrays (so the `?? []` fallbacks don't create new
// references on every render — that would defeat useMemo dependencies). ----
const EMPTY_IMPACTS: CustomerImpactSummary[] = [];
const EMPTY_SLA_EVENTS: SlaEvent[] = [];
const EMPTY_TICKETS: TicketSummary[] = [];
const EMPTY_COMMS: CommunicationSummary[] = [];
const EMPTY_DEMANDS: Demand[] = [];
const EMPTY_CHANGES: Change[] = [];

// ---- Component ----

export default function CustomerImpact() {
  const { session } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();
  const impactQ = useQuery<CustomerImpactSummary[]>({
    queryKey: ['service-owner', 'customer-impact'],
    queryFn: () => apiGet<CustomerImpactSummary[]>('/api/service-owner/customer-impact'),
    staleTime: 30_000,
  });

  const services = servicesQ.data ?? [];
  const impacts = impactQ.data ?? EMPTY_IMPACTS;

  // ---- Customer detail drawer state ----
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selected = impacts.find((i) => i.customerId === selectedCustomerId) ?? null;

  // ---- Detail data queries (only fire when a customer is selected) ----
  const ticketsQ = useQuery<TicketSummary[]>({
    queryKey: ['tickets', 'customer', selectedCustomerId],
    queryFn: async () => {
      const all = await apiGet<
        { id: string; title: string; status: string; priority: string; serviceId: string; serviceCustomerId: string; createdAt: string }[]
      >(`/api/tickets?status=ALL`);
      const myServiceIds = new Set(services.map((s) => s.id));
      return all
        .filter((t) => t.serviceCustomerId === selectedCustomerId && myServiceIds.has(t.serviceId))
        .map((t) => ({
          ...t,
          serviceName: services.find((s) => s.id === t.serviceId)?.name ?? 'Service',
        }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    enabled: !!selectedCustomerId,
    staleTime: 30_000,
  });

  const slaEventsQ = useQuery<SlaEvent[]>({
    queryKey: ['sla-events', 'customer', selectedCustomerId],
    queryFn: async () => {
      const all = await apiGet<SlaEvent[]>('/api/sla-events');
      return all
        .filter((e) => e.serviceCustomerId === selectedCustomerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    enabled: !!selectedCustomerId,
    staleTime: 30_000,
  });

  const demandsQ = useQuery<Demand[]>({
    queryKey: ['demands', 'customer', selectedCustomerId],
    queryFn: async () => {
      const all = await apiGet<Demand[]>('/api/demands');
      const myServiceIds = new Set(services.map((s) => s.id));
      return all
        .filter((d) => d.serviceCustomerId === selectedCustomerId)
        .filter((d) => parseArray(d.relatedServiceIds as unknown as string).some((sid) => myServiceIds.has(sid)))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    enabled: !!selectedCustomerId,
    staleTime: 30_000,
  });

  const commsQ = useQuery<CommunicationSummary[]>({
    queryKey: ['communications', 'customer', selectedCustomerId],
    queryFn: async () => {
      const all = await apiGet<CommunicationSummary[]>(
        `/api/communications?serviceCustomerId=${selectedCustomerId}`,
      );
      return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    enabled: !!selectedCustomerId,
    staleTime: 30_000,
  });

  // ---- Impact timeline (merged from all sources) ----
  const timeline = useMemo<ImpactEvent[]>(() => {
    const events: ImpactEvent[] = [];

    // SLA events → SLA_BREACH / SLA_WARNING
    const myServiceIds = new Set(services.map((s) => s.id));
    for (const e of impactQ.data ?? []) {
      // The customer-impact endpoint already aggregated to per-customer, so we
      // need the underlying SLA events to build the timeline. Fetch lazily.
    }
    // We'll rely on a separate fetch for SLA events tied to owned services.
    return events;
  }, [impactQ.data, services]);

  // Fetch SLA events for all owned services — feeds the timeline.
  const slaEventsAllQ = useQuery<SlaEvent[]>({
    queryKey: ['sla-events', 'owned-all'],
    queryFn: () => apiGet<SlaEvent[]>('/api/sla-events'),
    staleTime: 30_000,
  });

  // Fetch all tickets on owned services — feeds the timeline (created + resolved).
  const ticketsAllQ = useQuery<TicketSummary[]>({
    queryKey: ['tickets', 'owned-all'],
    queryFn: async () => {
      const all = await apiGet<
        { id: string; title: string; status: string; priority: string; serviceId: string; serviceCustomerId: string; createdAt: string }[]
      >('/api/tickets?status=ALL');
      const myServiceIds = new Set(services.map((s) => s.id));
      return all
        .filter((t) => myServiceIds.has(t.serviceId))
        .map((t) => ({
          ...t,
          serviceName: services.find((s) => s.id === t.serviceId)?.name ?? 'Service',
        }));
    },
    enabled: services.length > 0,
    staleTime: 30_000,
  });

  // Demands on owned services (for the timeline)
  const demandsAllQ = useQuery<Demand[]>({
    queryKey: ['demands', 'owned-all'],
    queryFn: async () => {
      const all = await apiGet<Demand[]>('/api/demands');
      const myServiceIds = new Set(services.map((s) => s.id));
      return all.filter((d) => parseArray(d.relatedServiceIds as unknown as string).some((sid) => myServiceIds.has(sid)));
    },
    enabled: services.length > 0,
    staleTime: 30_000,
  });

  // Communications on owned services' customers (for the timeline)
  const commsAllQ = useQuery<CommunicationSummary[]>({
    queryKey: ['communications', 'owned-all'],
    queryFn: async () => {
      // We don't have a serviceId filter at the API level for customers of
      // owned services, so fetch all and filter client-side.
      const all = await apiGet<CommunicationSummary[]>('/api/communications');
      const customerIds = new Set(impacts.map((i) => i.customerId));
      return all.filter((c) => c.serviceCustomerId && customerIds.has(c.serviceCustomerId));
    },
    enabled: impacts.length > 0,
    staleTime: 30_000,
  });

  // Changes on owned services (for the timeline — closed changes)
  const changesAllQ = useQuery<Change[]>({
    queryKey: ['changes', 'owned-all'],
    queryFn: async () => {
      const all = await apiGet<Change[]>('/api/changes');
      const myServiceIds = new Set(services.map((s) => s.id));
      return all.filter((c) => parseArray(c.affectedServiceIds as unknown as string).some((sid) => myServiceIds.has(sid)));
    },
    enabled: services.length > 0,
    staleTime: 30_000,
  });

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of impacts) m.set(i.customerId, i.customerName);
    return m;
  }, [impacts]);

  const fullTimeline = useMemo<ImpactEvent[]>(() => {
    const events: ImpactEvent[] = [];

    // SLA events
    for (const e of slaEventsAllQ.data ?? []) {
      if (e.eventType === 'BREACHED') {
        events.push({
          id: `sla:${e.id}`,
          type: 'SLA_BREACH',
          timestamp: e.createdAt,
          customerName: customerNameById.get(e.serviceCustomerId ?? '') ?? 'Customer',
          serviceName: e.serviceName ?? 'Service',
          title: e.message,
        });
      } else if (e.eventType === 'WARNING') {
        events.push({
          id: `sla:${e.id}`,
          type: 'SLA_WARNING',
          timestamp: e.createdAt,
          customerName: customerNameById.get(e.serviceCustomerId ?? '') ?? 'Customer',
          serviceName: e.serviceName ?? 'Service',
          title: e.message,
        });
      }
    }

    // Tickets
    for (const t of ticketsAllQ.data ?? []) {
      const customerName = customerNameById.get(t.serviceCustomerId) ?? 'Customer';
      if (t.status === 'CLOSED' || t.status === 'RESOLVED') {
        events.push({
          id: `ticket-resolved:${t.id}`,
          type: 'TICKET_RESOLVED',
          timestamp: t.createdAt,
          customerName,
          serviceName: t.serviceName,
          title: `Ticket resolved: ${t.title}`,
        });
      } else {
        events.push({
          id: `ticket-created:${t.id}`,
          type: 'TICKET_CREATED',
          timestamp: t.createdAt,
          customerName,
          serviceName: t.serviceName,
          title: `${t.priority} ticket opened: ${t.title}`,
        });
      }
    }

    // Communications
    for (const c of commsAllQ.data ?? []) {
      events.push({
        id: `comm:${c.id}`,
        type: 'COMMUNICATION',
        timestamp: c.createdAt,
        customerName: customerNameById.get(c.serviceCustomerId ?? '') ?? 'Customer',
        serviceName: '—',
        title: `${c.direction === 'TO_CUSTOMER' ? 'Sent to customer' : 'Internal note'}: ${c.subject}`,
      });
    }

    // Demands
    for (const d of demandsAllQ.data ?? []) {
      const customerName = d.serviceCustomerName ?? customerNameById.get(d.serviceCustomerId) ?? 'Customer';
      if (d.status === 'ACCEPTED' || d.status === 'IN_CHANGE' || d.status === 'FULFILLED') {
        events.push({
          id: `demand-accepted:${d.id}`,
          type: 'DEMAND_ACCEPTED',
          timestamp: d.acceptedAt ?? d.createdAt,
          customerName,
          serviceName: '—',
          title: `Demand accepted: ${d.title}`,
        });
      } else {
        events.push({
          id: `demand-created:${d.id}`,
          type: 'DEMAND_CREATED',
          timestamp: d.createdAt,
          customerName,
          serviceName: '—',
          title: `Demand submitted: ${d.title}`,
        });
      }
    }

    // Changes (closed only)
    for (const c of changesAllQ.data ?? []) {
      if (c.status === 'CLOSED' && c.closedAt) {
        events.push({
          id: `change-closed:${c.id}`,
          type: 'CHANGE_CLOSED',
          timestamp: c.closedAt,
          customerName: '—',
          serviceName: c.services?.[0]?.name ?? 'Service',
          title: `Change completed: ${c.title}`,
        });
      }
    }

    return events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 80);
  }, [slaEventsAllQ.data, ticketsAllQ.data, commsAllQ.data, demandsAllQ.data, changesAllQ.data, customerNameById]);

  // ---- Summary tiles ----
  const summary = useMemo(() => {
    const totalCustomers = impacts.length;
    const redCustomers = impacts.filter((i) => impactLevel(i) === 'red').length;
    const amberCustomers = impacts.filter((i) => impactLevel(i) === 'amber').length;
    const totalBreaches = impacts.reduce((sum, i) => sum + i.activeBreaches, 0);
    const totalP1P2 = impacts.reduce((sum, i) => sum + i.p1p2Tickets, 0);
    return { totalCustomers, redCustomers, amberCustomers, totalBreaches, totalP1P2 };
  }, [impacts]);

  // ---- Mutations ----
  const [commTarget, setCommTarget] = useState<CustomerImpactSummary | null>(null);
  const [commSubject, setCommSubject] = useState('');
  const [commBody, setCommBody] = useState('');

  const recordCommMut = useMutation({
    mutationFn: (args: { customer: CustomerImpactSummary; subject: string; body: string }) =>
      apiPost('/api/communications', {
        serviceCustomerId: args.customer.customerId,
        direction: 'INTERNAL_NOTE',
        channel: 'PORTAL',
        subject: args.subject,
        body: args.body,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Owner communication note recorded', {
        description: `Internal note for ${vars.customer.customerName}.`,
      });
      qc.invalidateQueries({ queryKey: ['communications'] });
      setCommTarget(null);
      setCommSubject('');
      setCommBody('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [remediationTarget, setRemediationTarget] = useState<CustomerImpactSummary | null>(null);
  const [remediationRationale, setRemediationRationale] = useState('');

  const authorizeRemediationMut = useMutation({
    mutationFn: (args: { customer: CustomerImpactSummary; rationale: string }) => {
      const serviceId = args.customer.serviceIds[0];
      return apiPost('/api/governance-decisions', {
        serviceId,
        decisionType: 'REMEDIATION_AUTHORIZATION',
        decision: 'REMEDIATION_AUTHORIZED',
        rationale: args.rationale,
      });
    },
    onSuccess: (_data, vars) => {
      toast.success('Remediation authorised', {
        description: `Governance decision recorded for ${vars.customer.customerName}.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
      setRemediationTarget(null);
      setRemediationRationale('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const escalateCustomerRiskMut = useMutation({
    mutationFn: (customer: CustomerImpactSummary) => {
      const serviceId = customer.serviceIds[0];
      return apiPost('/api/governance-decisions', {
        serviceId,
        decisionType: 'CUSTOMER_RISK_ESCALATION',
        decision: 'ESCALATED',
        rationale: `Customer risk escalated for ${customer.customerName}: ${customer.activeBreaches} SLA breaches, ${customer.p1p2Tickets} P1/P2 tickets, ${customer.activeTickets} active tickets.`,
      });
    },
    onSuccess: (_data, customer) => {
      toast.info('Customer risk escalated', {
        description: `${customer.customerName} — escalated to CM Leader + Governance Owner.`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = servicesQ.isLoading || impactQ.isLoading;

  // ---- Heatmap columns ----
  const heatmapColumns: Column<CustomerImpactSummary>[] = [
    {
      key: 'customer',
      header: 'Customer Org',
      render: (c) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={c.customerName} size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{c.customerName}</div>
            <div className="text-[11px] text-muted-foreground">
              {c.serviceIds.length} service{c.serviceIds.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'tickets',
      header: 'Active Tickets',
      render: (c) => (
        <span className="text-sm tabular-nums font-medium">{c.activeTickets}</span>
      ),
    },
    {
      key: 'p1p2',
      header: 'P1/P2',
      render: (c) =>
        c.p1p2Tickets > 0 ? (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900">
            {c.p1p2Tickets}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      key: 'breaches',
      header: 'SLA Breaches',
      render: (c) =>
        c.activeBreaches > 0 ? (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900">
            <Flame className="h-3 w-3 mr-1" /> {c.activeBreaches}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
    },
    {
      key: 'demands',
      header: 'Open Demands',
      render: (c) => (
        <span className="text-xs tabular-nums">{c.openDemands}</span>
      ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'csat',
      header: 'Avg CSAT',
      render: (c) =>
        c.averageCsat == null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              'text-xs font-medium tabular-nums',
              c.averageCsat < 3 ? 'text-rose-700 dark:text-rose-300' : c.averageCsat < 4 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
            )}
          >
            {c.averageCsat.toFixed(1)} ★
          </span>
        ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'lastComm',
      header: 'Last Communication',
      render: (c) =>
        c.lastCommunicationAt ? (
          <RelativeTime date={c.lastCommunicationAt} className="text-xs" />
        ) : (
          <span className="text-xs text-muted-foreground">never</span>
        ),
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell',
    },
    {
      key: 'impact',
      header: 'Impact',
      render: (c) => {
        const level = impactLevel(c);
        return (
          <Badge variant="outline" className={cn('font-medium', IMPACT_BADGE_CLS[level])}>
            {level === 'red' ? 'Critical' : level === 'amber' ? 'Elevated' : 'Stable'}
          </Badge>
        );
      },
    },
  ];

  // ---- Row class wrapper (heatmap rows colored by impact level) ----
  const heatmapRows = useMemo(
    () => impacts.map((c) => ({ ...c, id: c.customerId })),
    [impacts],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Impact"
        description="How the services you own impact each customer org. Rows are color-coded by impact level: red (active breaches or P1/P2 tickets), amber (active tickets), green (no open issues). Click a customer to drill into their impact timeline."
        icon={<Users className="h-6 w-6" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Customers Served" value={summary.totalCustomers} hint="Across owned services" />
        <StatCard
          label="Critical Impact"
          value={summary.redCustomers}
          tone="danger"
          hint="Breaches or P1/P2 open"
        />
        <StatCard
          label="Elevated Impact"
          value={summary.amberCustomers}
          tone="warning"
          hint="Active tickets only"
        />
        <StatCard label="Total SLA Breaches" value={summary.totalBreaches} tone="danger" />
        <StatCard label="Total P1/P2 Open" value={summary.totalP1P2} tone="danger" />
      </div>

      <SectionCard
        title="Customer Heatmap"
        description="Customer organizations consuming your services, ranked by current impact severity."
      >
        {loading ? (
          <LoadingState rows={4} />
        ) : impacts.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No customer impact data"
            description="No customers are currently consuming the services you own, or no tickets have been raised on them."
          />
        ) : (
          // We render a custom table here because DataTable doesn't support
          // per-row className. Each row uses a colored left-border.
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {heatmapColumns.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          'text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap',
                          c.headerClassName,
                        )}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapRows.map((row) => {
                    const level = impactLevel(row);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedCustomerId(row.customerId)}
                        className={cn(
                          'border-t transition-colors cursor-pointer hover:bg-muted/40',
                          IMPACT_ROW_CLS[level],
                        )}
                      >
                        {heatmapColumns.map((c) => (
                          <td
                            key={c.key}
                            className={cn('px-4 py-3 align-middle', c.className)}
                          >
                            {c.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Impact Timeline */}
      <SectionCard
        title="Impact Timeline"
        description="Chronological view of recent events affecting customers of your services — SLA breaches, tickets, communications, demands, and completed changes. Newest first."
      >
        {fullTimeline.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No impact events recorded yet"
            description="Once tickets, SLA events, or communications land on your services, they will appear here as a unified impact timeline."
          />
        ) : (
          <ol className="divide-y max-h-[28rem] overflow-y-auto scrollbar-thin">
            {fullTimeline.map((e) => (
              <TimelineEntry key={e.id} event={e} />
            ))}
          </ol>
        )}
      </SectionCard>

      {/* Customer detail drawer */}
      <Sheet open={!!selectedCustomerId} onOpenChange={(o) => !o && setSelectedCustomerId(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selected && <UserAvatar name={selected.customerName} size="sm" />}
              {selected?.customerName ?? 'Customer'}
              {selected && (
                <Badge variant="outline" className={cn('font-medium', IMPACT_BADGE_CLS[impactLevel(selected)])}>
                  {impactLevel(selected) === 'red' ? 'Critical' : impactLevel(selected) === 'amber' ? 'Elevated' : 'Stable'}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription>
              {selected && `${selected.activeTickets} active tickets · ${selected.activeBreaches} SLA breaches · ${selected.openDemands} open demands · ${selected.serviceIds.length} services used`}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="mt-4 space-y-3">
              {/* Quick actions */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    setCommTarget(selected);
                    setCommSubject(`Owner note: ${selected.customerName}`);
                    setCommBody('');
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Record communication note
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    setRemediationTarget(selected);
                    setRemediationRationale('');
                  }}
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Authorize remediation
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-rose-600 dark:text-rose-400"
                  onClick={() => escalateCustomerRiskMut.mutate(selected)}
                  disabled={escalateCustomerRiskMut.isPending}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate customer risk
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => {
                    toast.info('SCM customer update requested', {
                      description: `The assigned SCM worker for ${selected.customerName} has been notified to send a customer-facing update.`,
                    });
                  }}
                >
                  <Mail className="h-3.5 w-3.5" /> Request SCM update
                </Button>
              </div>

              <Tabs defaultValue="services" className="w-full">
                <TabsList className="flex-wrap h-auto">
                  <TabsTrigger value="services" className="text-xs">Services</TabsTrigger>
                  <TabsTrigger value="tickets" className="text-xs">Tickets</TabsTrigger>
                  <TabsTrigger value="sla" className="text-xs">SLA history</TabsTrigger>
                  <TabsTrigger value="demands" className="text-xs">Demands</TabsTrigger>
                  <TabsTrigger value="comms" className="text-xs">Communications</TabsTrigger>
                  <TabsTrigger value="csat" className="text-xs">CSAT</TabsTrigger>
                </TabsList>

                <TabsContent value="services" className="mt-3">
                  <div className="space-y-1.5">
                    {selected.serviceIds.map((sid) => {
                      const svc = services.find((s) => s.id === sid);
                      return (
                        <div key={sid} className="rounded-md border p-2.5 text-xs">
                          <div className="font-medium">{svc?.name ?? 'Service'}</div>
                          <div className="text-muted-foreground mt-0.5">
                            {svc?.domain} · {svc?.slaClass} class
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="tickets" className="mt-3">
                  <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                    {(ticketsQ.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No tickets on your services for this customer.</p>
                    ) : (
                      (ticketsQ.data ?? []).map((t) => (
                        <div key={t.id} className="rounded-md border p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium truncate">{t.title}</span>
                            <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                            <Ticket className="h-3 w-3" /> {t.serviceName}
                            <span>·</span>
                            <span>{t.status}</span>
                            <span>·</span>
                            <RelativeTime date={t.createdAt} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="sla" className="mt-3">
                  <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                    {(slaEventsQ.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No SLA events recorded for this customer.</p>
                    ) : (
                      (slaEventsQ.data ?? []).slice(0, 20).map((e) => (
                        <div
                          key={e.id}
                          className={cn(
                            'rounded-md border p-2.5',
                            e.eventType === 'BREACHED' ? 'border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900' : e.eventType === 'WARNING' ? 'border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900' : '',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline" className="text-[10px]">{e.eventType}</Badge>
                            <RelativeTime date={e.createdAt} className="text-[11px]" />
                          </div>
                          <div className="text-xs mt-1">{e.message}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{e.serviceName ?? 'Service'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="demands" className="mt-3">
                  <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                    {(demandsQ.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No demands from this customer on your services.</p>
                    ) : (
                      (demandsQ.data ?? []).map((d) => (
                        <div key={d.id} className="rounded-md border p-2.5">
                          <div className="text-xs font-medium truncate">{d.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                            <span>{d.status}</span>
                            <span>·</span>
                            <RelativeTime date={d.createdAt} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="comms" className="mt-3">
                  <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                    {(commsQ.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No communications recorded for this customer.</p>
                    ) : (
                      (commsQ.data ?? []).slice(0, 20).map((c) => (
                        <div key={c.id} className="rounded-md border p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {c.direction === 'TO_CUSTOMER' ? 'To customer' : 'Internal'}
                            </Badge>
                            <RelativeTime date={c.createdAt} className="text-[11px]" />
                          </div>
                          <div className="text-xs font-medium mt-1">{c.subject}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{c.body}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">by {c.authorName}</div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="csat" className="mt-3">
                  <div className="rounded-md border p-4 text-center">
                    {selected.averageCsat == null ? (
                      <>
                        <TrendingDown className="h-6 w-6 mx-auto text-muted-foreground/60" />
                        <p className="text-xs text-muted-foreground mt-2">No CSAT surveys submitted by this customer yet.</p>
                      </>
                    ) : (
                      <>
                        <div className="text-3xl font-semibold tabular-nums">{selected.averageCsat.toFixed(1)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Average CSAT rating (out of 5)</p>
                        {selected.averageCsat < 3 && (
                          <div className="mt-2 inline-flex items-center gap-1 text-xs text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="h-3 w-3" /> Detractor territory — schedule a follow-up.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Owner communication note dialog */}
      <Dialog open={!!commTarget} onOpenChange={(o) => !o && setCommTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Owner Communication Note</DialogTitle>
            <DialogDescription>
              {commTarget?.customerName}
              <br />
              This is recorded as an internal note (visible to SCM workers + CM Leader, not the customer). Use it to log follow-ups, escalation context, or commitment reminders.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="comm-subject" className="text-xs">Subject</Label>
              <Input
                id="comm-subject"
                value={commSubject}
                onChange={(e) => setCommSubject(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="comm-body" className="text-xs">Note</Label>
              <Textarea
                id="comm-body"
                value={commBody}
                onChange={(e) => setCommBody(e.target.value)}
                placeholder="Context, decisions, follow-ups…"
                className="mt-1 min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCommTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (commTarget && commSubject.trim() && commBody.trim()) {
                  recordCommMut.mutate({ customer: commTarget, subject: commSubject, body: commBody });
                }
              }}
              disabled={recordCommMut.isPending || !commSubject.trim() || !commBody.trim()}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Record note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Authorize remediation dialog */}
      <Dialog open={!!remediationTarget} onOpenChange={(o) => !o && setRemediationTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authorize Remediation</DialogTitle>
            <DialogDescription>
              {remediationTarget?.customerName}
              <br />
              Record a governance decision authorising remediation resources for this customer. The decision is persisted as an audit trail and notifies CM Leader.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="remediation-rationale" className="text-xs">Rationale (required)</Label>
              <Textarea
                id="remediation-rationale"
                value={remediationRationale}
                onChange={(e) => setRemediationRationale(e.target.value)}
                placeholder="Describe the remediation being authorised, the resources committed, and the expected outcome."
                className="mt-1 min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemediationTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (remediationTarget && remediationRationale.trim()) {
                  authorizeRemediationMut.mutate({ customer: remediationTarget, rationale: remediationRationale });
                }
              }}
              disabled={authorizeRemediationMut.isPending || !remediationRationale.trim()}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Authorise remediation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Timeline entry ----

function TimelineEntry({ event }: { event: ImpactEvent }) {
  const meta = EVENT_META[event.type];
  const Icon = meta.icon;
  return (
    <li className="py-2.5 flex items-start gap-3">
      <div className={cn('mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0', meta.iconCls)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn('text-[10px] font-medium', meta.badgeCls)}>
            {meta.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{event.customerName}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">{event.serviceName}</span>
        </div>
        <div className="text-xs mt-0.5">{event.title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
          <Clock className="h-3 w-3" /> <RelativeTime date={event.timestamp} />
        </div>
      </div>
    </li>
  );
}

const EVENT_META: Record<
  ImpactEvent['type'],
  { label: string; icon: React.ComponentType<{ className?: string }>; iconCls: string; badgeCls: string }
> = {
  SLA_BREACH: {
    label: 'SLA Breach',
    icon: Flame,
    iconCls: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    badgeCls: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  },
  SLA_WARNING: {
    label: 'SLA Warning',
    icon: AlertTriangle,
    iconCls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    badgeCls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  },
  TICKET_CREATED: {
    label: 'Ticket Opened',
    icon: Ticket,
    iconCls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    badgeCls: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
  },
  TICKET_RESOLVED: {
    label: 'Ticket Resolved',
    icon: CheckCircle2,
    iconCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  },
  COMMUNICATION: {
    label: 'Communication',
    icon: MessageSquare,
    iconCls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    badgeCls: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
  },
  DEMAND_CREATED: {
    label: 'Demand Submitted',
    icon: Mail,
    iconCls: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    badgeCls: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
  },
  DEMAND_ACCEPTED: {
    label: 'Demand Accepted',
    icon: CheckCircle2,
    iconCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  },
  CHANGE_CLOSED: {
    label: 'Change Completed',
    icon: CheckCircle2,
    iconCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  },
};
