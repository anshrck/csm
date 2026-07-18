'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  DataTable,
  type Column,
  Button,
  Badge,
} from '@/components/shared';
import { ComplianceDonut, SlaTrendChart } from '@/components/widgets';
import { useSlaEvents, useServices, useDemands, daysSince } from './Dashboard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Gauge,
  AlertOctagon,
  ShieldCheck,
  FileCheck2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Eye,
  ArrowRight,
  Clock,
  Send,
  Undo2,
  FileText,
  ScrollText,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SlaEvent, Service, Demand } from '@/lib/types';

interface ComplianceRow {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceCustomerId: string | null;
  customerName: string;
  slaClass: string;
  total: number;
  breaches: number;
  warnings: number;
  closed: number;
  compliance: number;
}

/* --------------------- SLA Report type --------------------- */

interface SlaReport {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  serviceIds: string[];
  serviceCustomerIds: string[];
  preparedById: string;
  reviewedByCmLeaderId: string | null;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'RETURNED' | 'ISSUED';
  summary: string;
  metrics: {
    byService?: Record<string, { warnings: number; breaches: number; closedInTime: number }>;
    totals?: { totalEvents: number };
    [k: string]: unknown;
  };
  reviewNotes: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const REPORT_STATUS_LABELS: Record<SlaReport['status'], string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
  ISSUED: 'Issued',
};

const REPORT_STATUS_BADGE_CLS: Record<SlaReport['status'], string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  PENDING_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  RETURNED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  ISSUED: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
};

/* --------------------- Review Report Dialog --------------------- */

