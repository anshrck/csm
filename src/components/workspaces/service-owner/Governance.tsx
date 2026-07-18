'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import type { Demand } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  ChangeStatusBadge,
  DemandStatusBadge,
  RelativeTime,
  Button,
  Badge,
} from '@/components/shared';
import {
  ShieldCheck,
  Gavel,
  CheckCircle2,
  ArrowUpCircle,
  FileText,
  GitBranch,
  Users,
  ArrowRight,
} from 'lucide-react';
import {
  useOwnerServices,
  useAcceptedDemands,
  useAllChanges,
} from './_hooks';

export default function Governance() {
  const { navigate } = useApp();
  const servicesQ = useOwnerServices();
  const demandsQ = useAcceptedDemands();
  const changesQ = useAllChanges();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);

  const demandsAwaiting = useMemo(
    () =>
      (demandsQ.data ?? []).filter((d) =>
        d.relatedServiceIds.some((sid) => myServiceIds.has(sid)),
      ),
    [demandsQ.data, myServiceIds],
  );

  const myChanges = useMemo(
    () =>
      (changesQ.data ?? []).filter((c) => c.affectedServiceIds.some((sid) => myServiceIds.has(sid))),
    [changesQ.data, myServiceIds],
  );

  const catalogProposals = myChanges.filter((c) => c.status === 'PLANNING');
  const changeBoardItems = myChanges.filter((c) => c.complexity === 'COMPLEX');

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
  const serviceSlaClass = (id: string) => services.find((s) => s.id === id)?.slaClass;

  const loading = servicesQ.isLoading || demandsQ.isLoading || changesQ.isLoading;

  function handleApprove(d: Demand) {
    toast.success(`Service commitment approved`, {
      description: `"${d.title}" — commitment recorded for ${serviceName(d.relatedServiceIds[0] ?? '')}.`,
    });
  }
  function handleEscalate(d: Demand) {
    toast.info(`Demand escalated to Governance Owner`, {
      description: `"${d.title}" escalated beyond Service Owner authority.`,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Approvals"
        description="As Service Owner you approve service commitments at demand acceptance, review catalog change proposals, and sit on the Change Board for complex changes on your services."
        icon={<ShieldCheck className="h-6 w-6" />}
      />

      {/* Escalation chain reference */}
      <SectionCard
        title="Escalation Chain"
        description="Your accountability sits between the CM Leader (who authorises quotes) and the Governance Owner (who holds enterprise risk authority)."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-rose-500/20 flex items-center justify-center">
              <Users className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-300">CM Leader</div>
              <div className="text-[11px] text-muted-foreground">Quote authorisation gate</div>
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          <div className="flex items-center gap-2 rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                You · Service Owner
              </div>
              <div className="text-[11px] text-muted-foreground">Commitment & catalog approval</div>
            </div>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          <div className="flex items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/40 dark:bg-violet-950/20 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Gavel className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-violet-800 dark:text-violet-300">
                Governance Owner
              </div>
              <div className="text-[11px] text-muted-foreground">Enterprise risk authority</div>
            </div>
          </div>
        </div>
      </SectionCard>

      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {/* Demand commitments awaiting approval */}
          <SectionCard
            title="Service Commitments Awaiting Your Approval"
            description="Accepted demands on your services — the customer has accepted the quote and you must approve the service commitment (SLA class, delivery window, support model) before the change is created."
          >
            {demandsAwaiting.length === 0 ? (
              <EmptyState
                icon={<Gavel className="h-8 w-8" />}
                title="No commitments awaiting approval"
                description="When a customer accepts a quote on your service, the commitment request appears here."
              />
            ) : (
              <div className="space-y-3">
                {demandsAwaiting.map((d) => {
                  const myServiceId = d.relatedServiceIds.find((sid) => myServiceIds.has(sid));
                  const slaClass = myServiceId ? serviceSlaClass(myServiceId) : undefined;
                  return (
                    <div
                      key={d.id}
                      className="rounded-lg border p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold">{d.title}</h3>
                            <DemandStatusBadge status={d.status} />
                            {slaClass && <SlaClassBadge slaClass={slaClass} />}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" /> {d.serviceCustomerName ?? 'Customer'}
                            </span>
                            <span>·</span>
                            <span>SCM: {d.assignedScmWorkerName ?? 'Unassigned'}</span>
                            <span>·</span>
                            <span>Service: {myServiceId ? serviceName(myServiceId) : '—'}</span>
                            <span>·</span>
                            <RelativeTime date={d.acceptedAt ?? d.createdAt} />
                          </div>
                          {d.commitmentNotes && (
                            <div className="mt-2.5 rounded-md bg-muted/60 p-2.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                Proposed Commitment
                              </div>
                              <p className="text-xs leading-relaxed text-foreground/90">
                                {d.commitmentNotes}
                              </p>
                            </div>
                          )}
                          {d.estimatedEffortDays != null && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Estimated effort: {d.estimatedEffortDays} days
                              {d.estimatedCost != null && ` · est. cost $${d.estimatedCost.toLocaleString()}`}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleApprove(d)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => handleEscalate(d)}
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-xs"
                            onClick={() => navigate('demand-detail', { id: d.id })}
                          >
                            <FileText className="h-3.5 w-3.5" /> View detail
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Catalog change proposals */}
            <SectionCard
              title="Catalog Change Proposals"
              description="Changes in PLANNING status affecting your services — review proposed catalog updates before approval."
            >
              {catalogProposals.length === 0 ? (
                <EmptyState
                  icon={<GitBranch className="h-7 w-7" />}
                  title="No catalog proposals in planning"
                  description="Catalog changes in PLANNING status on your services will appear here."
                />
              ) : (
                <ul className="divide-y">
                  {catalogProposals.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Affects:{' '}
                            {c.affectedServiceIds
                              .filter((sid) => myServiceIds.has(sid))
                              .map((sid) => serviceName(sid))
                              .join(', ')}
                          </div>
                        </div>
                        <ChangeStatusBadge status={c.status} className="shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* Change Board items */}
            <SectionCard
              title="Change Board Items"
              description="Complex changes on your services requiring Change Board review."
            >
              {changeBoardItems.length === 0 ? (
                <EmptyState
                  icon={<Gavel className="h-7 w-7" />}
                  title="No complex changes pending"
                  description="Complex changes affecting your services will surface here for Change Board review."
                />
              ) : (
                <ul className="divide-y">
                  {changeBoardItems.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            CE: {c.assignedCeWorkerName ?? 'Unassigned'} ·{' '}
                            <RelativeTime date={c.createdAt} />
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 shrink-0"
                        >
                          {c.complexity}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
