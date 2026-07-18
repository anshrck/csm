'use client';

import { useMemo } from 'react';
import { useApp } from '@/lib/store';
import {
  PageHeader,
  StatCard,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  DemandStatusBadge,
  RelativeTime,
  Button,
} from '@/components/shared';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Briefcase,
  TriangleAlert,
  ShieldAlert,
  Bug,
  Gavel,
  ArrowRight,
  ClipboardList,
  BookOpen,
  Activity,
  ChevronRight,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useOwnerProblems,
  useAcceptedDemands,
  deriveHealth,
} from './_hooks';

export default function Dashboard() {
  const { navigate } = useApp();
  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const problemsQ = useOwnerProblems();
  const demandsQ = useAcceptedDemands();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);

  const mySlaEvents = useMemo(
    () => (slaQ.data ?? []).filter((e) => myServiceIds.has(e.serviceId)),
    [slaQ.data, myServiceIds],
  );

  const openBreaches = useMemo(
    () => mySlaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt),
    [mySlaEvents],
  );
  const openWarnings = useMemo(
    () => mySlaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt),
    [mySlaEvents],
  );

  const problems = problemsQ.data ?? [];
  const knownErrors = problems.filter((p) => p.knownErrorId || p.status === 'KNOWN_ERROR');

  // Demands awaiting commitment approval on MY services
  const governanceDemands = useMemo(
    () =>
      (demandsQ.data ?? []).filter((d) => d.relatedServiceIds.some((sid) => myServiceIds.has(sid))),
    [demandsQ.data, myServiceIds],
  );

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';

  const loading =
    servicesQ.isLoading || slaQ.isLoading || problemsQ.isLoading || demandsQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Owner — Accountability Dashboard"
        description="What you see creates governance obligations. Breach notifications and accepted commitments are accountability events that require your response."
        icon={<Briefcase className="h-6 w-6" />}
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="My Services"
              value={services.length}
              icon={<Briefcase className="h-4 w-4" />}
              hint="Active portfolio under your ownership"
              onClick={() => navigate('portfolio')}
            />
            <StatCard
              label="SLA Warnings"
              value={openWarnings.length}
              icon={<TriangleAlert className="h-4 w-4" />}
              tone="warning"
              hint="Approaching threshold — review before breach"
              onClick={() => navigate('sla')}
            />
            <StatCard
              label="SLA Breaches"
              value={openBreaches.length}
              icon={<ShieldAlert className="h-4 w-4" />}
              tone="danger"
              hint="REQUIRES YOUR RESPONSE"
              onClick={() => navigate('sla')}
            />
            <StatCard
              label="Open Problems"
              value={problems.length}
              icon={<Bug className="h-4 w-4" />}
              hint="Under investigation on your services"
              onClick={() => navigate('problems')}
            />
            <StatCard
              label="Governance Approvals"
              value={governanceDemands.length}
              icon={<Gavel className="h-4 w-4" />}
              tone="success"
              hint="Accepted demands awaiting commitment"
              onClick={() => navigate('governance')}
            />
          </div>

          {/* Breach notifications → governance responses */}
          <SectionCard
            title="Breach Notifications → Governance Responses"
            description="A breach notification is an accountability event that requires your response. Each unresolved breach on your services is listed here."
            actions={
              <Button variant="outline" size="sm" onClick={() => navigate('sla')}>
                Open SLA view <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            }
          >
            {openBreaches.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-8 w-8" />}
                title="No active breaches on your services"
                description="All SLA commitments within target. Continue monitoring warnings."
              />
            ) : (
              <div className="space-y-2.5">
                {openBreaches.map((b) => (
                  <Alert
                    key={b.id}
                    variant="destructive"
                    className="border-rose-300 dark:border-rose-900/70 bg-rose-50/60 dark:bg-rose-950/30"
                  >
                    <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    <AlertTitle className="flex flex-wrap items-center gap-2 text-rose-800 dark:text-rose-300">
                      <span className="font-semibold">{serviceName(b.serviceId)}</span>
                      <span className="text-xs font-normal text-rose-600/80 dark:text-rose-400/80">
                        breached <RelativeTime date={b.createdAt} />
                      </span>
                    </AlertTitle>
                    <AlertDescription className="text-rose-900/80 dark:text-rose-200/80">
                      {b.message}
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-rose-300 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
                          onClick={() => navigate('sla')}
                        >
                          Review & respond <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Two-column: portfolio snapshot + governance approvals */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Service Portfolio Snapshot"
              description="Current health of services under your ownership."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('portfolio')}>
                  All services <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {services.length === 0 ? (
                <EmptyState
                  icon={<Briefcase className="h-7 w-7" />}
                  title="No services in your portfolio"
                  description="Services you own will appear here."
                />
              ) : (
                <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
                  {services.map((s) => {
                    const sEvents = mySlaEvents.filter((e) => e.serviceId === s.id);
                    const health = deriveHealth(sEvents);
                    const openIncidents = sEvents.filter(
                      (e) => !e.resolvedAt && (e.eventType === 'BREACHED' || e.eventType === 'WARNING'),
                    ).length;
                    return (
                      <li
                        key={s.id}
                        className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                        onClick={() => navigate('portfolio')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{s.name}</span>
                            <SlaClassBadge slaClass={s.slaClass} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {s.chapter} · {s.layer}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {openIncidents > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 font-medium">
                              <Activity className="h-3 w-3" /> {openIncidents}
                            </span>
                          )}
                          <SlaHealthBadge health={health} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Pending Governance Approvals"
              description="Accepted demands on your services — service commitments requiring your approval."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('governance')}>
                  Open <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {governanceDemands.length === 0 ? (
                <EmptyState
                  icon={<Gavel className="h-7 w-7" />}
                  title="No commitments awaiting approval"
                  description="When a demand on your service is accepted, you approve the service commitment here."
                />
              ) : (
                <ul className="divide-y max-h-96 overflow-y-auto scrollbar-thin">
                  {governanceDemands.map((d) => (
                    <li
                      key={d.id}
                      className="py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                      onClick={() => navigate('demand-detail', { id: d.id })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{d.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {d.serviceCustomerName} · SCM: {d.assignedScmWorkerName ?? 'Unassigned'}
                          </div>
                          {d.commitmentNotes && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                              “{d.commitmentNotes}”
                            </p>
                          )}
                        </div>
                        <DemandStatusBadge status={d.status} className="shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Two-column: open problems + known errors */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              className="lg:col-span-2"
              title="Open Problems on Your Services"
              description="When Problem Management investigates a recurring failure, that context feeds your SLA governance communication."
              actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('problems')}>
                  All problems <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {problems.length === 0 ? (
                <EmptyState
                  icon={<Bug className="h-7 w-7" />}
                  title="No open problem records"
                  description="Active problems on your services will be listed here."
                />
              ) : (
                <ul className="divide-y">
                  {problems.map((p) => (
                    <li
                      key={p.id}
                      className="py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                      onClick={() => navigate('problems')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{p.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {p.serviceName ?? serviceName(p.serviceId)} · {p.status.replace(/_/g, ' ').toLowerCase()}
                          </div>
                          {p.rootCauseDescription && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              Root cause: {p.rootCauseDescription}
                            </p>
                          )}
                        </div>
                        <RelativeTime date={p.createdAt} className="text-xs text-muted-foreground shrink-0" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Active Known Errors"
              description="Problems with documented workarounds awaiting permanent fix."
            >
              {knownErrors.length === 0 ? (
                <EmptyState
                  icon={<BookOpen className="h-7 w-7" />}
                  title="No active known errors"
                  description="Known errors for your services will surface here with workaround context."
                />
              ) : (
                <ul className="space-y-2.5">
                  {knownErrors.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                          Known Error
                        </span>
                      </div>
                      <div className="text-sm font-medium mt-1.5">{p.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.serviceName ?? serviceName(p.serviceId)}
                      </div>
                      {p.workaroundDescription && (
                        <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed">
                          <span className="font-medium">Workaround:</span> {p.workaroundDescription}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 pt-3 border-t">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <p className="leading-relaxed">
                    Known errors stay visible to your customers through the SCM communications
                    thread. Ensure workarounds are accurate before publication.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