function ReviewReportDialog({
  open,
  onOpenChange,
  report,
  mode,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  report: SlaReport | null;
  mode: 'approve' | 'return';
  pending: boolean;
  onConfirm: (reviewNotes: string) => void;
}) {
  const [notes, setNotes] = useState('');

  const handleClose = (v: boolean) => {
    if (!v) setNotes('');
    onOpenChange(v);
  };

  const isApprove = mode === 'approve';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isApprove ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <Undo2 className="h-5 w-5 text-rose-600" />
            )}
            {isApprove ? 'Review & Approve SLA Report' : 'Return SLA Report for Revision'}
          </DialogTitle>
          <DialogDescription>
            {report
              ? `Report: "${report.title}" — period ${new Date(report.periodStart).toLocaleDateString()} to ${new Date(report.periodEnd).toLocaleDateString()}.`
              : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        {report && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Compliance Summary
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.summary}</p>
            </div>

            {/* Metrics */}
            {report.metrics?.byService && Object.keys(report.metrics.byService).length > 0 && (
              <div className="rounded-md border p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  SLA Metrics by Service
                </div>
                <ul className="space-y-1.5 text-xs">
                  {Object.entries(report.metrics.byService).map(([sid, m]) => (
                    <li key={sid} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">{sid}</span>
                      <span className="flex gap-3 tabular-nums">
                        <span className="text-amber-700 dark:text-amber-300">{m.warnings}W</span>
                        <span className="text-rose-700 dark:text-rose-300">{m.breaches}B</span>
                        <span className="text-emerald-700 dark:text-emerald-300">{m.closedInTime}C</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {report.metrics.totals && (
                  <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                    Total events in period: <span className="font-medium text-foreground">{report.metrics.totals.totalEvents}</span>
                  </div>
                )}
              </div>
            )}

            {/* Review notes */}
            <div className="space-y-1.5">
              <Label htmlFor="review-notes">
                {isApprove ? 'Review notes (optional)' : 'Revision notes (required)'}
              </Label>
              <Textarea
                id="review-notes"
                rows={4}
                placeholder={
                  isApprove
                    ? 'Optional feedback for the SCM Worker (will be visible on the report).'
                    : 'Explain what needs revision before this report can be approved. This text is sent to the SCM Worker.'
                }
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={isApprove ? 'default' : 'destructive'}
            onClick={() => onConfirm(notes.trim())}
            disabled={pending || (!isApprove && !notes.trim())}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : isApprove ? <CheckCircle2 className="h-4 w-4 mr-1.5" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
            {pending ? 'Working…' : isApprove ? 'Approve Report' : 'Return for Revision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- SLA Reports Section --------------------- */

function SlaReportsSection() {
  const qc = useQueryClient();
  const reportsQ = useQuery<SlaReport[]>({
    queryKey: ['sla-reports'] as const,
    queryFn: () => apiGet<SlaReport[]>('/api/sla-reports'),
    staleTime: 30_000,
  });

  const [reviewTarget, setReviewTarget] = useState<{ report: SlaReport; mode: 'approve' | 'return' } | null>(null);

  const approveMutation = useMutation({
    mutationFn: (args: { id: string; reviewNotes: string }) =>
      apiPost(`/api/sla-reports/${args.id}/approve`, { reviewNotes: args.reviewNotes || undefined }),
    onSuccess: (_data, vars) => {
      toast.success('SLA report approved', {
        description: `Report ${vars.id.slice(-6)} is now APPROVED. The SCM Worker can issue it to the customer.`,
      });
      qc.invalidateQueries({ queryKey: ['sla-reports'] });
      setReviewTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnMutation = useMutation({
    mutationFn: (args: { id: string; reviewNotes: string }) =>
      apiPost(`/api/sla-reports/${args.id}/return`, { reviewNotes: args.reviewNotes }),
    onSuccess: (_data, vars) => {
      toast.info('SLA report returned for revision', {
        description: `Report ${vars.id.slice(-6)} returned to the SCM Worker for revision.`,
      });
      qc.invalidateQueries({ queryKey: ['sla-reports'] });
      setReviewTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reports = reportsQ.data ?? [];
  const pendingReview = reports.filter((r) => r.status === 'PENDING_REVIEW');
  const approved = reports.filter((r) => r.status === 'APPROVED');
  const issued = reports.filter((r) => r.status === 'ISSUED');
  const returned = reports.filter((r) => r.status === 'RETURNED');
  const drafts = reports.filter((r) => r.status === 'DRAFT');

  if (reportsQ.isLoading) return <LoadingState rows={3} />;

  return (
    <SectionCard
      title="SLA Reports"
      description="Review SLA reports prepared by SCM Workers. Approve reports to enable issuance to Service Customers, or return them for revision. Each action is recorded in the audit trail."
      actions={
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {pendingReview.length} pending review
        </Badge>
      }
    >
      {reports.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="No SLA reports yet"
          description="SCM Workers prepare SLA reports from the SLM Dashboard. Submitted reports will appear here for your review."
        />
      ) : (
        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="mb-3">
            <TabsTrigger value="pending" className="gap-1.5">
              Pending Review
              {pendingReview.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{pendingReview.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
            <TabsTrigger value="returned">Returned ({returned.length})</TabsTrigger>
            <TabsTrigger value="issued">Issued ({issued.length})</TabsTrigger>
            <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-2 mt-0">
            {pendingReview.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-7 w-7 text-emerald-500" />}
                title="No reports pending review"
                description="Submitted reports awaiting your sign-off will appear here."
              />
            ) : (
              pendingReview.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  actions={
                    <>
                      <Button
                        size="sm"
                        onClick={() => setReviewTarget({ report: r, mode: 'approve' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Review & Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReviewTarget({ report: r, mode: 'return' })}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Return for Revision
                      </Button>
                    </>
                  }
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="approved" className="space-y-2 mt-0">
            {approved.length === 0 ? (
              <EmptyState icon={<FileCheck2 className="h-7 w-7" />} title="No approved reports" description="Approved reports will appear here until issued." />
            ) : (
              approved.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  actions={
                    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Awaiting SCM issuance
                    </Badge>
                  }
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="returned" className="space-y-2 mt-0">
            {returned.length === 0 ? (
              <EmptyState icon={<Undo2 className="h-7 w-7" />} title="No returned reports" description="Reports you return for revision will appear here." />
            ) : (
              returned.map((r) => (
                <ReportRow key={r.id} report={r} actions={null} />
              ))
            )}
          </TabsContent>

          <TabsContent value="issued" className="space-y-2 mt-0">
            {issued.length === 0 ? (
              <EmptyState icon={<Send className="h-7 w-7" />} title="No issued reports" description="Issued reports — visible to Service Customers — will appear here." />
            ) : (
              issued.map((r) => (
                <ReportRow key={r.id} report={r} actions={null} />
              ))
            )}
          </TabsContent>

          <TabsContent value="drafts" className="space-y-2 mt-0">
            {drafts.length === 0 ? (
              <EmptyState icon={<FileText className="h-7 w-7" />} title="No draft reports" description="Drafts the SCM Worker has not yet submitted will appear here." />
            ) : (
              drafts.map((r) => (
                <ReportRow key={r.id} report={r} actions={null} />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}

      <ReviewReportDialog
        open={!!reviewTarget}
        onOpenChange={(v) => !v && setReviewTarget(null)}
        report={reviewTarget?.report ?? null}
        mode={reviewTarget?.mode ?? 'approve'}
        pending={approveMutation.isPending || returnMutation.isPending}
        onConfirm={(notes) => {
          if (!reviewTarget) return;
          if (reviewTarget.mode === 'approve') {
            approveMutation.mutate({ id: reviewTarget.report.id, reviewNotes: notes });
          } else {
            returnMutation.mutate({ id: reviewTarget.report.id, reviewNotes: notes });
          }
        }}
      />
    </SectionCard>
  );
}

function ReportRow({
  report,
  actions,
}: {
  report: SlaReport;
  actions: React.ReactNode;
}) {
  const totals = report.metrics?.totals as { totalEvents?: number } | undefined;
  const byService = report.metrics?.byService as Record<string, { warnings: number; breaches: number; closedInTime: number }> | undefined;
  const totalBreaches = byService ? Object.values(byService).reduce((s, m) => s + m.breaches, 0) : 0;
  const totalClosed = byService ? Object.values(byService).reduce((s, m) => s + m.closedInTime, 0) : 0;
  const compliance =
    totalClosed + totalBreaches > 0 ? Math.round((totalClosed / (totalClosed + totalBreaches)) * 100) : null;

  return (
    <div className="rounded-md border p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold">{report.title}</h4>
            <Badge variant="outline" className={REPORT_STATUS_BADGE_CLS[report.status]}>
              {REPORT_STATUS_LABELS[report.status]}
            </Badge>
            {compliance != null && (
              <Badge
                variant="outline"
                className={
                  compliance >= 95
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : compliance >= 85
                      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      : 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                }
              >
                {compliance}% compliance
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Period: <FormattedDate date={report.periodStart} /> → <FormattedDate date={report.periodEnd} />
            {' · '}{report.serviceIds.length} service(s){' · '}
            {totals?.totalEvents ?? 0} events
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80 line-clamp-2">{report.summary}</p>
          {report.reviewNotes && (
            <p className="mt-1.5 text-xs italic text-muted-foreground line-clamp-2">
              Review notes: {report.reviewNotes}
            </p>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground">
            Prepared <RelativeTime date={report.createdAt} />
            {report.approvedAt && <> · Approved <RelativeTime date={report.approvedAt} /></>}
            {report.issuedAt && <> · Issued <RelativeTime date={report.issuedAt} /></>}
          </div>
        </div>
        {actions && <div className="flex flex-col gap-1.5 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

/* --------------------- Main --------------------- */

export default function SlmGovernance() {
  const slaQ = useSlaEvents();
  const servicesQ = useServices();
  const demandsQ = useDemands();

  const slaEvents = slaQ.data ?? [];
  const services = servicesQ.data ?? [];
  const demands = demandsQ.data ?? [];

  const activeBreaches = useMemo(
    () => slaEvents.filter((e) => e.eventType === 'BREACHED' && !e.resolvedAt),
    [slaEvents],
  );
  const warnings = useMemo(
    () => slaEvents.filter((e) => e.eventType === 'WARNING' && !e.resolvedAt),
    [slaEvents],
  );
  const closedInTime = slaEvents.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
  const total = slaEvents.length;
  const overallCompliance = total > 0 ? Math.round((closedInTime / total) * 100) : 100;

  // Build compliance matrix
  const complianceRows = useMemo<ComplianceRow[]>(() => {
    const serviceMap = new Map(services.map((s) => [s.id, s]));
    const grouped = new Map<string, ComplianceRow>();
    for (const ev of slaEvents) {
      const key = `${ev.serviceId}|${ev.serviceCustomerId ?? 'null'}`;
      const svc = serviceMap.get(ev.serviceId);
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          serviceId: ev.serviceId,
          serviceName: ev.serviceName ?? svc?.name ?? 'Service',
          serviceCustomerId: ev.serviceCustomerId,
          customerName: '—',
          slaClass: svc?.slaClass ?? 'C',
          total: 0,
          breaches: 0,
          warnings: 0,
          closed: 0,
          compliance: 100,
        });
      }
      const row = grouped.get(key)!;
      row.total++;
      if (ev.eventType === 'BREACHED') row.breaches++;
      else if (ev.eventType === 'WARNING') row.warnings++;
      else if (ev.eventType === 'CLOSED_IN_TIME') row.closed++;
    }
    // assign customer names from demands (serviceCustomerId → name)
    const customerNameMap = new Map<string, string>();
    demands.forEach((d) => {
      if (d.serviceCustomerId && d.serviceCustomerName) {
        customerNameMap.set(d.serviceCustomerId, d.serviceCustomerName);
      }
    });
    return Array.from(grouped.values()).map((r) => {
      r.customerName = r.serviceCustomerId ? customerNameMap.get(r.serviceCustomerId) ?? 'Tenant' : 'Tenant';
      r.compliance = r.total > 0 ? Math.round((r.closed / r.total) * 100) : 100;
      return r;
    });
  }, [slaEvents, services, demands]);

  // SLA trend data — last 8 weeks (synthesized from event createdAt)
  const trendData = useMemo(() => {
    const weeks: { label: string; value: number; events: SlaEvent[] }[] = [];
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * 7 * 86400000;
      const end = now - i * 7 * 86400000;
      const inWeek = slaEvents.filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= start && t < end;
      });
      const closed = inWeek.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
      const compliance = inWeek.length > 0 ? Math.round((closed / inWeek.length) * 100) : 100;
      const label = `W${8 - i}`;
      weeks.push({ label, value: compliance, events: inWeek });
    }
    return weeks.map((w) => ({ label: w.label, value: w.value }));
  }, [slaEvents]);

  const isLoading = slaQ.isLoading || servicesQ.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLM Governance"
        description="Review SLA compliance across the tenant. SLA reports prepared by SCM Workers are reviewed by you before issuance to Service Customers — breaches require your governance attention."
        icon={<Gauge className="h-5 w-5" />}
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Overall Compliance"
          value={`${overallCompliance}%`}
          hint={`${closedInTime} of ${total} events closed in time`}
          tone={overallCompliance >= 95 ? 'success' : overallCompliance >= 85 ? 'warning' : 'danger'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Active Breaches"
          value={activeBreaches.length}
          hint="Unresolved breach events"
          tone={activeBreaches.length > 0 ? 'danger' : 'success'}
          icon={<AlertOctagon className="h-4 w-4" />}
        />
        <StatCard
          label="Active Warnings"
          value={warnings.length}
          hint="Threshold approaching"
          tone={warnings.length > 0 ? 'warning' : 'success'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="Breaches >3d Open"
          value={activeBreaches.filter((b) => (daysSince(b.createdAt) ?? 0) > 3).length}
          hint="Long-running breach events"
          tone="danger"
          icon={<FileCheck2 className="h-4 w-4" />}
        />
      </div>

      {/* SLA Reports — the real governance workflow */}
      <SlaReportsSection />

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active breaches — prominent governance panel */}
          <div className="lg:col-span-2 space-y-6">
            <ActiveBreachesPanel
              events={activeBreaches}
              services={services}
              demands={demands}
              onReview={(ev) => {
                toast.info(`Breach on ${ev.serviceName ?? 'service'}`, {
                  description: ev.message,
                });
              }}
            />

            <ComplianceMatrix rows={complianceRows} />
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <ComplianceDonutPanel value={overallCompliance} total={total} closed={closedInTime} breaches={activeBreaches.length} />
          </div>
        </div>
      )}

      {/* SLA trend */}
      <SectionCard
        title="SLA Compliance Trend"
        description="Weekly SLA compliance percentage over the last 8 weeks."
      >
        {trendData.length === 0 ? (
          <EmptyState title="No trend data available" />
        ) : (
          <SlaTrendChart data={trendData} />
        )}
      </SectionCard>
    </div>
  );
}

function ActiveBreachesPanel({
  events,
  services,
  demands,
  onReview,
}: {
  events: SlaEvent[];
  services: Service[];
  demands: Demand[];
  onReview: (ev: SlaEvent) => void;
}) {
  const columns: Column<SlaEvent>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (e) => {
        const svc = services.find((s) => s.id === e.serviceId);
        return (
          <div className="min-w-0 max-w-[200px]">
            <div className="font-medium text-sm truncate">{e.serviceName ?? svc?.name ?? 'Service'}</div>
            {svc && (
              <div className="mt-0.5">
                <SlaClassBadge slaClass={svc.slaClass as any} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (e) => {
        const demand = demands.find((d) => d.serviceCustomerId === e.serviceCustomerId);
        return <span className="text-sm">{demand?.serviceCustomerName ?? 'Tenant'}</span>;
      },
    },
    {
      key: 'message',
      header: 'Message',
      render: (e) => <span className="text-sm text-muted-foreground line-clamp-2 max-w-[280px] block">{e.message}</span>,
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (e) => {
        const d = daysSince(e.createdAt) ?? 0;
        return (
          <Badge
            variant="outline"
            className={d > 3 ? 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : ''}
          >
            {d}d open
          </Badge>
        );
      },
    },
    {
      key: 'review',
      header: '',
      render: (e) => (
        <Button size="sm" variant="outline" onClick={() => onReview(e)}>
          <Eye className="h-3.5 w-3.5" /> Review
        </Button>
      ),
      className: 'text-right',
      headerClassName: 'text-right',
    },
  ];

  return (
    <SectionCard
      title="Active SLA Breaches"
      description="Unresolved breach events requiring CM Leader governance. These drive the SLA report review queue."
      actions={
        events.length > 0 && (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {events.length} active
          </Badge>
        )
      }
    >
      {events.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="No active SLA breaches"
          description="Tenant SLA posture is healthy. Breach events will appear here when they occur."
        />
      ) : (
        <DataTable columns={columns} rows={events} />
      )}
    </SectionCard>
  );
}

function ComplianceMatrix({ rows }: { rows: ComplianceRow[] }) {
  const columns: Column<ComplianceRow>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0 max-w-[200px]">
          <div className="font-medium text-sm truncate">{r.serviceName}</div>
          <div className="text-xs text-muted-foreground truncate">{r.customerName}</div>
        </div>
      ),
    },
    {
      key: 'slaClass',
      header: 'SLA Class',
      render: (r) => <SlaClassBadge slaClass={r.slaClass as any} />,
    },
    {
      key: 'total',
      header: 'Events',
      render: (r) => <span className="tabular-nums text-sm">{r.total}</span>,
    },
    {
      key: 'breaches',
      header: 'Breaches',
      render: (r) => (
        <span className={`tabular-nums text-sm ${r.breaches > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'}`}>
          {r.breaches}
        </span>
      ),
    },
    {
      key: 'warnings',
      header: 'Warnings',
      render: (r) => (
        <span className={`tabular-nums text-sm ${r.warnings > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
          {r.warnings}
        </span>
      ),
    },
    {
      key: 'closed',
      header: 'Closed in time',
      render: (r) => <span className="tabular-nums text-sm text-emerald-600 dark:text-emerald-400">{r.closed}</span>,
    },
    {
      key: 'compliance',
      header: 'Compliance',
      render: (r) => {
        const health = r.compliance >= 95 ? 'green' : r.compliance >= 85 ? 'amber' : 'red';
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${
                  health === 'green' ? 'bg-emerald-500' : health === 'amber' ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${r.compliance}%` }}
              />
            </div>
            <span className="tabular-nums text-sm font-medium w-9">{r.compliance}%</span>
          </div>
        );
      },
    },
  ];

  return (
    <SectionCard
      title="SLA Compliance Matrix"
      description="Per Service Customer × Service × SLA Class compliance breakdown."
    >
      {rows.length === 0 ? (
        <EmptyState title="No SLA events recorded" description="Compliance metrics will populate as SLA events occur." />
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
    </SectionCard>
  );
}

function ComplianceDonutPanel({
  value,
  total,
  closed,
  breaches,
}: {
  value: number;
  total: number;
  closed: number;
  breaches: number;
}) {
  const health = value >= 95 ? 'green' : value >= 85 ? 'amber' : 'red';
  return (
    <SectionCard title="Tenant Compliance" description="Overall SLA compliance across all services.">
      <div className="flex flex-col items-center py-2">
        <ComplianceDonut value={value} label="compliant" size={160} />
        <div className="mt-3">
          <SlaHealthBadge health={health} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 w-full text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-sm font-semibold tabular-nums">{total}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-2">
            <div className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{closed}</div>
            <div className="text-[10px] text-muted-foreground">Closed</div>
          </div>
          <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 p-2">
            <div className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300">{breaches}</div>
            <div className="text-[10px] text-muted-foreground">Breaches</div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
