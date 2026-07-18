'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  XCircle,
  CheckCheck,
  AlertTriangle,
  Compass,
  UserCog,
  ClipboardList,
  StickyNote,
  GitBranch,
  History,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import {
  type Demand,
  type Service,
} from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  DemandStatusBadge,
  DemandPipelineTimeline,
  ActivityLog,
  UserAvatar,
  KeyValue,
  Money,
  Days,
  FormattedDate,
  RelativeTime,
  EmptyState,
  LoadingState,
  Button,
  Badge,
} from '@/components/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import EntityLinks from '@/components/workspaces/shared/EntityLinks';

export default function DemandDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const demandQ = useQuery({
    queryKey: ['demand', id],
    queryFn: () => apiGet<Demand>(`/api/demands/${id}`),
    enabled: !!id,
  });

  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });

  const demand = demandQ.data;
  const services = servicesQ.data ?? [];

  const relatedServices = useMemo(() => {
    if (!demand) return [];
    return (demand.relatedServiceIds ?? [])
      .map((sid) => services.find((s) => s.id === sid))
      .filter((s): s is Service => !!s);
  }, [demand, services]);

  const acceptMut = useMutation({
    mutationFn: () => apiPost<Demand>(`/api/demands/${id}/accept`),
    onSuccess: () => {
      toast.success('Quote accepted', {
        description: 'The SCM team will create a Change Request and hand it to Change Enablement.',
      });
      qc.invalidateQueries({ queryKey: ['demand', id] });
      qc.invalidateQueries({ queryKey: ['demands'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (e: Error) => toast.error('Could not accept quote', { description: e.message }),
  });

  const closeMut = useMutation({
    mutationFn: (body: { reason?: string }) => apiPost<Demand>(`/api/demands/${id}/close`, body),
    onSuccess: (_data, vars) => {
      toast.success(vars.reason ? 'Quote declined' : 'Demand closed');
      qc.invalidateQueries({ queryKey: ['demand', id] });
      qc.invalidateQueries({ queryKey: ['demands'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (e: Error) => toast.error('Action failed', { description: e.message }),
  });

  if (demandQ.isLoading) {
    return (
      <div className="space-y-5">
        <BackHeader onBack={() => navigate('demands')} />
        <LoadingState rows={6} />
      </div>
    );
  }

  if (demandQ.isError || !demand) {
    return (
      <div className="space-y-5">
        <BackHeader onBack={() => navigate('demands')} />
        <EmptyState
          icon={<AlertTriangle className="h-10 w-10" />}
          title="Demand not found"
          description="This demand may have been removed or you may not have access to it."
          action={
            <Button variant="outline" onClick={() => navigate('demands')} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to demands
            </Button>
          }
        />
      </div>
    );
  }

  const showScmAssessment =
    demand.status === 'QUOTED' ||
    demand.status === 'ACCEPTED' ||
    demand.status === 'IN_CHANGE' ||
    demand.status === 'FULFILLED' ||
    demand.status === 'CLOSED';

  const showCommitment =
    demand.status === 'ACCEPTED' ||
    demand.status === 'IN_CHANGE' ||
    demand.status === 'FULFILLED' ||
    demand.status === 'CLOSED';

  return (
    <div className="space-y-5">
      <BackHeader onBack={() => navigate('demands')} />

      <PageHeader
        title={demand.title}
        description={`Submitted ${new Date(demand.createdAt).toLocaleDateString()}`}
        icon={<FileText className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DemandStatusBadge status={demand.status} />
            {demand.quoteApprovedByCmLeader && (
              <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCheck className="h-3 w-3" /> CM Leader Approved
              </Badge>
            )}
          </div>
        }
      />

      {/* Pipeline timeline */}
      <SectionCard>
        <DemandPipelineTimeline status={demand.status} />
      </SectionCard>

      {/* Terminal-status alerts */}
      {demand.status === 'REJECTED' && demand.rejectionReason && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Demand rejected</AlertTitle>
          <AlertDescription className="mt-1 leading-relaxed">{demand.rejectionReason}</AlertDescription>
        </Alert>
      )}
      {demand.status === 'CLOSED' && demand.rejectionReason && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Quote declined</AlertTitle>
          <AlertDescription className="mt-1 leading-relaxed">{demand.rejectionReason}</AlertDescription>
        </Alert>
      )}
      {demand.status === 'REDIRECTED' && (
        <Alert>
          <Compass className="h-4 w-4" />
          <AlertTitle>Demand redirected</AlertTitle>
          <AlertDescription className="mt-1 leading-relaxed">
            This demand has been redirected to a more appropriate fulfillment path.{' '}
            {demand.rejectionReason
              ? demand.rejectionReason
              : 'Contact your SCM Worker for guidance on the standard catalog offering that fits your need.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Customer actions */}
      {demand.status === 'QUOTED' && (
        <SectionCard
          title="Your decision required"
          description="This quote has been approved by the CM Leader and is ready for your accept or decline."
        >
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="gap-2 flex-1 sm:flex-none">
                  <CheckCircle2 className="h-4 w-4" /> Accept Quote
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Accept this quote?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Accepting commits your organisation to the quoted effort and cost. The SCM team will raise a Change Request and hand it to Change Enablement for delivery.
                    {demand.estimatedEffortDays != null && ` Effort: ${demand.estimatedEffortDays} days.`}
                    {demand.estimatedCost != null && ` Cost: $${demand.estimatedCost.toLocaleString()}.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={acceptMut.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={acceptMut.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      acceptMut.mutate();
                    }}
                  >
                    {acceptMut.isPending ? 'Accepting…' : 'Accept Quote'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <DeclineDialog
              onConfirm={(reason) => closeMut.mutate({ reason })}
              loading={closeMut.isPending}
            />
          </div>
        </SectionCard>
      )}

      {demand.status === 'FULFILLED' && (
        <SectionCard
          title="Demand fulfilled"
          description="The change has been delivered. Please review and close this demand to complete the lifecycle."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="gap-2">
                <CheckCheck className="h-4 w-4" /> Close Demand
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close this demand?</AlertDialogTitle>
                <AlertDialogDescription>
                  Closing confirms you are satisfied with the delivered outcome. The demand will move to <strong>Closed</strong> and be archived in your history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={closeMut.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={closeMut.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    closeMut.mutate({});
                  }}
                >
                  {closeMut.isPending ? 'Closing…' : 'Close Demand'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SectionCard>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: Summary + Assessment + Commitment + Services */}
        <div className="space-y-5 lg:col-span-2">
          <SectionCard title="Summary" description="Demand details as you submitted them.">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KeyValue label="Title" value={demand.title} className="sm:col-span-2" />
              <KeyValue
                label="Description"
                value={<p className="whitespace-pre-wrap leading-relaxed">{demand.description}</p>}
                className="sm:col-span-2"
              />
              {demand.businessJustification && (
                <KeyValue
                  label="Business Justification"
                  value={<p className="whitespace-pre-wrap leading-relaxed">{demand.businessJustification}</p>}
                  className="sm:col-span-2"
                />
              )}
              {demand.desiredTimeline && (
                <KeyValue label="Desired Timeline" value={demand.desiredTimeline} />
              )}
              <KeyValue label="Submitted" value={<FormattedDate date={demand.createdAt} />} />
              <KeyValue
                label="Last Updated"
                value={<RelativeTime date={demand.updatedAt} />}
              />
            </dl>
          </SectionCard>

          {showScmAssessment && (
            <SectionCard
              title="SCM Assessment"
              description="Quote prepared by your Service Customer Manager."
              actions={<Badge variant="outline" className="gap-1"><StickyNote className="h-3 w-3" /> Quote</Badge>}
            >
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KeyValue label="Estimated Effort" value={<Days value={demand.estimatedEffortDays} />} />
                <KeyValue label="Estimated Cost" value={<Money value={demand.estimatedCost} />} />
                {demand.quotedAt && <KeyValue label="Quote Date" value={<FormattedDate date={demand.quotedAt} />} />}
                {demand.quoteApprovedAt && (
                  <KeyValue label="CM Leader Approval" value={<FormattedDate date={demand.quoteApprovedAt} />} />
                )}
                {demand.quoteNotes && (
                  <KeyValue
                    label="Quote Notes"
                    value={<p className="whitespace-pre-wrap leading-relaxed">{demand.quoteNotes}</p>}
                    className="sm:col-span-2"
                  />
                )}
              </dl>
            </SectionCard>
          )}

          {showCommitment && (
            <SectionCard
              title="Commitment Terms"
              description="Agreed SLA and delivery commitment after acceptance."
              actions={<Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Committed</Badge>}
            >
              {demand.commitmentNotes ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{demand.commitmentNotes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Commitment notes will be recorded by your SCM Worker upon acceptance.
                </p>
              )}
              {demand.acceptedAt && (
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <KeyValue label="Accepted On" value={<FormattedDate date={demand.acceptedAt} />} />
                  {demand.handedToCeAt && (
                    <KeyValue label="Handed to CE" value={<FormattedDate date={demand.handedToCeAt} />} />
                  )}
                  {demand.fulfilledAt && (
                    <KeyValue label="Fulfilled On" value={<FormattedDate date={demand.fulfilledAt} />} />
                  )}
                  {demand.closedAt && <KeyValue label="Closed On" value={<FormattedDate date={demand.closedAt} />} />}
                </dl>
              )}
            </SectionCard>
          )}

          {relatedServices.length > 0 && (
            <SectionCard
              title="Related Services"
              description="Catalog services this demand concerns."
              actions={<Badge variant="outline" className="gap-1"><GitBranch className="h-3 w-3" /> {relatedServices.length}</Badge>}
            >
              <ul className="divide-y">
                {relatedServices.map((s) => (
                  <li key={s.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        onClick={() => navigate('catalog')}
                        className="text-sm font-medium hover:text-primary hover:underline text-left truncate block"
                      >
                        {s.name}
                      </button>
                      <p className="text-xs text-muted-foreground truncate">{s.chapter.replace(/_/g, ' ')}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">Class {s.slaClass}</Badge>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>

        {/* Right: SCM contact + Activity log */}
        <div className="space-y-5">
          <SectionCard title="Your Named Contact">
            {demand.assignedScmWorkerName ? (
              <div className="flex items-start gap-3">
                <UserAvatar name={demand.assignedScmWorkerName} size="lg" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{demand.assignedScmWorkerName}</p>
                  <p className="text-xs text-muted-foreground">Service Customer Manager</p>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    Your single point of contact for this demand across its lifecycle — from quoting through delivery and closure.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                  <UserCog className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-sm font-medium">Awaiting assignment</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    A Service Customer Manager will be assigned to your demand shortly.
                  </p>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Activity Log"
            description="Lifecycle events in chronological order."
            actions={<History className="h-4 w-4 text-muted-foreground" />}
          >
            {demand.events && demand.events.length > 0 ? (
              <ActivityLog events={demand.events} />
            ) : (
              <EmptyState
                icon={<ClipboardList className="h-8 w-8" />}
                title="No events yet"
                description="Lifecycle events will appear here as the demand progresses."
              />
            )}
          </SectionCard>

          {/* Related entities — read-only view of links created by SCM/CM. */}
          <EntityLinks entityType="DEMAND" entityId={demand.id} readOnly />
        </div>
      </div>
    </div>
  );
}

function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to demands
      </Button>
    </div>
  );
}

function DeclineDialog({
  onConfirm,
  loading,
}: {
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error('Please provide a reason for declining');
      return;
    }
    onConfirm(reason.trim());
    setOpen(false);
    setReason('');
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (!v) setReason('');
    }}>
      <Button
        variant="outline"
        className="gap-2 flex-1 sm:flex-none text-rose-700 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900/60"
        onClick={() => setOpen(true)}
      >
        <XCircle className="h-4 w-4" /> Decline Quote
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline this quote?</DialogTitle>
          <DialogDescription>
            Please share why you are declining. This helps your SCM team refine the proposal or redirect the demand to a more appropriate offering.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="decline-reason" className="text-sm font-medium">
            Reason <span className="text-rose-600">*</span>
          </label>
          <Textarea
            id="decline-reason"
            placeholder="e.g. The proposed timeline exceeds our budget cycle window. Could we phase the delivery?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !reason.trim()}
            className="gap-2"
          >
            {loading ? 'Submitting…' : (<><XCircle className="h-4 w-4" /> Decline Quote</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
