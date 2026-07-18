'use client';

/**
 * TicketList — shared ticket queue used by all 4 role workspaces.
 *
 * Renders a DataTable of tickets with:
 *   - columns: Number, Title, Type, Priority, Status, Service, Assignee, Created, SLA indicator
 *   - filters: status (multi), priority, type, search, preset views
 *   - sorting by age / priority / SLA dueAt
 *   - bulk assignment for CM Leader (select rows → assign to worker)
 *   - aging badges (P1 > 1h amber, > 4h red; P2 > 4h amber, > 24h red, etc.)
 *   - SLA indicator pill derived from each ticket's clocks
 *
 * Role-aware:
 *   - SCM_WORKER + CM_LEADER: full action affordances (create, assign, bulk assign)
 *   - SERVICE_CUSTOMER: can create tickets, no assign menu
 *   - SERVICE_OWNER: read-only, no create button
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import {
  type Ticket,
  type TicketStatus,
  type TicketPriority,
  type TicketType,
  type SlaClockRow,
  type TicketSlaHealth,
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_SHORT,
  TICKET_STATUS_LABELS,
  deriveSlaHealth,
  formatMins,
} from '@/lib/tickets';
import type { Role } from '@/lib/types';

import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  DataTable,
  type Column,
  Button,
  Badge,
  Card,
  CardContent,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  Search,
  X,
  Filter,
  Plus,
  Inbox,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Pause,
  Play,
  TimerReset,
  ChevronDown,
  UserPlus,
  ShieldAlert,
} from 'lucide-react';

// ---- Filter presets --------------------------------------------------------

type PresetKey = 'all' | 'my_open' | 'unassigned' | 'breaching' | 'waiting' | 'resolved';

const PRESETS: { key: PresetKey; label: string; description: string }[] = [
  { key: 'all', label: 'All', description: 'Every ticket in your scope' },
  { key: 'my_open', label: 'My Open Work', description: 'Tickets assigned to you that are not yet resolved/closed' },
  { key: 'unassigned', label: 'Unassigned', description: 'Tickets with no assignee — pick one up' },
  { key: 'breaching', label: 'Breaching Soon', description: 'Running SLA clocks within 25% of dueAt' },
  { key: 'waiting', label: 'Waiting Customer', description: 'Awaiting customer response — SLA paused' },
  { key: 'resolved', label: 'Resolved', description: 'Resolved tickets awaiting close' },
];

// ---- Status / priority / type options --------------------------------------

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

// ---- Status + priority badge styles ----------------------------------------

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
    <Badge
      variant="outline"
      className={cn('font-medium border text-xs', statusStyles[status])}
    >
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
    <Badge
      variant="outline"
      className={cn('font-semibold border text-xs tabular-nums', priorityStyles[priority])}
    >
      {TICKET_PRIORITY_SHORT[priority]}
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

// ---- SLA health pill -------------------------------------------------------

const slaHealthMeta: Record<
  TicketSlaHealth,
  { label: string; cls: string; icon: React.ReactNode }
> = {
  on_track: {
    label: 'On track',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  at_risk: {
    label: 'At risk',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  breached: {
    label: 'Breached',
    cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
    icon: <ShieldAlert className="h-3 w-3" />,
  },
  met: {
    label: 'SLA met',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  paused: {
    label: 'Paused',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
    icon: <Pause className="h-3 w-3" />,
  },
  none: {
    label: 'No SLA',
    cls: 'bg-muted text-muted-foreground border-border',
    icon: <Clock className="h-3 w-3" />,
  },
};

function SlaHealthPill({ health, dueAt }: { health: TicketSlaHealth; dueAt?: string | null }) {
  const meta = slaHealthMeta[health];
  let suffix = '';
  if ((health === 'on_track' || health === 'at_risk') && dueAt) {
    const mins = Math.round((new Date(dueAt).getTime() - Date.now()) / 60000);
    suffix = ` · ${formatMins(mins)}`;
  }
  return (
    <Badge variant="outline" className={cn('font-medium border text-[11px] gap-1', meta.cls)}>
      {meta.icon}
      {meta.label}
      {suffix}
    </Badge>
  );
}

// ---- Aging badge -----------------------------------------------------------

/**
 * Aging thresholds by priority (in hours). Beyond `warn` we show an amber
 * "aging" badge; beyond `overdue` we show a red one. P1 incidents age fastest.
 */
