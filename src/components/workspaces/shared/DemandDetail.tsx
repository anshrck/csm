'use client';

/**
 * DemandDetail — CSM-side Demand Work Surface (WS-02-003).
 *
 * Shared screen used by SCM Worker and CM Leader workspaces.
 * Renders the full demand lifecycle work surface: customer input, catalog
 * check, assessment/quote draft (with CM Leader approval gate), commitment,
 * linked change, activity log, demand meta, related services, and a sticky
 * governance actions card.
 *
 * Export contract (other agents import this exact signature):
 *   export default function DemandDetail({ id, role }: { id: string; role: 'SCM_WORKER' | 'CM_LEADER' })
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Demand, Service, ServiceOffering } from '@/lib/types';

// Shared design system
import {
  ActivityLog,
  Badge,
  Button,
  ChangeStatusBadge,
  Days,
  DemandPipelineTimeline,
  DemandStatusBadge,
  EmptyState,
  FormattedDate,
  KeyValue,
  LoadingState,
  Money,
  PageHeader,
  RelativeTime,
  SectionCard,
  SlaClassBadge,
  UserAvatar,
} from '@/components/shared';

// shadcn/ui primitives
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

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CornerUpRight,
  FileCheck2,
  GitBranch,
  Info,
  MessageSquare,
  PackageCheck,
  Play,
  Send,
  ShieldCheck,
  UserPlus,
  Wrench,
} from 'lucide-react';

/* ------------------------------ helpers ------------------------------ */

const isScm = (role: 'SCM_WORKER' | 'CM_LEADER') => role === 'SCM_WORKER';
const isCm = (role: 'SCM_WORKER' | 'CM_LEADER') => role === 'CM_LEADER';

interface ScmWorkerHint {
  id: string;
  name: string;
  title: string | null;
  avatarColor: string;
  openDemandCount: number;
}

type CalloutTone = 'info' | 'warning' | 'success' | 'danger';

function Callout({
  tone = 'info',
  icon,
  title,
  children,
  className = '',
}: {
  tone?: CalloutTone;
  icon?: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const map: Record<CalloutTone, string> = {
    info: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200',
    danger:
      'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200',
  };
  return (
    <div className={`flex gap-2.5 rounded-md border px-3 py-2.5 text-xs ${map[tone]} ${className}`}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="space-y-0.5 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[11px] leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  variant = 'default',
  onClick,
  disabled,
  pending,
  className = '',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'ghost';
  onClick?: () => void;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled || pending}
      className={`w-full justify-start ${className}`}
    >
      {pending ? <Clock className="size-4 animate-pulse" /> : children}
    </Button>
  );
}

/* ------------------------------ dialogs ------------------------------ */

