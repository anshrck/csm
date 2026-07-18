'use client';

/**
 * TicketDetail — shared ticket work surface used by all 4 role workspaces.
 *
 * Renders:
 *   - Header: number, title, priority + status badges, SLA countdown timers.
 *   - Description.
 *   - SLA clock panels (Response + Resolution) with progress bars.
 *   - Work notes / activity log (TicketEvent timeline).
 *   - Action buttons by status + role (triage, assign, progress, waiting,
 *     resume, resolve, close, reopen).
 *   - Linked conversation thread placeholder (wired by a future agent).
 *
 * Export contract (other agents import this exact signature):
 *   export default function TicketDetail({ id, role }: { id: string; role: Role })
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useApp } from '@/lib/store';
import type { Role } from '@/lib/types';
import {
  type Ticket,
  type TicketEventRow,
  type SlaClockRow,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
  type Impact,
  type ResolutionCode,
  type TicketSlaHealth,
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_SHORT,
  TICKET_STATUS_LABELS,
  RESOLUTION_CODE_LABELS,
  IMPACT_LABELS,
  SLA_CLOCK_TYPE_LABELS,
  SLA_CLOCK_STATUS_LABELS,
  deriveSlaHealth,
  formatMins,
} from '@/lib/tickets';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Ticket as TicketIcon,
  ArrowLeft,
  Clock,
  Pause,
  Play,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  TimerReset,
  UserPlus,
  UserCog,
  Activity,
  RefreshCw,
  Ban,
  Send,
  MessageSquare,
  Flag,
  Gauge,
  Stethoscope,
} from 'lucide-react';

// ---- Status / priority / type badges (same styles as TicketList) -----------

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
      {TICKET_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const typeStyles: Record<TicketType, string> = {
  INCIDENT: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300',
  SERVICE_REQUEST: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300',
  QUESTION: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300',
  COMPLAINT: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
};

function TicketTypeBadge({ type }: { type: TicketType }) {
  return (
    <Badge variant="outline" className={cn('font-medium border text-xs', typeStyles[type])}>
      {TICKET_TYPE_LABELS[type]}
    </Badge>
  );
}

// ---- SLA clock panel -------------------------------------------------------

function SlaClockPanel({ clock }: { clock?: SlaClockRow }) {
  if (!clock) {
    return (
      <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        No SLA clock configured for this ticket type.
      </div>
    );
  }

  const status = clock.status;
  const type = clock.type;
  const dueAt = new Date(clock.dueAt);
  const remainingMs = dueAt.getTime() - Date.now();
  const remainingMins = Math.round(remainingMs / 60000);

  // Progress: 100% = just started, 0% = due now, negative = overdue
  const percent = clock.percentRemaining ?? (status === 'BREACHED' ? 0 : 100);
  const elapsedPct = Math.max(0, Math.min(100, 100 - percent));

  const statusMeta: Record<string, { label: string; cls: string; barCls: string; icon: React.ReactNode }> = {
    RUNNING: {
      label: 'Running',
      cls: 'text-emerald-700 dark:text-emerald-300',
      barCls: percent > 25 ? 'bg-emerald-500' : 'bg-amber-500',
      icon: <Play className="h-3.5 w-3.5" />,
    },
    PAUSED: {
      label: 'Paused',
      cls: 'text-amber-700 dark:text-amber-300',
      barCls: 'bg-amber-400',
      icon: <Pause className="h-3.5 w-3.5" />,
    },
    MET: {
      label: 'Met',
      cls: 'text-emerald-700 dark:text-emerald-300',
      barCls: 'bg-emerald-500',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    BREACHED: {
      label: 'Breached',
      cls: 'text-rose-700 dark:text-rose-300',
      barCls: 'bg-rose-500',
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
    },
    CANCELED: {
      label: 'Canceled',
      cls: 'text-muted-foreground',
      barCls: 'bg-muted-foreground/30',
      icon: <Ban className="h-3.5 w-3.5" />,
    },
  };
  const meta = statusMeta[status] ?? statusMeta.RUNNING;

  let timeLabel: string;
  if (status === 'RUNNING') {
    timeLabel = remainingMins < 0 ? `Overdue by ${formatMins(-remainingMins)}` : `${formatMins(remainingMins)} remaining`;
  } else if (status === 'PAUSED') {
    timeLabel = `Paused for ${formatMins(clock.totalPausedMins)}`;
  } else if (status === 'MET' && clock.metAt) {
    timeLabel = `Met at ${new Date(clock.metAt).toLocaleString()}`;
  } else if (status === 'BREACHED') {
    timeLabel = `Due ${new Date(clock.dueAt).toLocaleString()}`;
  } else {
    timeLabel = '—';
  }

  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{SLA_CLOCK_TYPE_LABELS[type as SlaClockRow['type']]} SLA</span>
        </div>
        <Badge variant="outline" className={cn('text-[11px] gap-1 font-medium', meta.cls)}>
          {meta.icon}
          {meta.label}
        </Badge>
      </div>
      <div className="text-lg font-semibold tabular-nums">{timeLabel}</div>
      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', meta.barCls)}
          style={{ width: `${elapsedPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Started <RelativeTime date={clock.startedAt} /></span>
        <span>Due <FormattedDate date={clock.dueAt} /></span>
      </div>
    </div>
  );
}

// ---- Activity log (TicketEvent timeline) -----------------------------------

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
  ASSIGNED: <UserCog className="h-3 w-3" />,
  TRIAGED: <Stethoscope className="h-3 w-3" />,
  IN_PROGRESS: <Play className="h-3 w-3" />,
  WAITING: <Pause className="h-3 w-3" />,
  RESUMED: <RefreshCw className="h-3 w-3" />,
  RESOLVED: <CheckCircle2 className="h-3 w-3" />,
  CLOSED: <CheckCircle2 className="h-3 w-3" />,
  REOPENED: <RefreshCw className="h-3 w-3" />,
  CANCELED: <Ban className="h-3 w-3" />,
  COMMENT: <MessageSquare className="h-3 w-3" />,
};

function ActivityTimeline({ events }: { events: TicketEventRow[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-7 w-7 text-muted-foreground/60" />}
        title="No activity yet"
        description="Work notes and lifecycle events will appear here."
      />
    );
  }
  return (
    <ol className="relative space-y-4">
      {events.map((e, i) => (
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
            {i < events.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {EVENT_LABELS[e.eventType] ?? e.eventType}
              </span>
              <RelativeTime date={e.createdAt} className="text-xs text-muted-foreground shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground">by {e.actorName}</p>
            {e.notes && <p className="text-sm text-foreground/80 mt-1 leading-relaxed whitespace-pre-wrap">{e.notes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Action button helpers -------------------------------------------------

function ActionButton({
  onClick,
  pending,
  disabled,
  variant = 'default',
  icon,
  children,
}: {
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={disabled || pending}
      className="gap-1.5"
    >
      {pending ? <Clock className="h-3.5 w-3.5 animate-pulse" /> : icon}
      {children}
    </Button>
  );
}

// ---- Triage dialog ---------------------------------------------------------

function TriageDialog({
  open,
  onOpenChange,
  ticket,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticket: Ticket;
  onConfirm: (payload: {
    priority: TicketPriority;
    impact: Impact | null;
    urgency: Impact | null;
    serviceId: string | null;
    notes?: string;
  }) => void;
  pending: boolean;
}) {
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [impact, setImpact] = useState<Impact | '__none'>(ticket.impact ?? '__none');
  const [urgency, setUrgency] = useState<Impact | '__none'>(ticket.urgency ?? '__none');
  const [serviceId, setServiceId] = useState<string>(ticket.serviceId ?? '__none');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (open) {
      setPriority(ticket.priority);
      setImpact(ticket.impact ?? '__none');
      setUrgency(ticket.urgency ?? '__none');
      setServiceId(ticket.serviceId ?? '__none');
      setNotes('');
    }
  }, [open, ticket]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> Triage ticket {ticket.number}
          </DialogTitle>
          <DialogDescription>
            Assign priority, impact, urgency, and the affected service. This is the SCM Worker&apos;s
            classification step before work begins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger id="t-priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['P1', 'P2', 'P3', 'P4'] as TicketPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>{TICKET_PRIORITY_SHORT[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-impact">Impact</Label>
              <Select value={impact} onValueChange={(v) => setImpact(v as Impact | '__none')}>
                <SelectTrigger id="t-impact" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {(['LOW', 'MEDIUM', 'HIGH'] as Impact[]).map((v) => (
                    <SelectItem key={v} value={v}>{IMPACT_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-urgency">Urgency</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as Impact | '__none')}>
                <SelectTrigger id="t-urgency" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {(['LOW', 'MEDIUM', 'HIGH'] as Impact[]).map((v) => (
                    <SelectItem key={v} value={v}>{IMPACT_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-service">Affected service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger id="t-service" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No specific service</SelectItem>
                <SelectItem value={ticket.serviceId ?? '__none__'} disabled>
                  {ticket.serviceName ?? 'Current service'}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Service catalog lookup is limited to the ticket&apos;s current service in this dialog. Use the full ticket PATCH for re-routing.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-notes">Triage notes (optional)</Label>
            <Textarea
              id="t-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Initial assessment, suspected cause, scope…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() =>
              onConfirm({
                priority,
                impact: impact === '__none' ? null : impact,
                urgency: urgency === '__none' ? null : urgency,
                serviceId: serviceId === '__none' ? null : serviceId,
                notes: notes.trim() || undefined,
              })
            }
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <Stethoscope className="h-4 w-4 mr-1.5" />}
            {pending ? 'Triaging…' : 'Triage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Assign dialog ---------------------------------------------------------

function AssignDialog({
  open,
  onOpenChange,
  ticket,
  workers,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticket: Ticket;
  workers: Array<{ id: string; name: string }>;
  onConfirm: (workerId: string | null) => void;
  pending: boolean;
}) {
  const [workerId, setWorkerId] = useState<string>(ticket.assignedUserId ?? '__unassigned');
  React.useEffect(() => {
    if (open) setWorkerId(ticket.assignedUserId ?? '__unassigned');
  }, [open, ticket]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Assign ticket {ticket.number}
          </DialogTitle>
          <DialogDescription>
            Choose an SCM Worker to own this ticket. The ticket status will advance to ASSIGNED if it is currently NEW or TRIAGED.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="a-worker">Assignee</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger id="a-worker" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned">— Unassigned —</SelectItem>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() => onConfirm(workerId === '__unassigned' ? null : workerId)}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Resolve dialog --------------------------------------------------------

function ResolveDialog({
  open,
  onOpenChange,
  ticket,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticket: Ticket;
  onConfirm: (payload: { resolutionCode: ResolutionCode; resolutionNotes: string }) => void;
  pending: boolean;
}) {
  const [code, setCode] = useState<ResolutionCode>('FIXED');
  const [notes, setNotes] = useState('');
  React.useEffect(() => {
    if (open) {
      setCode('FIXED');
      setNotes('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Resolve ticket {ticket.number}
          </DialogTitle>
          <DialogDescription>
            Mark this ticket as resolved. Both SLA clocks (Response + Resolution) will be marked as MET and the customer will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="r-code">Resolution code (required)</Label>
            <Select value={code} onValueChange={(v) => setCode(v as ResolutionCode)}>
              <SelectTrigger id="r-code" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['FIXED', 'WORKAROUND', 'DUPLICATE', 'NOT_REPRODUCIBLE', 'OUT_OF_SCOPE'] as ResolutionCode[]).map((c) => (
                  <SelectItem key={c} value={c}>{RESOLUTION_CODE_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-notes">Resolution notes (required)</Label>
            <Textarea
              id="r-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="What was the root cause? What fix was applied? Any follow-up actions for the customer?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending || !notes.trim()}
            onClick={() => onConfirm({ resolutionCode: code, resolutionNotes: notes.trim() })}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Resolving…' : 'Resolve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Notes dialog (used by progress/waiting/resume/close/reopen) -----------

function NotesDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmIcon,
  onConfirm,
  pending,
  destructive,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmIcon: React.ReactNode;
  onConfirm: (notes: string) => void;
  pending: boolean;
  destructive?: boolean;
}) {
  const [notes, setNotes] = useState('');
  React.useEffect(() => {
    if (!open) setNotes('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="n-notes">Notes (optional)</Label>
            <Textarea
              id="n-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Add a work note for the activity log…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => onConfirm(notes.trim())}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : confirmIcon}
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main component --------------------------------------------------------

interface TicketDetailProps {
  id: string;
  role: Role;
}

export default function TicketDetail({ id, role }: TicketDetailProps) {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  // ---- Data ---------------------------------------------------------------
  const ticketQ = useQuery<Ticket>({
    queryKey: ['ticket', id],
    queryFn: () => apiGet<Ticket>(`/api/tickets/${id}`),
    enabled: !!id,
  });

  // Workers for the assign dialog (roster from /api/stats workloadByWorker).
  const workersQ = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['stats', 'scm-workers', 'ticket-detail'],
    queryFn: async () => {
      const stats = await apiGet<{
        workloadByWorker?: Array<{ workerId: string; workerName: string }>;
      }>('/api/stats');
      return (stats.workloadByWorker ?? []).map((w) => ({ id: w.workerId, name: w.workerName }));
    },
    staleTime: 60_000,
  });

  const ticket = ticketQ.data;
  const events = ticket?.events ?? [];
  const clocks = ticket?.slaClocks ?? [];
  const responseClock = clocks.find((c) => c.type === 'RESPONSE');
  const resolutionClock = clocks.find((c) => c.type === 'RESOLUTION');
  const slaHealth = deriveSlaHealth(clocks);

  // ---- Action state + dialogs ---------------------------------------------
  const [triageOpen, setTriageOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  // ---- Mutation helpers ---------------------------------------------------
  const afterMutate = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };

  const triageMut = useMutation({
    mutationFn: (payload: {
      priority: TicketPriority;
      impact: Impact | null;
      urgency: Impact | null;
      serviceId: string | null;
      notes?: string;
    }) => apiPost<Ticket>(`/api/tickets/${id}/triage`, payload),
    onSuccess: (_t, vars) => {
      afterMutate('Ticket triaged');
      setTriageOpen(false);
      // If priority/serviceId changed, the SLA clocks may need re-evaluation —
      // the API doesn't currently re-create clocks on triage (only on create).
      // That's acceptable for v1.
      void vars;
    },
    onError: (e: Error) => toast.error(e.message || 'Triage failed'),
  });

  const assignMut = useMutation({
    mutationFn: (workerId: string | null) =>
      apiPost<Ticket>(`/api/tickets/${id}/assign`, { assignedUserId: workerId }),
    onSuccess: (_t, vars) => {
      afterMutate(vars ? 'Ticket assigned' : 'Ticket unassigned');
      setAssignOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Assign failed'),
  });

  const progressMut = useMutation({
    mutationFn: (notes?: string) => apiPost<Ticket>(`/api/tickets/${id}/progress`, { notes }),
    onSuccess: () => {
      afterMutate('Work started — SLA clocks resumed');
      setProgressOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not start work'),
  });

  const waitingMut = useMutation({
    mutationFn: (notes?: string) => apiPost<Ticket>(`/api/tickets/${id}/waiting`, { notes }),
    onSuccess: () => {
      afterMutate('Ticket set to waiting — SLA clocks paused');
      setWaitingOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not set to waiting'),
  });

  const resumeMut = useMutation({
    mutationFn: (notes?: string) => apiPost<Ticket>(`/api/tickets/${id}/resume`, { notes }),
    onSuccess: () => {
      afterMutate('Work resumed — SLA clocks running');
      setResumeOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not resume'),
  });

  const resolveMut = useMutation({
    mutationFn: (payload: { resolutionCode: ResolutionCode; resolutionNotes: string }) =>
      apiPost<Ticket>(`/api/tickets/${id}/resolve`, payload),
    onSuccess: () => {
      afterMutate('Ticket resolved — SLA clocks marked MET');
      setResolveOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not resolve'),
  });

  const closeMut = useMutation({
    mutationFn: (notes?: string) => apiPost<Ticket>(`/api/tickets/${id}/close`, { notes }),
    onSuccess: () => {
      afterMutate('Ticket closed');
      setCloseOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not close ticket'),
  });

  const reopenMut = useMutation({
    mutationFn: (notes?: string) => apiPost<Ticket>(`/api/tickets/${id}/reopen`, { notes }),
    onSuccess: () => {
      afterMutate('Ticket reopened — SLA clocks restarted');
      setReopenOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not reopen'),
  });

  // ---- Role gating --------------------------------------------------------
  const isAgent = role === 'SCM_WORKER' || role === 'CM_LEADER';
  const isCustomer = role === 'SERVICE_CUSTOMER';
  const isOwner = role === 'SERVICE_OWNER';
  const canMutate = isAgent; // owners + customers have narrower paths

  // ---- Loading / error states --------------------------------------------
  if (ticketQ.isLoading) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('tickets')} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
        </Button>
        <LoadingState rows={6} />
      </div>
    );
  }
  if (ticketQ.isError || !ticket) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('tickets')} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
        </Button>
        <EmptyState
          icon={<TicketIcon className="h-10 w-10 text-muted-foreground/50" />}
          title="Ticket not found"
          description="This ticket may have been deleted, or you may not have access to it."
          action={<Button onClick={() => navigate('tickets')}>Back to tickets</Button>}
        />
      </div>
    );
  }

  // ---- SLA health pill (for header) --------------------------------------
  const slaPill = (() => {
    const meta: Record<TicketSlaHealth, { cls: string; icon: React.ReactNode; label: string }> = {
      on_track: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300', icon: <CheckCircle2 className="h-3 w-3" />, label: 'SLA on track' },
      at_risk: { cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300', icon: <AlertTriangle className="h-3 w-3" />, label: 'SLA at risk' },
      breached: { cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300', icon: <ShieldAlert className="h-3 w-3" />, label: 'SLA breached' },
      met: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300', icon: <CheckCircle2 className="h-3 w-3" />, label: 'SLA met' },
      paused: { cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300', icon: <Pause className="h-3 w-3" />, label: 'SLA paused' },
      none: { cls: 'bg-muted text-muted-foreground border-border', icon: <Clock className="h-3 w-3" />, label: 'No SLA' },
    };
    const m = meta[slaHealth];
    return (
      <Badge variant="outline" className={cn('text-xs gap-1', m.cls)}>
        {m.icon} {m.label}
      </Badge>
    );
  })();

  // ---- Action button set (by status + role) ------------------------------
  const status = ticket.status;
  const actions: React.ReactNode[] = [];

  if (isAgent) {
    if (status === 'NEW' || status === 'TRIAGED') {
      actions.push(
        <ActionButton
          key="triage"
          icon={<Stethoscope className="h-3.5 w-3.5" />}
          onClick={() => setTriageOpen(true)}
        >
          Triage
        </ActionButton>,
      );
    }
    if (status !== 'CLOSED' && status !== 'CANCELED' && status !== 'RESOLVED') {
      actions.push(
        <ActionButton
          key="assign"
          icon={<UserPlus className="h-3.5 w-3.5" />}
          onClick={() => setAssignOpen(true)}
          variant="outline"
        >
          {ticket.assignedUserId ? 'Reassign' : 'Assign'}
        </ActionButton>,
      );
    }
    if (status === 'NEW' || status === 'TRIAGED' || status === 'ASSIGNED') {
      actions.push(
        <ActionButton
          key="progress"
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={() => setProgressOpen(true)}
        >
          Start work
        </ActionButton>,
      );
    }
    if (status === 'IN_PROGRESS' || status === 'ASSIGNED' || status === 'TRIAGED') {
      actions.push(
        <ActionButton
          key="waiting"
          icon={<Pause className="h-3.5 w-3.5" />}
          onClick={() => setWaitingOpen(true)}
          variant="outline"
        >
          Waiting on customer
        </ActionButton>,
      );
    }
    if (status === 'WAITING_CUSTOMER') {
      actions.push(
        <ActionButton
          key="resume"
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={() => setResumeOpen(true)}
        >
          Resume work
        </ActionButton>,
      );
    }
    if (status !== 'RESOLVED' && status !== 'CLOSED' && status !== 'CANCELED') {
      actions.push(
        <ActionButton
          key="resolve"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          onClick={() => setResolveOpen(true)}
          variant="outline"
        >
          Resolve
        </ActionButton>,
      );
    }
  }

  // Customer + agent can close
  if ((isAgent || isCustomer) && status === 'RESOLVED') {
    actions.push(
      <ActionButton
        key="close"
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        onClick={() => setCloseOpen(true)}
      >
        Close ticket
      </ActionButton>,
    );
  }
  // Customer + agent can reopen (resolved OR closed)
  if ((isAgent || isCustomer) && (status === 'RESOLVED' || status === 'CLOSED')) {
    actions.push(
      <ActionButton
        key="reopen"
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        onClick={() => setReopenOpen(true)}
        variant="outline"
      >
        Reopen
      </ActionButton>,
    );
  }

  // Service Owner: read-only — no action buttons.
  if (isOwner) {
    actions.push(
      <Badge key="ro" variant="outline" className="text-xs text-muted-foreground">
        Read-only
      </Badge>,
    );
  }

  // ---- Render -------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Back link */}
      <Button variant="ghost" size="sm" onClick={() => navigate('tickets')} className="gap-1.5 -ml-1">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Button>

      <PageHeader
        title={ticket.title}
        description={`Ticket ${ticket.number} · Raised as ${TICKET_TYPE_LABELS[ticket.type]} by ${ticket.requesterName ?? '—'}`}
        icon={<TicketIcon className="h-5 w-5" />}
        actions={<div className="flex items-center gap-1.5 flex-wrap">{actions}</div>}
      />

      {/* Status / priority / SLA summary row */}
      <div className="flex flex-wrap items-center gap-2">
        <TicketStatusBadge status={ticket.status} />
        <TicketPriorityBadge priority={ticket.priority} />
        <TicketTypeBadge type={ticket.type} />
        {slaPill}
        {ticket.impact && (
          <Badge variant="outline" className="text-xs">
            Impact: {IMPACT_LABELS[ticket.impact]}
          </Badge>
        )}
        {ticket.urgency && (
          <Badge variant="outline" className="text-xs">
            Urgency: {IMPACT_LABELS[ticket.urgency]}
          </Badge>
        )}
      </div>

      {/* Main layout: left = description + activity, right = SLA + meta */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          <SectionCard title="Description" description="As submitted by the requester.">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
              {ticket.description}
            </div>
          </SectionCard>

          {ticket.resolutionNotes && (
            <SectionCard
              title="Resolution"
              description={`Resolved as ${ticket.resolutionCode ? RESOLUTION_CODE_LABELS[ticket.resolutionCode] : '—'} at ${ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : '—'}`}
            >
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {ticket.resolutionNotes}
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="Activity Log"
            description="Lifecycle events and work notes — the ticket audit trail."
          >
            <ActivityTimeline events={events} />
          </SectionCard>

          {/* Conversation thread placeholder — wired by a future agent */}
          <SectionCard
            title="Conversation Thread"
            description="Customer-visible and internal comments on this ticket."
            actions={
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Coming soon
              </Badge>
            }
          >
            <EmptyState
              icon={<MessageSquare className="h-7 w-7 text-muted-foreground/50" />}
              title="Threaded conversation coming soon"
              description="The conversation thread (Comments API + visibility levels) will be wired into this panel by a later build phase."
            />
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <SectionCard
            title="SLA Clocks"
            description="Response and resolution targets for this ticket."
          >
            <div className="space-y-3">
              <SlaClockPanel clock={responseClock} />
              <SlaClockPanel clock={resolutionClock} />
            </div>
          </SectionCard>

          <SectionCard title="Ticket Details">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <KeyValue label="Customer" value={ticket.serviceCustomerName ?? '—'} />
              <KeyValue label="Service" value={ticket.serviceName ?? '—'} />
              <KeyValue
                label="Requester"
                value={
                  <span className="flex items-center gap-1.5">
                    {ticket.requesterName && <UserAvatar name={ticket.requesterName} size="sm" />}
                    {ticket.requesterName ?? '—'}
                  </span>
                }
              />
              <KeyValue
                label="Assignee"
                value={
                  ticket.assignedUserName ? (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar name={ticket.assignedUserName} size="sm" />
                      {ticket.assignedUserName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )
                }
              />
              <KeyValue label="Created" value={<RelativeTime date={ticket.createdAt} />} />
              <KeyValue label="Last update" value={<RelativeTime date={ticket.updatedAt} />} />
              {ticket.resolvedAt && (
                <KeyValue label="Resolved" value={<RelativeTime date={ticket.resolvedAt} />} />
              )}
              {ticket.closedAt && (
                <KeyValue label="Closed" value={<RelativeTime date={ticket.closedAt} />} />
              )}
            </dl>
          </SectionCard>

          {canMutate && (
            <SectionCard
              title="Governance Actions"
              description="Status-aware actions available to your role."
            >
              <div className="flex flex-col gap-2">
                {/* Compact action list (mirrors the header buttons) */}
                {actions.length === 0 && (
                  <p className="text-xs text-muted-foreground">No actions available in this state.</p>
                )}
                {actions.map((a, i) => (
                  <React.Fragment key={i}>{a}</React.Fragment>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <TriageDialog
        open={triageOpen}
        onOpenChange={setTriageOpen}
        ticket={ticket}
        onConfirm={(payload) => triageMut.mutate(payload)}
        pending={triageMut.isPending}
      />
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        ticket={ticket}
        workers={workersQ.data ?? []}
        onConfirm={(workerId) => assignMut.mutate(workerId)}
        pending={assignMut.isPending}
      />
      <ResolveDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        ticket={ticket}
        onConfirm={(payload) => resolveMut.mutate(payload)}
        pending={resolveMut.isPending}
      />
      <NotesDialog
        open={progressOpen}
        onOpenChange={setProgressOpen}
        title={`Start work on ${ticket.number}`}
        description="Mark this ticket as IN_PROGRESS. Any paused SLA clocks will resume."
        confirmLabel="Start work"
        confirmIcon={<Play className="h-4 w-4 mr-1.5" />}
        onConfirm={(notes) => progressMut.mutate(notes || undefined)}
        pending={progressMut.isPending}
      />
      <NotesDialog
        open={waitingOpen}
        onOpenChange={setWaitingOpen}
        title={`Set ${ticket.number} to waiting on customer`}
        description="Pause SLA clocks. The customer will be notified that their input is needed."
        confirmLabel="Set to waiting"
        confirmIcon={<Pause className="h-4 w-4 mr-1.5" />}
        onConfirm={(notes) => waitingMut.mutate(notes || undefined)}
        pending={waitingMut.isPending}
      />
      <NotesDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        title={`Resume work on ${ticket.number}`}
        description="Move the ticket back to IN_PROGRESS. Paused SLA clocks will resume (due times extended by the paused duration)."
        confirmLabel="Resume work"
        confirmIcon={<Play className="h-4 w-4 mr-1.5" />}
        onConfirm={(notes) => resumeMut.mutate(notes || undefined)}
        pending={resumeMut.isPending}
      />
      <NotesDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={`Close ticket ${ticket.number}`}
        description="Close this ticket — the lifecycle is complete. The ticket becomes read-only."
        confirmLabel="Close ticket"
        confirmIcon={<CheckCircle2 className="h-4 w-4 mr-1.5" />}
        onConfirm={(notes) => closeMut.mutate(notes || undefined)}
        pending={closeMut.isPending}
      />
      <NotesDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen ticket ${ticket.number}`}
        description="Reopen this ticket — the prior resolution is cleared, status moves back to IN_PROGRESS, and SLA clocks are restarted from now."
        confirmLabel="Reopen"
        confirmIcon={<RefreshCw className="h-4 w-4 mr-1.5" />}
        onConfirm={(notes) => reopenMut.mutate(notes || undefined)}
        pending={reopenMut.isPending}
      />
    </div>
  );
}