const AGE_THRESHOLDS: Record<TicketPriority, { warn: number; overdue: number }> = {
  P1: { warn: 1, overdue: 4 },
  P2: { warn: 4, overdue: 24 },
  P3: { warn: 24, overdue: 72 },
  P4: { warn: 72, overdue: 168 },
};

function AgingBadge({ createdAt, priority, status }: { createdAt: string; priority: TicketPriority; status: TicketStatus }) {
  // Don't show aging on terminal statuses.
  if (status === 'RESOLVED' || status === 'CLOSED' || status === 'CANCELED') return null;

  const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  const t = AGE_THRESHOLDS[priority];
  if (hours >= t.overdue) {
    return (
      <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300">
        Aging {Math.round(hours)}h
      </Badge>
    );
  }
  if (hours >= t.warn) {
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300">
        Aging {Math.round(hours)}h
      </Badge>
    );
  }
  return null;
}

// ---- Worker / customer options hook ----------------------------------------

interface ScmWorker {
  id: string;
  name: string;
  title: string | null;
  avatarColor: string;
}

/**
 * Fetch the SCM-worker roster from /api/stats (workloadByWorker array).
 * Falls back to an empty list when stats are unavailable.
 */
function useScmWorkers() {
  return useQuery<ScmWorker[]>({
    queryKey: ['stats', 'scm-workers'],
    queryFn: async () => {
      const stats = await apiGet<{
        workloadByWorker?: Array<{
          workerId: string;
          workerName: string;
          avatarColor?: string;
        }>;
      }>('/api/stats');
      return (stats.workloadByWorker ?? []).map((w) => ({
        id: w.workerId,
        name: w.workerName,
        title: null,
        avatarColor: w.avatarColor ?? '#0d9488',
      }));
    },
    staleTime: 60_000,
  });
}

// ---- Bulk assign dialog ----------------------------------------------------