function RejectDialog({
  open,
  onOpenChange,
  reason,
  setReason,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-5 text-rose-600" /> Reject Demand
          </DialogTitle>
          <DialogDescription>
            Rejecting this demand is a terminal action. The customer will be notified with the reason below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Reason for rejection</Label>
          <Textarea
            id="reject-reason"
            rows={5}
            placeholder="Explain why this demand cannot be fulfilled, and where the customer should go instead (e.g. catalog offering)."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            This text is shown to the Service Customer in their notification.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending || !reason.trim()}>
            {pending ? 'Rejecting…' : 'Reject Demand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RedirectDialog({
  open,
  onOpenChange,
  offerings,
  offeringsLoading,
  offering,
  setOffering,
  reason,
  setReason,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  offerings: ServiceOffering[];
  offeringsLoading: boolean;
  offering: string;
  setOffering: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CornerUpRight className="size-5 text-orange-600" /> Redirect to Catalog Offering
          </DialogTitle>
          <DialogDescription>
            The customer need is already covered by an existing catalog offering. Select the offering to
            redirect this demand to. The customer will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="offering-select">Catalog offering</Label>
            {offeringsLoading ? (
              <div className="h-9 rounded-md border bg-muted/30 animate-pulse" />
            ) : offerings.length === 0 ? (
              <Callout tone="warning" icon={<AlertTriangle className="size-4" />}>
                No active offerings found in the catalog.
              </Callout>
            ) : (
              <Select value={offering} onValueChange={setOffering}>
                <SelectTrigger id="offering-select" className="w-full">
                  <SelectValue placeholder="Choose an offering…" />
                </SelectTrigger>
                <SelectContent>
                  {offerings.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="font-medium">{o.name}</span>
                      <span className="text-muted-foreground ml-1">— {o.serviceName ?? 'service'}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="redirect-reason">Note to customer (optional)</Label>
            <Textarea
              id="redirect-reason"
              rows={3}
              placeholder="e.g. Your need is fulfilled by the existing 'New ERP Module Request' offering."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={pending || !offering || offerings.length === 0}
          >
            {pending ? 'Redirecting…' : 'Redirect Demand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandToCeDialog({
  open,
  onOpenChange,
  relatedServices,
  plan,
  setPlan,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  relatedServices: Service[];
  plan: string;
  setPlan: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-5 text-teal-600" /> Create Change &amp; Hand to CE
          </DialogTitle>
          <DialogDescription>
            A Change Request will be created from this demand and handed to Change Enablement. The demand
            moves to <span className="font-medium">In Change</span> until the change is closed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Affected services (from demand)
            </Label>
            <ul className="mt-1 space-y-1">
              {relatedServices.length === 0 ? (
                <li className="text-sm text-muted-foreground">No related services on the demand.</li>
              ) : (
                relatedServices.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                  >
                    <span className="text-sm font-medium">{s.name}</span>
                    <SlaClassBadge slaClass={s.slaClass} />
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ce-plan">Implementation plan (optional)</Label>
            <Textarea
              id="ce-plan"
              rows={5}
              placeholder="High-level steps, owners, and rollback notes. The CE worker will detail this further."
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? 'Creating change…' : 'Create Change & Hand to CE'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  workers,
  workersLoading,
  selected,
  setSelected,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workers: ScmWorkerHint[];
  workersLoading: boolean;
  selected: string;
  setSelected: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-teal-600" /> Assign SCM Worker
          </DialogTitle>
          <DialogDescription>
            Choose a Service Customer Manager to own this demand. Workload hints are shown next to each
            worker.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="worker-select">SCM Worker</Label>
          {workersLoading ? (
            <div className="h-9 rounded-md border bg-muted/30 animate-pulse" />
          ) : workers.length === 0 ? (
            <Callout tone="warning" icon={<AlertTriangle className="size-4" />}>
              No SCM workers found. Try assigning to yourself from the SCM Worker workspace.
            </Callout>
          ) : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="worker-select" className="w-full">
                <SelectValue placeholder="Select an SCM worker…" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{w.name}</span>
                      <span className="text-muted-foreground">
                        · {w.openDemandCount} open {w.openDemandCount === 1 ? 'demand' : 'demands'}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending || !selected || workers.length === 0}>
            {pending ? 'Assigning…' : 'Assign Worker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  note,
  setNote,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  note: string;
  setNote: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" /> Close Demand
          </DialogTitle>
          <DialogDescription>
            Closing this demand completes its lifecycle. The customer will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="close-note">Closing note (optional)</Label>
          <Textarea
            id="close-note"
            rows={4}
            placeholder="Any final remarks, outcomes, or follow-up actions."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? 'Closing…' : 'Close Demand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- assessment fields sub-component -------------------- */

function AssessmentFieldsSection({
  demand,
  role,
  onSave,
  savePending,
}: {
  demand: Demand;
  role: 'SCM_WORKER' | 'CM_LEADER';
  onSave: (body: {
    estimatedEffortDays: number | null;
    estimatedCost: number | null;
    quoteNotes: string | null;
  }) => void;
  savePending: boolean;
}) {
  const canEdit = demand.status === 'UNDER_REVIEW' && isScm(role);

  // Lazy initial state — runs once per mount. Parent remounts via key={demand.id}.
  const [effort, setEffort] = useState<string>(() =>
    demand.estimatedEffortDays != null ? String(demand.estimatedEffortDays) : '',
  );
  const [cost, setCost] = useState<string>(() =>
    demand.estimatedCost != null ? String(demand.estimatedCost) : '',
  );
  const [quoteNotes, setQuoteNotes] = useState<string>(() => demand.quoteNotes ?? '');

  const quoteFieldsFilled = !!quoteNotes.trim() && effort.trim() !== '' && Number(effort) > 0;
  const savedQuoteFieldsFilled =
    demand.estimatedEffortDays != null &&
    demand.estimatedEffortDays > 0 &&
    !!demand.quoteNotes?.trim();

  return (
    <SectionCard
      title="Assessment & Quote Draft"
      description={
        canEdit
          ? 'Fill in the estimated effort, cost, and notes. The CM Leader must approve before the quote is sent to the customer.'
          : "Review the SCM Worker's quote draft. Approve to enable submission to the customer, or reject the demand."
      }
      actions={
        demand.quoteApprovedByCmLeader ? (
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          >
            <CheckCircle2 className="size-3.5" /> CM Approved
          </Badge>
        ) : undefined
      }
    >
      <div id="assessment-section" className="space-y-4 scroll-mt-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="effort">Estimated Effort (days)</Label>
            {canEdit ? (
              <Input
                id="effort"
                type="number"
                min="0"
                step="0.5"
                placeholder="e.g. 12"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
              />
            ) : (
              <div className="text-sm py-1.5">
                <Days value={demand.estimatedEffortDays} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost">Estimated Cost (USD)</Label>
            {canEdit ? (
              <Input
                id="cost"
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 12000"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            ) : (
              <div className="text-sm py-1.5">
                <Money value={demand.estimatedCost} />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quoteNotes">Quote Notes</Label>
          {canEdit ? (
            <Textarea
              id="quoteNotes"
              rows={5}
              placeholder="Scope, deliverables, assumptions, SLA class, and any dependencies on other services."
              value={quoteNotes}
              onChange={(e) => setQuoteNotes(e.target.value)}
            />
          ) : (
            <div className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3 min-h-[3rem] leading-relaxed">
              {demand.quoteNotes ?? (
                <span className="text-muted-foreground italic">
                  SCM Worker has not yet filled the quote notes.
                </span>
              )}
            </div>
          )}
        </div>

        {/* SCM save button + status callout */}
        {canEdit && (
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={savePending || !quoteFieldsFilled}
                onClick={() =>
                  onSave({
                    estimatedEffortDays: effort ? Number(effort) : null,
                    estimatedCost: cost ? Number(cost) : null,
                    quoteNotes: quoteNotes.trim() || null,
                  })
                }
              >
                {savePending ? (
                  <Clock className="size-4 animate-pulse" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Save Quote Draft
              </Button>
              {!quoteFieldsFilled && (
                <span className="text-xs text-muted-foreground">
                  Effort and notes are required to save.
                </span>
              )}
            </div>
            {demand.quoteApprovedByCmLeader ? (
              <Callout tone="success" icon={<CheckCircle2 className="size-4" />}>
                Quote approved by CM Leader — you can submit it to the customer from the Governance
                Actions panel.
              </Callout>
            ) : (
              <Callout tone="warning" icon={<Clock className="size-4" />}>
                Saving the draft notifies the CM Leader to approve. You cannot submit the quote to the
                customer until approved.
              </Callout>
            )}
          </div>
        )}

        {/* CM Leader governance hint */}
        {isCm(role) && !demand.quoteApprovedByCmLeader && (
          <Callout
            tone="warning"
            icon={<ShieldCheck className="size-4" />}
            title="Governance gate — your approval is required"
          >
            {savedQuoteFieldsFilled
              ? "Review the SCM Worker's quote draft above. Approve to allow the SCM to submit it to the customer, or reject the demand."
              : 'The SCM Worker has not yet submitted a quote draft. Approve / Reject will be enabled once a draft is saved.'}
          </Callout>
        )}
        {isCm(role) && demand.quoteApprovedByCmLeader && (
          <Callout tone="success" icon={<CheckCircle2 className="size-4" />}>
            You approved this quote
            {demand.quoteApprovedAt ? (
              <>
                {' '}
                on <FormattedDate date={demand.quoteApprovedAt} />
              </>
            ) : null}
            . The SCM Worker can now submit it to the customer.
          </Callout>
        )}
      </div>
    </SectionCard>
  );
}

/* ----------------------- status callout (side panel) ----------------------- */

function StatusCallout({
  demand,
  role,
  changeClosed,
}: {
  demand: Demand;
  role: 'SCM_WORKER' | 'CM_LEADER';
  changeClosed: boolean;
}) {
  switch (demand.status) {
    case 'NEW':
      return (
        <Callout tone="info" icon={<Info className="size-4" />} title="New demand">
          Assign an SCM Worker and start the review to begin the lifecycle.
        </Callout>
      );
    case 'UNDER_REVIEW':
      if (role === 'SCM_WORKER') {
        return demand.quoteApprovedByCmLeader ? (
          <Callout tone="success" icon={<CheckCircle2 className="size-4" />} title="Quote approved">
            Submit the quote to the customer to advance the demand.
          </Callout>
        ) : (
          <Callout tone="warning" icon={<Clock className="size-4" />} title="Quote draft">
            Fill the assessment fields and save the draft. CM Leader approval is required before
            submission.
          </Callout>
        );
      }
      return demand.quoteApprovedByCmLeader ? (
        <Callout tone="success" icon={<ShieldCheck className="size-4" />} title="You approved this quote">
          The SCM Worker can now submit it to the customer.
        </Callout>
      ) : (
        <Callout tone="warning" icon={<ShieldCheck className="size-4" />} title="Governance gate">
          Review the SCM Worker&apos;s quote draft and approve or reject.
        </Callout>
      );
    case 'QUOTED':
      return (
        <Callout tone="info" icon={<Clock className="size-4" />} title="Quoted">
          The quote is with the customer. Awaiting their decision.
        </Callout>
      );
    case 'ACCEPTED':
      return role === 'SCM_WORKER' ? (
        <Callout tone="info" icon={<GitBranch className="size-4" />} title="Quote accepted">
          Create a Change Request and hand it to Change Enablement.
        </Callout>
      ) : (
        <Callout tone="info" icon={<Info className="size-4" />} title="Quote accepted">
          Awaiting SCM Worker to create the Change Request.
        </Callout>
      );
    case 'IN_CHANGE':
      return changeClosed ? (
        <Callout tone="success" icon={<PackageCheck className="size-4" />} title="Change closed">
          The linked change is closed — you can mark this demand fulfilled.
        </Callout>
      ) : (
        <Callout tone="warning" icon={<Clock className="size-4" />} title="Change in progress">
          The linked change is being implemented by Change Enablement.
        </Callout>
      );
    case 'FULFILLED':
      return (
        <Callout tone="success" icon={<CheckCircle2 className="size-4" />} title="Fulfilled">
          The demand has been fulfilled. Close it to complete the lifecycle.
        </Callout>
      );
    case 'REJECTED':
      return (
        <Callout tone="danger" icon={<Ban className="size-4" />} title="Rejected">
          This demand was rejected. Terminal state.
        </Callout>
      );
    case 'REDIRECTED':
      return (
        <Callout tone="danger" icon={<CornerUpRight className="size-4" />} title="Redirected">
          This demand was redirected to a catalog offering. Terminal state.
        </Callout>
      );
    case 'CLOSED':
      return (
        <Callout tone="info" icon={<CheckCircle2 className="size-4" />} title="Closed">
          This demand is closed. Lifecycle complete.
        </Callout>
      );
    default:
      return null;
  }
}

/* ------------------------------ main ------------------------------ */

export default function DemandDetail({
  id,
  role,
}: {
  id: string;
  role: 'SCM_WORKER' | 'CM_LEADER';
}) {
  const { navigate, session } = useApp();
  const qc = useQueryClient();

  const queryKey = useMemo(() => ['demand', id] as const, [id]);

  /* --- demand fetch --- */
  const {
    data: demand,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => apiGet<Demand>(`/api/demands/${id}`),
    enabled: !!id,
  });

  /* --- related services (best-effort, parallel) --- */
  const serviceQueries = useQueries({
    queries: (demand?.relatedServiceIds ?? []).map((sid) => ({
      queryKey: ['service', sid] as const,
      queryFn: () => apiGet<Service>(`/api/services/${sid}`),
      enabled: !!demand,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const relatedServices: Service[] = serviceQueries
    .map((q) => q.data)
    .filter((s): s is Service => !!s);

  /* --- offerings for redirect dialog (lazy) --- */
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectOffering, setRedirectOffering] = useState('');
  const [redirectReason, setRedirectReason] = useState('');
  const { data: offerings, isLoading: offeringsLoading } = useQuery({
    queryKey: ['offerings'] as const,
    queryFn: () => apiGet<ServiceOffering[]>('/api/offerings'),
    enabled: redirectOpen,
    staleTime: 60_000,
    retry: false,
  });

  /* --- SCM workers list for CM_LEADER assignment + workload hints --- */
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignWorker, setAssignWorker] = useState('');
  const { data: scmWorkers, isLoading: scmWorkersLoading } = useQuery({
    queryKey: ['scm-workers'] as const,
    queryFn: () => apiGet<ScmWorkerHint[]>('/api/workers/scm'),
    enabled: isCm(role) && !!demand,
    staleTime: 30_000,
    retry: false,
  });
  const assignedWorkerHint = scmWorkers?.find((w) => w.id === demand?.assignedScmWorkerId);

  /* --- other dialog state --- */
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [handToCeOpen, setHandToCeOpen] = useState(false);
  const [ceImplementationPlan, setCeImplementationPlan] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');

  /* --- mutations --- */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['demands'] });
  };

  const assignMutation = useMutation({
    mutationFn: (workerId: string) =>
      apiPatch<Demand>(`/api/demands/${id}`, { assignedScmWorkerId: workerId }),
    onSuccess: () => {
      toast.success('Demand assigned.');
      invalidate();
      setAssignOpen(false);
      setAssignWorker('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startReviewMutation = useMutation({
    mutationFn: () => apiPost<Demand>(`/api/demands/${id}/review`),
    onSuccess: () => {
      toast.success('Review started. Demand is now Under Review.');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveQuoteMutation = useMutation({
    mutationFn: (body: {
      estimatedEffortDays: number | null;
      estimatedCost: number | null;
      quoteNotes: string | null;
    }) => apiPatch<Demand>(`/api/demands/${id}`, body),
    onSuccess: () => {
      toast.success('Quote draft saved. CM Leader will be notified to approve.');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveQuoteMutation = useMutation({
    mutationFn: () => apiPost<Demand>(`/api/demands/${id}/approve-quote`),
    onSuccess: () => {
      toast.success('Quote approved by CM Leader. SCM Worker can now submit it.');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitQuoteMutation = useMutation({
    mutationFn: () => apiPost<Demand>(`/api/demands/${id}/quote`),
    onSuccess: () => {
      toast.success('Quote submitted to customer.');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (body: { reason: string }) =>
      apiPost<Demand>(`/api/demands/${id}/reject`, body),
    onSuccess: () => {
      toast.success('Demand rejected.');
      invalidate();
      setRejectOpen(false);
      setRejectReason('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const redirectMutation = useMutation({
    mutationFn: (body: { offeringId: string; reason?: string }) =>
      apiPost<Demand>(`/api/demands/${id}/redirect`, body),
    onSuccess: () => {
      toast.success('Demand redirected to catalog offering.');
      invalidate();
      setRedirectOpen(false);
      setRedirectOffering('');
      setRedirectReason('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handToCeMutation = useMutation({
    mutationFn: (body: { affectedServiceIds: string[]; implementationPlan?: string }) =>
      apiPost<Demand>(`/api/demands/${id}/hand-to-ce`, body),
    onSuccess: () => {
      toast.success('Change created and handed to Change Enablement.');
      invalidate();
      setHandToCeOpen(false);
      setCeImplementationPlan('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fulfillMutation = useMutation({
    mutationFn: () => apiPost<Demand>(`/api/demands/${id}/fulfill`),
    onSuccess: () => {
      toast.success('Demand marked fulfilled.');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMutation = useMutation({
    mutationFn: (body: { note?: string }) =>
      apiPost<Demand>(`/api/demands/${id}/close`, body),
    onSuccess: () => {
      toast.success('Demand closed.');
      invalidate();
      setCloseOpen(false);
      setCloseNote('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --- derived state --- */
  const back = () => navigate('demands');
  const isUnderReview = demand?.status === 'UNDER_REVIEW';
  const savedQuoteFieldsFilled =
    !!demand &&
    demand.estimatedEffortDays != null &&
    demand.estimatedEffortDays > 0 &&
    !!demand.quoteNotes?.trim();
  const changeClosed = demand?.change?.status === 'CLOSED';

  /* --- loading --- */
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={back} className="-ml-2 text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to demand queue
        </Button>
        <LoadingState rows={6} />
      </div>
    );
  }

  /* --- error / not found --- */
  if (isError || !demand) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={back} className="-ml-2 text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to demand queue
        </Button>
        <EmptyState
          icon={<AlertTriangle className="size-8" />}
          title="Demand not found"
          description="This demand may have been deleted, or you may not have access to it."
          action={<Button onClick={back}>Back to demand queue</Button>}
        />
      </div>
    );
  }

  const submittedDate = new Date(demand.createdAt);
  const assignedWorkerName = demand.assignedScmWorkerName ?? 'Unassigned';

  /* --- show quote section in QUOTED+ (read-only) --- */
  const showQuoteSection =
    demand.status === 'QUOTED' ||
    demand.status === 'ACCEPTED' ||
    demand.status === 'IN_CHANGE' ||
    demand.status === 'FULFILLED' ||
    demand.status === 'CLOSED';

  /* --- show commitment in ACCEPTED+ if commitmentNotes exists --- */
  const showCommitment =
    (demand.status === 'ACCEPTED' ||
      demand.status === 'IN_CHANGE' ||
      demand.status === 'FULFILLED' ||
      demand.status === 'CLOSED') &&
    !!demand.commitmentNotes;

  // helper to reset and open dialogs
  const openReject = () => {
    setRejectReason('');
    setRejectOpen(true);
  };
  const openRedirect = () => {
    setRedirectOffering('');
    setRedirectReason('');
    setRedirectOpen(true);
  };
  const openHandToCe = () => {
    setCeImplementationPlan('');
    setHandToCeOpen(true);
  };
  const openAssign = () => {
    setAssignWorker('');
    setAssignOpen(true);
  };
  const openClose = () => {
    setCloseNote('');
    setCloseOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Back */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={back}
          className="-ml-2 text-muted-foreground"
        >
          <ArrowLeft className="size-4" /> Back to demand queue
        </Button>
      </div>

      {/* Header */}
      <PageHeader
        title={demand.title}
        description={`${demand.serviceCustomerName ?? 'Unknown customer'}  ·  Submitted ${submittedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}  ·  SCM: ${assignedWorkerName}`}
        actions={<DemandStatusBadge status={demand.status} />}
      />

      {/* Status Timeline */}
      <SectionCard>
        <DemandPipelineTimeline status={demand.status} />
      </SectionCard>

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Terminal state callout */}
          {(demand.status === 'REJECTED' || demand.status === 'REDIRECTED') && (
            <SectionCard title="Outcome">
              <Callout
                tone="danger"
                icon={<Ban className="size-4" />}
                title={demand.status === 'REJECTED' ? 'Demand rejected' : 'Demand redirected'}
              >
                {demand.status === 'REJECTED'
                  ? demand.rejectionReason ?? 'No reason recorded.'
                  : 'This demand was redirected to an existing catalog offering. No further action is required.'}
              </Callout>
            </SectionCard>
          )}

          {/* Customer Input */}
          <SectionCard title="Customer Input" description="As submitted by the Service Customer.">
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Description
                </h4>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{demand.description}</p>
              </div>
              {demand.businessJustification && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                    Business Justification
                  </h4>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {demand.businessJustification}
                  </p>
                </div>
              )}
              {demand.desiredTimeline && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                  <Calendar className="size-4" />
                  <span>
                    Desired timeline: <span className="text-foreground">{demand.desiredTimeline}</span>
                  </span>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Catalog Check Panel — UNDER_REVIEW */}
          {isUnderReview && (
            <SectionCard
              title="Catalog Check"
              description="Verify whether the customer need is already covered by a catalog offering."
            >
              <Callout
                tone="info"
                icon={<Info className="size-4" />}
                title="Catalog verification step"
              >
                Check whether the service catalog already covers this need. If it does, redirect the demand
                to the relevant offering. If not, proceed to prepare a quote in the assessment fields below.
              </Callout>
              {isScm(role) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={openRedirect}>
                    <CornerUpRight className="size-4" /> Mark as Covered — Redirect
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById('assessment-section');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    <ArrowRightLeft className="size-4" /> Proceed to Quote
                  </Button>
                </div>
              )}
            </SectionCard>
          )}

          {/* Assessment Fields — UNDER_REVIEW (sub-component, remounts on demand.id) */}
          {isUnderReview && (
            <AssessmentFieldsSection
              key={demand.id}
              demand={demand}
              role={role}
              onSave={saveQuoteMutation.mutate}
              savePending={saveQuoteMutation.isPending}
            />
          )}

          {/* Quote section — QUOTED+ (read-only) */}
          {showQuoteSection && (
            <SectionCard
              title="Quote"
              description="The quote submitted to the Service Customer."
              actions={
                demand.quoteApprovedByCmLeader ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                  >
                    <ShieldCheck className="size-3.5" /> CM Approved
                  </Badge>
                ) : undefined
              }
            >
              <dl className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <KeyValue
                    label="Estimated Effort"
                    value={<Days value={demand.estimatedEffortDays} />}
                  />
                  <KeyValue
                    label="Estimated Cost"
                    value={<Money value={demand.estimatedCost} />}
                  />
                </div>
                <KeyValue
                  label="Quote Notes"
                  value={
                    demand.quoteNotes ? (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{demand.quoteNotes}</p>
                    ) : null
                  }
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <KeyValue
                    label="CM Leader Approval"
                    value={
                      demand.quoteApprovedByCmLeader ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="size-3.5" /> Approved
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not approved</span>
                      )
                    }
                  />
                  <KeyValue
                    label="Approved At"
                    value={
                      demand.quoteApprovedAt ? <FormattedDate date={demand.quoteApprovedAt} /> : null
                    }
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <KeyValue
                    label="Quoted At"
                    value={demand.quotedAt ? <FormattedDate date={demand.quotedAt} /> : null}
                  />
                  <KeyValue
                    label="Accepted At"
                    value={demand.acceptedAt ? <FormattedDate date={demand.acceptedAt} /> : null}
                  />
                </div>
              </dl>
            </SectionCard>
          )}

          {/* Commitment — ACCEPTED+ */}
          {showCommitment && (
            <SectionCard
              title="Commitment"
              description="The commitment given to the customer upon acceptance."
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{demand.commitmentNotes}</p>
            </SectionCard>
          )}

          {/* Linked Change — IN_CHANGE / FULFILLED */}
          {(demand.status === 'IN_CHANGE' || demand.status === 'FULFILLED') && (
            <SectionCard
              title="Linked Change Request"
              description="The change raised in Change Enablement to fulfill this demand."
            >
              {demand.change ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{demand.change.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {demand.change.type} · {demand.change.complexity ?? '—'} complexity
                      </p>
                    </div>
                    <ChangeStatusBadge status={demand.change.status} />
                  </div>
                  {demand.change.implementationPlan && (
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                        Implementation Plan
                      </h4>
                      <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3 max-h-48 overflow-y-auto scrollbar-thin leading-relaxed">
                        {demand.change.implementationPlan}
                      </p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('change-detail', { id: demand.change!.id })}
                  >
                    <GitBranch className="size-4" /> Open Change Record
                  </Button>
                </div>
              ) : (
                <EmptyState
                  icon={<GitBranch className="size-6" />}
                  title="No linked change"
                  description="The change request is not yet linked to this demand."
                />
              )}
            </SectionCard>
          )}

          {/* Activity Log */}
          <SectionCard title="Activity Log" description="Full audit trail of this demand.">
            {demand.events && demand.events.length > 0 ? (
              <ActivityLog events={demand.events} />
            ) : (
              <EmptyState icon={<MessageSquare className="size-6" />} title="No activity yet" />
            )}
          </SectionCard>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {/* Demand Meta */}
          <SectionCard title="Demand Meta">
            <dl className="space-y-3.5">
              <KeyValue
                label="Customer"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5 text-muted-foreground" />
                    {demand.serviceCustomerName ?? '—'}
                  </span>
                }
              />
              <KeyValue label="Submitted By" value={demand.submittedByName ?? '—'} />
              <KeyValue
                label="Assigned SCM Worker"
                value={
                  demand.assignedScmWorkerName ? (
                    <div>
                      <div className="inline-flex items-center gap-2">
                        <UserAvatar name={demand.assignedScmWorkerName} size="sm" />
                        <span>{demand.assignedScmWorkerName}</span>
                      </div>
                      {isCm(role) && assignedWorkerHint && (
                        <p className="text-xs text-muted-foreground mt-1.5 ml-9">
                          {assignedWorkerHint.openDemandCount} open{' '}
                          {assignedWorkerHint.openDemandCount === 1 ? 'demand' : 'demands'} in queue
                        </p>
                      )}
                      {isCm(role) && !assignedWorkerHint && scmWorkers && (
                        <p className="text-xs text-muted-foreground mt-1.5 ml-9">
                          Workload data unavailable
                        </p>
                      )}
                    </div>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-900 dark:bg-amber-950"
                    >
                      Unassigned
                    </Badge>
                  )
                }
              />
              <Separator />
              <KeyValue label="Submitted" value={<FormattedDate date={demand.createdAt} />} />
              <KeyValue
                label="Last Updated"
                value={<RelativeTime date={demand.updatedAt} />}
              />
            </dl>
          </SectionCard>

          {/* Related Services */}
          <SectionCard
            title="Related Services"
            description="Services referenced by the customer in the demand."
          >
            {demand.relatedServiceIds.length === 0 ? (
              <EmptyState
                icon={<Wrench className="size-6" />}
                title="No related services"
                description="This demand did not reference any existing service."
              />
            ) : relatedServices.length === 0 ? (
              <LoadingState rows={Math.min(3, demand.relatedServiceIds.length)} />
            ) : (
              <ul className="space-y-2">
                {relatedServices.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 capitalize">
                        {s.chapter.replace(/_/g, ' ').toLowerCase()} · {s.layer.toLowerCase()}
                      </p>
                    </div>
                    <SlaClassBadge slaClass={s.slaClass} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Governance Actions (sticky on lg) */}
          <div className="lg:sticky lg:top-4">
            <SectionCard
              title="Governance Actions"
              description={isScm(role) ? 'SCM Worker actions' : 'CM Leader actions'}
            >
              <div className="space-y-3">
                {/* Context callout */}
                <StatusCallout demand={demand} role={role} changeClosed={!!changeClosed} />

                {/* Action buttons */}
                <div className="space-y-2">
                  {/* NEW */}
                  {demand.status === 'NEW' && (
                    <>
                      {isScm(role) && (
                        <ActionButton
                          onClick={() => session && assignMutation.mutate(session.id)}
                          pending={assignMutation.isPending}
                        >
                          <UserPlus className="size-4" /> Assign to Me
                        </ActionButton>
                      )}
                      {isCm(role) && (
                        <ActionButton onClick={openAssign}>
                          <UserPlus className="size-4" /> Assign Worker…
                        </ActionButton>
                      )}
                      <ActionButton
                        variant="secondary"
                        onClick={() => startReviewMutation.mutate()}
                        pending={startReviewMutation.isPending}
                      >
                        <Play className="size-4" /> Start Review
                      </ActionButton>
                    </>
                  )}

                  {/* UNDER_REVIEW — SCM_WORKER */}
                  {demand.status === 'UNDER_REVIEW' && isScm(role) && (
                    <>
                      {demand.quoteApprovedByCmLeader ? (
                        <ActionButton
                          onClick={() => submitQuoteMutation.mutate()}
                          pending={submitQuoteMutation.isPending}
                        >
                          <Send className="size-4" /> Submit Quote to Customer
                        </ActionButton>
                      ) : (
                        <Callout tone="info" icon={<FileCheck2 className="size-4" />}>
                          Fill the assessment fields and click <span className="font-semibold">Save Quote
                          Draft</span> above. The CM Leader will then approve.
                        </Callout>
                      )}
                      <ActionButton variant="outline" onClick={openRedirect}>
                        <CornerUpRight className="size-4" /> Redirect to Offering…
                      </ActionButton>
                      <ActionButton variant="destructive" onClick={openReject}>
                        <Ban className="size-4" /> Reject Demand…
                      </ActionButton>
                    </>
                  )}

                  {/* UNDER_REVIEW — CM_LEADER */}
                  {demand.status === 'UNDER_REVIEW' && isCm(role) && (
                    <>
                      {demand.quoteApprovedByCmLeader ? (
                        <Callout tone="success" icon={<CheckCircle2 className="size-4" />}>
                          You approved this quote. The SCM Worker can now submit it to the customer.
                        </Callout>
                      ) : (
                        <ActionButton
                          onClick={() => approveQuoteMutation.mutate()}
                          pending={approveQuoteMutation.isPending}
                          disabled={!savedQuoteFieldsFilled}
                        >
                          <ShieldCheck className="size-4" /> Approve Quote
                        </ActionButton>
                      )}
                      <ActionButton variant="destructive" onClick={openReject}>
                        <Ban className="size-4" /> Reject Demand…
                      </ActionButton>
                    </>
                  )}

                  {/* QUOTED — waiting on customer */}
                  {demand.status === 'QUOTED' && (
                    <Callout tone="info" icon={<Clock className="size-4" />}>
                      Awaiting customer decision — the customer will accept or decline the quote.
                    </Callout>
                  )}

                  {/* ACCEPTED — SCM creates change */}
                  {demand.status === 'ACCEPTED' && isScm(role) && (
                    <ActionButton
                      onClick={openHandToCe}
                      pending={handToCeMutation.isPending}
                    >
                      <GitBranch className="size-4" /> Create Change &amp; Hand to CE…
                    </ActionButton>
                  )}
                  {demand.status === 'ACCEPTED' && isCm(role) && (
                    <Callout tone="info" icon={<Info className="size-4" />}>
                      Awaiting SCM Worker to create a Change Request and hand it to Change Enablement.
                    </Callout>
                  )}

                  {/* IN_CHANGE — mark fulfilled when change CLOSED */}
                  {demand.status === 'IN_CHANGE' && (
                    <>
                      <ActionButton
                        onClick={() => fulfillMutation.mutate()}
                        pending={fulfillMutation.isPending}
                        disabled={!changeClosed}
                      >
                        <PackageCheck className="size-4" /> Mark Fulfilled
                      </ActionButton>
                      {!changeClosed && (
                        <Callout tone="warning" icon={<Clock className="size-4" />}>
                          The linked change must be CLOSED before this demand can be fulfilled.
                        </Callout>
                      )}
                    </>
                  )}

                  {/* FULFILLED — close */}
                  {demand.status === 'FULFILLED' && (
                    <ActionButton onClick={openClose} pending={closeMutation.isPending}>
                      <CheckCircle2 className="size-4" /> Close Demand…
                    </ActionButton>
                  )}

                  {/* Terminal states */}
                  {(demand.status === 'REJECTED' ||
                    demand.status === 'REDIRECTED' ||
                    demand.status === 'CLOSED') && (
                    <Callout tone="info" icon={<Info className="size-4" />}>
                      This demand is in a terminal state — no further governance actions are available.
                    </Callout>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        reason={rejectReason}
        setReason={setRejectReason}
        onConfirm={() => rejectMutation.mutate({ reason: rejectReason.trim() })}
        pending={rejectMutation.isPending}
      />
      <RedirectDialog
        open={redirectOpen}
        onOpenChange={setRedirectOpen}
        offerings={offerings ?? []}
        offeringsLoading={offeringsLoading}
        offering={redirectOffering}
        setOffering={setRedirectOffering}
        reason={redirectReason}
        setReason={setRedirectReason}
        onConfirm={() =>
          redirectMutation.mutate({
            offeringId: redirectOffering,
            reason: redirectReason.trim() || undefined,
          })
        }
        pending={redirectMutation.isPending}
      />
      <HandToCeDialog
        open={handToCeOpen}
        onOpenChange={setHandToCeOpen}
        relatedServices={relatedServices}
        plan={ceImplementationPlan}
        setPlan={setCeImplementationPlan}
        onConfirm={() =>
          handToCeMutation.mutate({
            affectedServiceIds: demand.relatedServiceIds,
            implementationPlan: ceImplementationPlan.trim() || undefined,
          })
        }
        pending={handToCeMutation.isPending}
      />
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        workers={scmWorkers ?? []}
        workersLoading={scmWorkersLoading}
        selected={assignWorker}
        setSelected={setAssignWorker}
        onConfirm={() => assignWorker && assignMutation.mutate(assignWorker)}
        pending={assignMutation.isPending}
      />
      <CloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        note={closeNote}
        setNote={setCloseNote}
        onConfirm={() => closeMutation.mutate({ note: closeNote.trim() || undefined })}
        pending={closeMutation.isPending}
      />
    </div>
  );
}
