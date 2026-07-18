'use client';

import { useApp } from '@/lib/store';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  DemandStatusBadge,
  DemandPipelineTimeline,
  ActivityLog,
  KeyValue,
  Money,
  Days,
  Button,
} from '@/components/shared';
import { ArrowLeft, FileText, Users } from 'lucide-react';
import { useDemand, useOwnerServices } from './_hooks';

/**
 * Read-only demand detail for the Service Owner.
 * Provides governance context for the demand they are approving a service commitment on.
 */
export default function DemandDetail({ id }: { id?: string }) {
  const { navigate } = useApp();
  const demandQ = useDemand(id);
  const servicesQ = useOwnerServices();

  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Demand Detail" description="Read-only view of a demand record." />
        <SectionCard>
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No demand selected"
            description="Open a demand from the Governance Approvals view to see its detail here."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate('governance')}>
                Back to Governance
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  if (demandQ.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Demand Detail" description="Read-only view of a demand record." />
        <LoadingState rows={5} />
      </div>
    );
  }

  if (demandQ.isError || !demandQ.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Demand Detail" description="Read-only view of a demand record." />
        <SectionCard>
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="Demand not found"
            description="This demand may have been closed or removed."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate('governance')}>
                Back to Governance
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  const d = demandQ.data;
  const myServiceIds = new Set((servicesQ.data ?? []).map((s) => s.id));
  const affectedMine = d.relatedServiceIds.filter((sid) => myServiceIds.has(sid));
  const myServiceNames = (servicesQ.data ?? [])
    .filter((s) => affectedMine.includes(s.id))
    .map((s) => s.name);

  const events = d.events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demand Detail"
        description="Read-only governance context for a demand on your service."
        icon={<FileText className="h-6 w-6" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('governance')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back to Governance
          </Button>
        }
      />

      {/* Demand meta */}
      <SectionCard
        title={d.title}
        description={`Submitted ${new Date(d.createdAt).toLocaleDateString()}`}
        actions={<DemandStatusBadge status={d.status} />}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground/90">{d.description}</p>

          {d.businessJustification && (
            <div className="rounded-md bg-muted/50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Business Justification
              </div>
              <p className="text-sm leading-relaxed">{d.businessJustification}</p>
            </div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <KeyValue label="Customer" value={d.serviceCustomerName ?? '—'} />
            <KeyValue
              label="SCM Worker"
              value={d.assignedScmWorkerName ?? 'Unassigned'}
            />
            <KeyValue
              label="Services Affected (yours)"
              value={
                myServiceNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {myServiceNames.map((n) => (
                      <span
                        key={n}
                        className="inline-flex items-center rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs font-medium px-1.5 py-0.5"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                ) : (
                  'None on your portfolio'
                )
              }
            />
            <KeyValue label="Desired Timeline" value={d.desiredTimeline ?? '—'} />
            <KeyValue label="Estimated Effort" value={<Days value={d.estimatedEffortDays} />} />
            <KeyValue label="Estimated Cost" value={<Money value={d.estimatedCost} />} />
          </dl>

          {d.commitmentNotes && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300 mb-1 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Proposed Service Commitment
              </div>
              <p className="text-sm leading-relaxed">{d.commitmentNotes}</p>
            </div>
          )}

          {d.quoteNotes && (
            <div className="rounded-md bg-muted/50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Quote Notes
              </div>
              <p className="text-sm leading-relaxed">{d.quoteNotes}</p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Status timeline */}
      <SectionCard
        title="Demand Status Timeline"
        description="Lifecycle stage of this demand through the SCM pipeline."
      >
        <DemandPipelineTimeline status={d.status} className="py-2" />
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <KeyDate label="Quoted" date={d.quotedAt} />
          <KeyDate label="Accepted" date={d.acceptedAt} />
          <KeyDate label="Handed to CE" date={d.handedToCeAt} />
          <KeyDate label="Fulfilled" date={d.fulfilledAt} />
        </div>
      </SectionCard>

      {/* Activity log */}
      <SectionCard
        title="Activity Log"
        description="Chronological record of every transition on this demand."
      >
        {events.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="No activity recorded"
            description="Events will appear here as the demand progresses through its lifecycle."
          />
        ) : (
          <ActivityLog events={events} />
        )}
      </SectionCard>
    </div>
  );
}

function KeyDate({ label, date }: { label: string; date: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm tabular-nums">
        {date ? new Date(date).toLocaleDateString() : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