function BulkAssignDialog({
  open,
  onOpenChange,
  workers,
  selectedCount,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workers: ScmWorker[];
  selectedCount: number;
  onConfirm: (workerId: string) => void;
  pending: boolean;
}) {
  const [workerId, setWorkerId] = useState('');
  React.useEffect(() => {
    if (!open) setWorkerId('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Bulk assign {selectedCount} ticket{selectedCount === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            Choose an SCM Worker to assign the selected tickets to. Each ticket&apos;s status will advance to ASSIGNED if it was NEW or TRIAGED.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-worker">Assignee</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger id="bulk-worker" className="w-full">
                <SelectValue placeholder="Select SCM Worker…" />
              </SelectTrigger>
              <SelectContent>
                {workers.length === 0 ? (
                  <SelectItem value="__none" disabled>No workers available</SelectItem>
                ) : (
                  workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.title ? ` · ${w.title}` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !workerId || workerId === '__none'}
            onClick={() => onConfirm(workerId)}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create ticket dialog --------------------------------------------------

interface ServiceOption { id: string; name: string }

function CreateTicketDialog({
  open,
  onOpenChange,
  services,
  defaultCustomerId,
  canPickCustomer,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  services: ServiceOption[];
  defaultCustomerId: string | null;
  canPickCustomer: boolean;
  onConfirm: (payload: {
    title: string;
    description: string;
    type: TicketType;
    priority: TicketPriority;
    serviceId: string | null;
    serviceCustomerId: string;
  }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TicketType>('INCIDENT');
  const [priority, setPriority] = useState<TicketPriority>('P3');
  const [serviceId, setServiceId] = useState<string>('__none');
  const [customerId, setCustomerId] = useState<string>(defaultCustomerId ?? '');

  React.useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setType('INCIDENT');
      setPriority('P3');
      setServiceId('__none');
      setCustomerId(defaultCustomerId ?? '');
    }
  }, [open, defaultCustomerId]);

  const valid = title.trim().length > 0 && description.trim().length > 0 && (canPickCustomer ? !!customerId : true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Raise a new ticket
          </DialogTitle>
          <DialogDescription>
            Provide the title, description, and classification. An SLA clock will start automatically based on the matching SLA policy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="t-title">Title (required)</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Brief summary of the issue or request"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Description (required)</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What is happening? What did you expect? Any error messages, steps to reproduce, business impact…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
                <SelectTrigger id="t-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{TICKET_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-prio">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger id="t-prio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{TICKET_PRIORITY_SHORT[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-service">Service (optional)</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger id="t-service" className="w-full">
                <SelectValue placeholder="Select a service…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No specific service</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canPickCustomer && (
            <div className="space-y-1.5">
              <Label htmlFor="t-customer">Customer org (required)</Label>
              <Input
                id="t-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Customer org node id"
              />
              <p className="text-[11px] text-muted-foreground">
                For SCM Workers raising a ticket on behalf of a customer. Customers do not see this field.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !valid}
            onClick={() =>
              onConfirm({
                title: title.trim(),
                description: description.trim(),
                type,
                priority,
                serviceId: serviceId === '__none' ? null : serviceId,
                serviceCustomerId: customerId,
              })
            }
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {pending ? 'Creating…' : 'Create Ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main component --------------------------------------------------------

interface TicketListProps {
  role: Role;
  /** Override the page title (defaults to "Tickets"). */
  title?: string;
  description?: string;
  /** Optional fixed customer filter (e.g. for the customer workspace) */
  fixedCustomerId?: string;
  /** Show the create button — defaults to true for everyone except SERVICE_OWNER. */
  hideCreate?: boolean;
}

export default function TicketList({
  role,
  title = 'Tickets & Incidents',
  description = 'Track and resolve incidents, service requests, questions, and complaints across your scope.',
  fixedCustomerId,
  hideCreate,
}: TicketListProps) {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  // Filter state
  const [preset, setPreset] = useState<PresetKey>('all');
  const [statusFilter, setStatusFilter] = useState<TicketStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority[]>([]);
  const [typeFilter, setTypeFilter] = useState<TicketType[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'priority' | 'age' | 'sla'>('recent');

  // Selection (bulk assign)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);

  // Workers + services for dialogs
  const workersQ = useScmWorkers();
  const servicesQ = useQuery<ServiceOption[]>({
    queryKey: ['services', 'all-status', 'ticket-list'],
    queryFn: () => apiGet('/api/services?status=ALL'),
    staleTime: 60_000,
  });

  const canCreate = hideCreate !== true && role !== 'SERVICE_OWNER';
  const canBulkAssign = role === 'CM_LEADER';

  // Build the query string from preset + filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    // Preset-driven defaults
    if (preset === 'my_open' && session) {
      params.set('assignedUserId', 'me');
      params.set('status', 'NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER');
    } else if (preset === 'unassigned') {
      params.set('assignedUserId', 'unassigned');
    } else if (preset === 'breaching') {
      params.set('breachingSoon', '1');
    } else if (preset === 'waiting') {
      params.set('status', 'WAITING_CUSTOMER');
    } else if (preset === 'resolved') {
      params.set('status', 'RESOLVED');
    }
    // User-driven filters (override / refine preset)
    if (statusFilter.length > 0) params.set('status', statusFilter.join(','));
    if (priorityFilter.length > 0) params.set('priority', priorityFilter.join(','));
    if (typeFilter.length > 0) params.set('type', typeFilter.join(','));
    if (search.trim()) params.set('q', search.trim());
    if (fixedCustomerId) params.set('serviceCustomerId', fixedCustomerId);
    params.set('sort', sort);
    return params.toString();
  }, [preset, statusFilter, priorityFilter, typeFilter, search, fixedCustomerId, sort, session]);

  const ticketsQ = useQuery<Ticket[]>({
    queryKey: ['tickets', queryString],
    queryFn: () => apiGet<Ticket[]>(`/api/tickets?${queryString}`),
    staleTime: 15_000,
  });

  // Bulk assign mutation
  const bulkAssign = useMutation({
    mutationFn: async ({ workerId, ticketIds }: { workerId: string; ticketIds: string[] }) => {
      // Fire all assignments in parallel — the API is idempotent.
      await Promise.all(
        ticketIds.map((id) => apiPost(`/api/tickets/${id}/assign`, { assignedUserId: workerId })),
      );
    },
    onSuccess: (_data, vars) => {
      toast.success(`Assigned ${vars.ticketIds.length} ticket${vars.ticketIds.length === 1 ? '' : 's'}`, {
        description: `All selected tickets assigned to ${workersQ.data?.find((w) => w.id === vars.workerId)?.name ?? 'worker'}.`,
      });
      setSelected(new Set());
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Bulk assign failed'),
  });

  // Create ticket mutation
  const createTicket = useMutation({
    mutationFn: (payload: {
      title: string;
      description: string;
      type: TicketType;
      priority: TicketPriority;
      serviceId: string | null;
      serviceCustomerId: string;
    }) => apiPost<Ticket>('/api/tickets', payload),
    onSuccess: (t) => {
      toast.success(`Ticket ${t.number} created`, {
        description: t.title,
      });
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      // Navigate to the new ticket
      navigate('ticket-detail', { id: t.id });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create ticket'),
  });

  const tickets = ticketsQ.data ?? [];

  // Selected tickets objects (for bulk actions)
  const selectedTickets = useMemo(
    () => tickets.filter((t) => selected.has(t.id)),
    [tickets, selected],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === tickets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tickets.map((t) => t.id)));
    }
  };

  const hasUserFilters =
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    typeFilter.length > 0 ||
    search.trim().length > 0;

  // ---- Columns -------------------------------------------------------------
  const columns: Column<Ticket>[] = useMemo(() => {
    const cols: Column<Ticket>[] = [];

    if (canBulkAssign) {
      cols.push({
        key: 'select',
        header: null,
        render: (t) => (
          <Checkbox
            checked={selected.has(t.id)}
            onCheckedChange={() => toggleSelect(t.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${t.number}`}
          />
        ),
        headerClassName: 'w-10',
        className: 'w-10',
      });
    }

    cols.push(
      {
        key: 'number',
        header: 'Number',
        render: (t) => (
          <span className="font-mono text-xs font-medium text-primary">{t.number}</span>
        ),
        headerClassName: 'w-24',
        className: 'w-24',
      },
      {
        key: 'title',
        header: 'Title',
        render: (t) => (
          <div className="min-w-0 max-w-[280px]">
            <div className="font-medium text-sm truncate">{t.title}</div>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <AgingBadge createdAt={t.createdAt} priority={t.priority} status={t.status} />
              {t.serviceName && (
                <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                  {t.serviceName}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (t) => <TicketTypeBadge type={t.type} />,
        headerClassName: 'w-32',
        className: 'w-32',
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
        headerClassName: 'w-36',
        className: 'w-36',
      },
      {
        key: 'sla',
        header: 'SLA',
        render: (t) => {
          const health = deriveSlaHealth(t.slaClocks);
          const dueAt = t.slaClocks?.find((c) => c.status === 'RUNNING')?.dueAt ?? null;
          return <SlaHealthPill health={health} dueAt={dueAt} />;
        },
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
    );

    return cols;
  }, [canBulkAssign, selected, toggleSelect]);

  // ---- Render --------------------------------------------------------------

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        icon={<TicketIcon className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Raise Ticket
            </Button>
          ) : null
        }
      />

      {/* Preset chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setPreset(p.key);
              // Clear user filters when switching presets so the preset semantics win.
              setStatusFilter([]);
              setPriorityFilter([]);
              setTypeFilter([]);
              setSearch('');
            }}
            title={p.description}
            className={cn(
              'inline-flex items-center h-8 px-3 rounded-md text-xs font-medium border transition-colors',
              preset === p.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background hover:bg-accent hover:text-accent-foreground border-border',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <SectionCard>
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-9 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Filter className="h-3.5 w-3.5" /> Status
                {statusFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {statusFilter.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="start">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
                {STATUS_OPTIONS.map((s) => (
                  <label key={s} className="flex items-center gap-2 cursor-pointer py-1">
                    <Checkbox
                      checked={statusFilter.includes(s)}
                      onCheckedChange={() => {
                        setStatusFilter((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                        );
                      }}
                    />
                    <span className="text-sm">{TICKET_STATUS_LABELS[s]}</span>
                  </label>
                ))}
                {statusFilter.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-1 text-xs h-7"
                    onClick={() => setStatusFilter([])}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Select
            value={priorityFilter.length === 0 ? 'all' : priorityFilter[0]}
            onValueChange={(v) => setPriorityFilter(v === 'all' ? [] : [v as TicketPriority])}
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
            value={typeFilter.length === 0 ? 'all' : typeFilter[0]}
            onValueChange={(v) => setTypeFilter(v === 'all' ? [] : [v as TicketType])}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>{TICKET_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as 'recent' | 'priority' | 'age' | 'sla')}>
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="priority">Priority (P1 first)</SelectItem>
              <SelectItem value="age">Oldest first</SelectItem>
              <SelectItem value="sla">SLA due soonest</SelectItem>
            </SelectContent>
          </Select>

          {hasUserFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter([]);
                setPriorityFilter([]);
                setTypeFilter([]);
                setSearch('');
              }}
              className="h-9 text-xs"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {/* Bulk action bar */}
        {canBulkAssign && selected.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-xs font-medium">
              {selected.size} ticket{selected.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setBulkOpen(true)}
              >
                <UserPlus className="h-3.5 w-3.5" /> Assign {selected.size} to…
              </Button>
            </div>
          </div>
        )}

        {/* Select-all row (only when bulk assign is available) */}
        {canBulkAssign && tickets.length > 0 && (
          <div className="mb-1 flex items-center gap-2 px-1">
            <Checkbox
              checked={selected.size === tickets.length && tickets.length > 0}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all"
            />
            <span className="text-[11px] text-muted-foreground">
              {selected.size === tickets.length ? 'All selected' : 'Select all'}
            </span>
          </div>
        )}

        {ticketsQ.isLoading ? (
          <LoadingState rows={6} />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-10 w-10 text-muted-foreground/50" />}
            title={hasUserFilters ? 'No tickets match your filters' : 'No tickets yet'}
            description={
              hasUserFilters
                ? 'Try adjusting your filters or choosing a different preset.'
                : canCreate
                  ? 'Raise your first ticket to start tracking an incident or request.'
                  : 'Tickets raised on services you own will appear here.'
            }
            action={
              canCreate ? (
                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                  <Plus className="h-4 w-4" /> Raise Ticket
                </Button>
              ) : undefined
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

      {/* Bulk assign dialog */}
      <BulkAssignDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        workers={workersQ.data ?? []}
        selectedCount={selected.size}
        onConfirm={(workerId) =>
          bulkAssign.mutate({ workerId, ticketIds: Array.from(selected) })
        }
        pending={bulkAssign.isPending}
      />

      {/* Create ticket dialog */}
      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        services={servicesQ.data ?? []}
        defaultCustomerId={session?.orgNodeId ?? null}
        canPickCustomer={role === 'SCM_WORKER' || role === 'CM_LEADER'}
        onConfirm={(payload) => createTicket.mutate(payload)}
        pending={createTicket.isPending}
      />
    </div>
  );
}
