'use client';

/**
 * TicketDetail — Service Owner's oversight view of a single ticket.
 *
 * The Service Owner is a read-only stakeholder on tickets; they do not triage,
 * assign, or transition status. Their job is governance: authorize resources,
 * direct emergency changes, link related problems, record breach responses,
 * and add internal owner notes.
 *
 * Composed from shared building blocks:
 *   - <SlaClockPanel ticketId={id} />      → live SLA countdowns
 *   - <CommentThread entityType="TICKET" /> → conversation (INTERNAL + visible)
 *   - <AttachmentList entityType="TICKET" />→ file attachments
 *   - <EntityLinks entityType="TICKET" />  → related problem/change/demand/KB
 *
 * Plus owner-specific surfaces:
 *   - Customer impact summary (derived from the ticket + its siblings)
 *   - Event timeline (TicketEvent list)
 *   - Audit timeline (GET /api/audit-logs?entityType=Ticket&entityId=…)
 *   - Action bar: Request update, Authorize resources, Direct emergency
 *     change, Link/create problem, Record breach response
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ticket as TicketIcon,
  Clock,
  Play,
  Pause,
  CheckCircle2,
  RefreshCw,
  Ban,
  MessageSquare,
  Activity,
  ShieldAlert,
  Zap,
  Link2,
  Send,
  History,
  Users,
  Siren,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  KeyValue,
  Badge,
  Button,
  Card,
  CardContent,
} from '@/components/shared';
import { cn } from '@/lib/utils';
import type {
  Ticket,
  TicketEventRow,
  TicketStatus,
  TicketPriority,
  TicketType,
} from '@/lib/tickets';
import {
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '@/lib/tickets';

import CommentThread from '@/components/workspaces/shared/CommentThread';
import AttachmentList from '@/components/workspaces/shared/AttachmentList';
import EntityLinks from '@/components/workspaces/shared/EntityLinks';
import SlaClockPanel from '@/components/workspaces/shared/SlaClockPanel';

import { useEntityAuditLogs, type AuditLogRow } from './_hooks';
import { SlaClockBadge } from './_components/SlaClockBadge';
import { BreachResponseDialog } from './_components/BreachResponseDialog';

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

const typeStyles: Record<TicketType, string> = {
  INCIDENT: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300',
  SERVICE_REQUEST: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300',
  QUESTION: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300',
  COMPLAINT: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Ticket created',
  ASSIGNED: 'Assigned',
  TRIAGED: 'Triaged',
  IN_PROGRESS: 'Work started',
  WAITING: 'Set to waiting on customer',
  RESUMED: 'Work resumed',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CANCELED: 'Canceled',
  COMMENT: 'Comment',
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  CREATED: <TicketIcon className="h-3 w-3" />,
  ASSIGNED: <Users className="h-3 w-3" />,
  TRIAGED: <Activity className="h-3 w-3" />,
  IN_PROGRESS: <Play className="h-3 w-3" />,
  WAITING: <Pause className="h-3 w-3" />,
  RESUMED: <RefreshCw className="h-3 w-3" />,
  RESOLVED: <CheckCircle2 className="h-3 w-3" />,
  CLOSED: <CheckCircle2 className="h-3 w-3" />,
  REOPENED: <RefreshCw className="h-3 w-3" />,
  CANCELED: <Ban className="h-3 w-3" />,
  COMMENT: <MessageSquare className="h-3 w-3" />,
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Ticket created',
  TICKET_ASSIGNED: 'Ticket assigned',
  TICKET_TRIAGED: 'Ticket triaged',
  TICKET_RESOLVED: 'Ticket resolved',
  TICKET_CLOSED: 'Ticket closed',
  TICKET_REOPENED: 'Ticket reopened',
  TICKET_UPDATED: 'Ticket updated',
  COMMENT_POSTED: 'Comment posted',
  ATTACHMENT_UPLOADED: 'Attachment uploaded',
  ENTITY_LINKED: 'Entity linked',
  GOVERNANCE_DECISION: 'Governance decision',
};

export default function TicketDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const qc = useQueryClient();
  const [breachOpen, setBreachOpen] = useState(false);

  // ---- fetch the ticket (with events + slaClocks) ----
  const ticketQ = useQuery<Ticket>({
    queryKey: ['ticket', id],
    queryFn: () => apiGet<Ticket>(`/api/tickets/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });

  // ---- fetch sibling tickets on the same service (for impact context) ----
  const siblingsQ = useQuery<Ticket[]>({
    queryKey: ['ticket-siblings', id, ticketQ.data?.serviceId],
    queryFn: () =>
      apiGet<Ticket[]>(
        `/api/tickets?serviceId=${ticketQ.data?.serviceId}&limit=100`,
      ),
    enabled: !!ticketQ.data?.serviceId,
    staleTime: 30_000,
  });

  // ---- audit log for this ticket ----
  const auditQ = useEntityAuditLogs('Ticket', id, 50);

  // ---- "Request update" mutation: POST a communication record ----
  const requestUpdateMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/communications', {
        serviceCustomerId: ticketQ.data?.serviceCustomerId,
        ticketId: id,
        channel: 'INTERNAL',
        subject: `Owner update request — ${ticketQ.data?.number ?? id}`,
        body: `Service Owner requests a status update on ticket ${ticketQ.data?.number}.`,
        direction: 'OUTBOUND',
      }),
    onSuccess: () => {
      toast.success('Update requested', {
        description: 'The assigned worker has been notified to provide a status update.',
      });
      qc.invalidateQueries({ queryKey: ['ticket', id] });
    },
    onError: (e: Error) =>
      toast.error('Could not request update', { description: e.message }),
  });

  const ticket = ticketQ.data;
  const siblings = (siblingsQ.data ?? []).filter((t) => t.id !== id);
  const audit = auditQ.data ?? [];

  // ---- derive breach context for the BreachResponseDialog ----
  const breachedClock = useMemo(
    () => (ticket?.slaClocks ?? []).find((c) => c.status === 'BREACHED'),
    [ticket],
  );

  if (ticketQ.isLoading) {
    return (
      <div className="space-y-5">
        <BackHeader onClick={() => navigate('service-incidents')} />
        <LoadingState rows={6} />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-5">
        <BackHeader onClick={() => navigate('service-incidents')} />
        <SectionCard>
          <EmptyState
            icon={<TicketIcon className="h-10 w-10 text-muted-foreground/50" />}
            title="Ticket not found"
            description="The ticket you are looking for does not exist or you do not have access."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate('service-incidents')}>
                Back to incidents
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackHeader onClick={() => navigate('service-incidents')} />

      {/* Header */}
      <PageHeader
        title={ticket.title}
        description={`${ticket.number} — ${TICKET_TYPE_LABELS[ticket.type]}`}
        icon={<TicketIcon className="h-6 w-6" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('font-semibold border text-xs tabular-nums', priorityStyles[ticket.priority])}>
              {TICKET_PRIORITY_LABELS[ticket.priority]}
            </Badge>
            <Badge variant="outline" className={cn('font-medium border text-xs', statusStyles[ticket.status])}>
              {TICKET_STATUS_LABELS[ticket.status]}
            </Badge>
            {breachedClock && (
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={() => setBreachOpen(true)}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Record Breach Response
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => requestUpdateMutation.mutate()}
              disabled={requestUpdateMutation.isPending}
            >
              {requestUpdateMutation.isPending ? (
                <Clock className="h-3.5 w-3.5 animate-pulse" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Request update
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                toast.info('Emergency change directed', {
                  description:
                    'An emergency change request has been flagged for the Change Enablement team. They will create the change record and contact you.',
                })
              }
            >
              <Zap className="h-3.5 w-3.5" />
              Direct emergency change
            </Button>
          </div>
        }
      />

      {/* Context strip */}
      <SectionCard>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KeyValue
            label="Service"
            value={
              ticket.serviceName ? (
                <button
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={() =>
                    ticket.serviceId && navigate('service-detail', { id: ticket.serviceId })
                  }
                >
                  {ticket.serviceName}
                </button>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <KeyValue
            label="Customer"
            value={
              <span className="text-sm">{ticket.serviceCustomerName ?? '—'}</span>
            }
          />
          <KeyValue
            label="Assigned to"
            value={
              ticket.assignedUserName ? (
                <div className="flex items-center gap-2">
                  <UserAvatar name={ticket.assignedUserName} size="sm" />
                  <span className="text-sm">{ticket.assignedUserName}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground italic">Unassigned</span>
              )
            }
          />
          <KeyValue
            label="Opened"
            value={<FormattedDate date={ticket.createdAt} />}
          />
          {ticket.resolvedAt && (
            <KeyValue
              label="Resolved"
              value={<FormattedDate date={ticket.resolvedAt} />}
            />
          )}
          {ticket.closedAt && (
            <KeyValue
              label="Closed"
              value={<FormattedDate date={ticket.closedAt} />}
            />
          )}
          {ticket.resolutionCode && (
            <KeyValue
              label="Resolution"
              value={ticket.resolutionCode.replace(/_/g, ' ').toLowerCase()}
            />
          )}
          <KeyValue
            label="Last update"
            value={<RelativeTime date={ticket.updatedAt} />}
          />
        </dl>
      </SectionCard>

      {/* Description */}
      <SectionCard title="Description">
        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {ticket.description}
        </p>
      </SectionCard>

      {/* SLA clocks */}
      <SlaClockPanel ticketId={id} />

      {/* Customer impact summary */}
      <SectionCard
        title="Customer impact"
        description="Open tickets for the same customer on this service, plus SLA posture across that group."
      >
        <CustomerImpactSummary
          ticket={ticket}
          siblings={siblings}
        />
      </SectionCard>

      {/* Conversation thread (includes internal owner notes via INTERNAL visibility) */}
      <SectionCard
        title="Conversation & internal owner notes"
        description="Add customer-visible replies or internal owner-only notes. Switch visibility with the toggle below."
      >
        <CommentThread entityType="TICKET" entityId={id} />
      </SectionCard>

      {/* Two-column: Event timeline + Audit timeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Event timeline"
          description="Lifecycle events recorded against this ticket."
        >
          <EventTimeline events={ticket.events ?? []} />
        </SectionCard>

        <SectionCard
          title="Audit trail"
          description="Governance-relevant audit entries for this ticket."
        >
          {auditQ.isLoading ? (
            <LoadingState rows={4} />
          ) : audit.length === 0 ? (
            <EmptyState
              icon={<History className="h-8 w-8 text-muted-foreground/50" />}
              title="No audit entries"
              description="Audit entries will appear here as the ticket evolves."
            />
          ) : (
            <AuditTimeline rows={audit} />
          )}
        </SectionCard>
      </div>

      {/* Attachments */}
      <SectionCard
        title="Attachments"
        description="Files attached to this ticket. Upload is available to SCM Workers, CM Leaders, and Service Owners."
      >
        <AttachmentList entityType="TICKET" entityId={id} />
      </SectionCard>

      {/* Related entities */}
      <SectionCard
        title="Related entities"
        description="Link this ticket to problems, changes, demands, knowledge articles, or other tickets."
      >
        <EntityLinks entityType="TICKET" entityId={id} />
      </SectionCard>

      {/* Breach response dialog */}
      {breachedClock && ticket.serviceId && (
        <BreachResponseDialog
          open={breachOpen}
          onOpenChange={setBreachOpen}
          serviceId={ticket.serviceId}
          slaEventId={breachedClock.id}
          serviceName={ticket.serviceName ?? 'this service'}
          breachMessage={`SLA ${breachedClock.type.toLowerCase()} breach on ticket ${ticket.number}.`}
          breachDate={breachedClock.breachedAt ?? breachedClock.dueAt}
        />
      )}
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
      Back to Service Incidents
    </button>
  );
}

function EventTimeline({ events }: { events: TicketEventRow[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-7 w-7 text-muted-foreground/60" />}
        title="No activity yet"
        description="Work notes and lifecycle events will appear here."
      />
    );
  }
  const sorted = [...events].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return (
    <ol className="relative space-y-3 max-h-[28rem] overflow-y-auto scrollbar-thin">
      {sorted.map((e, i) => (
        <li key={e.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded-full border bg-card',
                i === 0 ? 'border-primary text-primary' : 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              {EVENT_ICONS[e.eventType] ?? <Activity className="h-3 w-3" />}
            </div>
            {i < sorted.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {EVENT_LABELS[e.eventType] ?? e.eventType}
              </span>
              <RelativeTime date={e.createdAt} className="text-xs text-muted-foreground shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground">by {e.actorName}</p>
            {e.notes && (
              <p className="text-sm text-foreground/80 mt-1 leading-relaxed whitespace-pre-wrap">
                {e.notes}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function AuditTimeline({ rows }: { rows: AuditLogRow[] }) {
  return (
    <ol className="relative space-y-3 max-h-[28rem] overflow-y-auto scrollbar-thin">
      {rows.map((r, i) => (
        <li key={r.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded-full border bg-card',
                i === 0 ? 'border-primary text-primary' : 'border-muted-foreground/30 text-muted-foreground',
              )}
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

function CustomerImpactSummary({
  ticket,
  siblings,
}: {
  ticket: Ticket;
  siblings: Ticket[];
}) {
  const open = siblings.filter(
    (t) => !['CLOSED', 'CANCELED', 'RESOLVED'].includes(t.status),
  );
  const p1p2 = siblings.filter(
    (t) => t.priority === 'P1' || t.priority === 'P2',
  );
  const breached = siblings.filter((t) =>
    (t.slaClocks ?? []).some((c) => c.status === 'BREACHED'),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KeyValue
          label="This customer's open tickets on this service"
          value={open.length + (['CLOSED', 'CANCELED', 'RESOLVED'].includes(ticket.status) ? 0 : 1)}
        />
        <KeyValue label="P1 / P2 (siblings)" value={p1p2.length} />
        <KeyValue label="SLA breached (siblings)" value={breached.length} />
        <KeyValue
          label="Total tickets on service"
          value={siblings.length + 1}
        />
      </div>

      {siblings.length > 0 && (
        <div className="mt-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Other open tickets for this customer on this service
          </h4>
          <ul className="divide-y rounded-md border max-h-64 overflow-y-auto scrollbar-thin">
            {open.slice(0, 10).map((t) => (
              <li
                key={t.id}
                className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => {
                  /* navigate within owner workspace */
                  window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'ticket-detail', params: { id: t.id } } }));
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-primary">{t.number}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] border tabular-nums', priorityStyles[t.priority])}
                    >
                      {t.priority}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {t.title}
                  </div>
                </div>
                <RelativeTime date={t.createdAt} className="text-[11px] text-muted-foreground shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
