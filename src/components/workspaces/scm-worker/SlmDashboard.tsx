'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  Button,
  Card,
  CardContent,
  Badge,
  DataTable,
  type Column,
} from '@/components/shared';
import { SlaTrendChart } from '@/components/widgets';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Gauge,
  AlertTriangle,
  Megaphone,
  TrendingUp,
  ShieldCheck,
  Clock,
  Send,
  FileText,
  Mail,
  CheckCircle2,
} from 'lucide-react';
import type { SlaEvent, Service, SlaClass } from '@/lib/types';

/* --------------------- Types --------------------- */

interface ComplianceRow {
  id: string;
  serviceName: string;
  slaClass: SlaClass;
  total: number;
  closedInTime: number;
  breaches: number;
  warnings: number;
  compliance: number | null; // null = no events
}

interface Communication {
  id: string;
  demandId: string | null;
  serviceId: string | null;
  serviceCustomerId: string | null;
  slaEventId: string | null;
  direction: string;
  channel: string;
  subject: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

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

/* --------------------- Breach Communication Dialog --------------------- */

function CommunicateDialog({
  open,
  onOpenChange,
  event,
  serviceName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: SlaEvent | null;
  serviceName: string;
  pending: boolean;
  onConfirm: (subject: string, body: string) => void;
}) {
  const breachDate = event ? new Date(event.createdAt).toLocaleDateString() : '';
  const initialSubject = event
    ? `SLA Breach Notification — ${serviceName} — ${breachDate}`
    : '';
  const initialBody = event
    ? `We are writing to inform you of a recent SLA breach on the ${serviceName} service.\n\nBreach details:\n- Detected: ${breachDate}\n- Description: ${event.message}\n\nOur teams are actively investigating and remediating the issue. We will provide a follow-up communication once the service is restored and a root-cause analysis has been completed.\n\nIf you have any questions or require further information, please contact your named Service Customer Manager.\n\nRegards,\nService Management Team`
    : '';

  const [subject, setSubject] = React.useState(initialSubject);
  const [body, setBody] = React.useState(initialBody);

  // Re-sync when event changes
  React.useEffect(() => {
    if (open) {
      setSubject(initialSubject);
      setBody(initialBody);
    }
  }, [open, event?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-teal-600" /> Communicate Breach to Customer
          </DialogTitle>
          <DialogDescription>
            Compose a portal notification to the affected customer about this SLA breach on{' '}
            <span className="font-medium">{serviceName}</span>. The communication is recorded in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium">{serviceName}</div>
            <div className="text-muted-foreground mt-1">{event?.message}</div>
            <div className="text-muted-foreground mt-1">Detected {event ? <FormattedDate date={event.createdAt} /> : null}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comm-subject">Subject</Label>
            <Input
              id="comm-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="SLA Breach Notification —"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comm-body">Message body</Label>
            <Textarea
              id="comm-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear customer…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(subject.trim(), body.trim())}
            disabled={pending || !subject.trim() || !body.trim()}
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            {pending ? 'Sending…' : 'Send to Customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Prepare SLA Report Dialog --------------------- */

function PrepareReportDialog({
  open,
  onOpenChange,
  services,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  services: Service[];
  pending: boolean;
  onConfirm: (input: {
    title: string;
    periodStart: string;
    periodEnd: string;
    summary: string;
    serviceIds: string[];
  }) => void;
}) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  const [title, setTitle] = React.useState('');
  const [periodStart, setPeriodStart] = React.useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = React.useState(lastOfMonth);
  const [summary, setSummary] = React.useState('');
  const [selectedServiceIds, setSelectedServiceIds] = React.useState<string[]>([]);

  const handleClose = (v: boolean) => {
    if (!v) {
      setTitle('');
      setSummary('');
      setSelectedServiceIds([]);
    }
    onOpenChange(v);
  };

  const toggleService = (sid: string) => {
    setSelectedServiceIds((cur) =>
      cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid],
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-teal-600" /> Prepare SLA Report
          </DialogTitle>
          <DialogDescription>
            Create a new SLA report draft. SLA metrics for the selected services and period will be auto-gathered from SLA events. You can submit the draft for CM Leader review afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-title">Report title</Label>
            <Input
              id="report-title"
              placeholder="e.g. Monthly SLA Compliance Report — October 2024"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-start">Period start</Label>
              <Input
                id="period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-end">Period end</Label>
              <Input
                id="period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Services to include</Label>
            <div className="max-h-44 overflow-y-auto scrollbar-thin rounded-md border p-2 space-y-1.5">
              {services.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2">No services available.</div>
              ) : (
                services.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.includes(s.id)}
                      onChange={() => toggleService(s.id)}
                      className="h-4 w-4 accent-teal-600"
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    <SlaClassBadge slaClass={s.slaClass} />
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedServiceIds.length} service(s) selected.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-summary">Compliance summary</Label>
            <Textarea
              id="report-summary"
              rows={4}
              placeholder="High-level summary of compliance posture, notable breaches, trends vs. prior period, and recommended actions."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                title: title.trim(),
                periodStart,
                periodEnd,
                summary: summary.trim(),
                serviceIds: selectedServiceIds,
              })
            }
            disabled={
              pending ||
              !title.trim() ||
              !summary.trim() ||
              selectedServiceIds.length === 0 ||
              !periodStart ||
              !periodEnd
            }
          >
            {pending ? <Clock className="h-4 w-4 animate-pulse mr-1.5" /> : <FileText className="h-4 w-4 mr-1.5" />}
            {pending ? 'Creating…' : 'Create Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Main --------------------- */

export default function SlmDashboard() {
  const qc = useQueryClient();

  const { data: slaEvents, isLoading } = useQuery<SlaEvent[]>({
    queryKey: ['sla-events'],
    queryFn: () => apiGet('/api/sla-events'),
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  // Recent communications (last 5)
  const commsQ = useQuery<Communication[]>({
    queryKey: ['communications', 'recent'] as const,
    queryFn: () => apiGet<Communication[]>('/api/communications'),
    staleTime: 30_000,
  });

  // SLA reports (mine)
  const reportsQ = useQuery<SlaReport[]>({
    queryKey: ['sla-reports', 'mine'] as const,
    queryFn: () => apiGet<SlaReport[]>('/api/sla-reports?preparedBy=me'),
    staleTime: 30_000,
  });

  const serviceMap = React.useMemo(() => {
    const m = new Map<string, Service>();
    (services ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);

  const complianceRows: ComplianceRow[] = React.useMemo(() => {
    const byService = new Map<string, { closed: number; breaches: number; warnings: number }>();
    for (const e of slaEvents ?? []) {
      const cur = byService.get(e.serviceId) ?? { closed: 0, breaches: 0, warnings: 0 };
      if (e.eventType === 'CLOSED_IN_TIME') cur.closed += 1;
      if (e.eventType === 'BREACHED') cur.breaches += 1;
      if (e.eventType === 'WARNING') cur.warnings += 1;
      byService.set(e.serviceId, cur);
    }
    return Array.from(byService.entries()).map(([sid, counts]) => {
      const svc = serviceMap.get(sid);
      const total = counts.closed + counts.breaches;
      const compliance = total === 0 ? null : Math.round((counts.closed / total) * 100);
      return {
        id: sid,
        serviceName: svc?.name ?? 'Unknown service',
        slaClass: (svc?.slaClass ?? 'C') as SlaClass,
        total,
        closedInTime: counts.closed,
        breaches: counts.breaches,
        warnings: counts.warnings,
        compliance,
      };
    }).sort((a, b) => (a.compliance ?? 200) - (b.compliance ?? 200));
  }, [slaEvents, serviceMap]);

  const breaches = (slaEvents ?? []).filter((e) => e.eventType === 'BREACHED');
  const warnings = (slaEvents ?? []).filter((e) => e.eventType === 'WARNING');

  // Synthetic monthly compliance trend (last 6 months)
  const trendData = React.useMemo(() => {
    const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.map((label, i) => ({
      label,
      value: Math.round((92 + Math.sin(i * 0.9) * 4 + (i === 4 ? -8 : 0) + (i === 2 ? 3 : 0)) * 10) / 10,
    }));
  }, []);

  /* --- Communication mutation --- */
  const [commTarget, setCommTarget] = React.useState<SlaEvent | null>(null);
  const commMutation = useMutation({
    mutationFn: (args: { event: SlaEvent; subject: string; body: string }) =>
      apiPost('/api/communications', {
        slaEventId: args.event.id,
        serviceId: args.event.serviceId,
        serviceCustomerId: args.event.serviceCustomerId ?? undefined,
        direction: 'TO_CUSTOMER',
        channel: 'PORTAL',
        subject: args.subject,
        body: args.body,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Communication sent to customer', {
        description: `Subject: "${vars.subject}" — recorded in the audit trail.`,
      });
      qc.invalidateQueries({ queryKey: ['communications'] });
      setCommTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --- SLA report create + submit + issue mutations --- */
  const [prepareOpen, setPrepareOpen] = React.useState(false);
  const createReportMutation = useMutation({
    mutationFn: (input: {
      title: string;
      periodStart: string;
      periodEnd: string;
      summary: string;
      serviceIds: string[];
    }) =>
      apiPost('/api/sla-reports', {
        ...input,
        serviceCustomerIds: [],
      }),
    onSuccess: (_data, vars) => {
      toast.success('SLA report draft created', {
        description: `"${vars.title}" saved as DRAFT. Submit it for CM Leader review when ready.`,
      });
      qc.invalidateQueries({ queryKey: ['sla-reports'] });
      setPrepareOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitReportMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/sla-reports/${id}/submit`),
    onSuccess: () => {
      toast.success('SLA report submitted for CM Leader review', {
        description: 'The CM Leader has been notified to review and approve the report.',
      });
      qc.invalidateQueries({ queryKey: ['sla-reports'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issueReportMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/sla-reports/${id}/issue`),
    onSuccess: () => {
      toast.success('SLA report issued to Service Customers', {
        description: 'The report is now visible to the affected customers in their portal.',
      });
      qc.invalidateQueries({ queryKey: ['sla-reports'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const myReports = reportsQ.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="SLM Dashboard"
        description="SLA governance view across your customer scope. Monitor compliance, communicate breaches to customers, and prepare SLA reports for CM Leader review."
        icon={<Gauge className="h-5 w-5" />}
      />

      {/* Top stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Services Monitored"
          value={complianceRows.length}
          tone="default"
        />
        <SummaryTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Active Breaches"
          value={breaches.length}
          tone="danger"
        />
        <SummaryTile
          icon={<Clock className="h-4 w-4" />}
          label="Active Warnings"
          value={warnings.length}
          tone="warning"
        />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Compliance"
          value={
            complianceRows.length === 0
              ? '—'
              : `${Math.round(
                  complianceRows
                    .filter((r) => r.compliance !== null)
                    .reduce((sum, r) => sum + (r.compliance ?? 0), 0) /
                    Math.max(1, complianceRows.filter((r) => r.compliance !== null).length),
                )}%`
          }
          tone="success"
        />
      </div>

      {/* SLA Reports section */}
      <SectionCard
        title="SLA Reports"
        description="Prepare SLA compliance reports for CM Leader review and customer issuance. Reports must be approved by a CM Leader before they can be issued."
        actions={
          <Button size="sm" onClick={() => setPrepareOpen(true)}>
            <FileText className="h-3.5 w-3.5" /> Prepare SLA Report
          </Button>
        }
      >
        {reportsQ.isLoading ? (
          <LoadingState rows={3} />
        ) : myReports.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="No SLA reports prepared yet"
            description="Click 'Prepare SLA Report' above to draft your first compliance report."
          />
        ) : (
          <div className="space-y-2">
            {myReports.map((r) => (
              <div key={r.id} className="rounded-md border p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold">{r.title}</h4>
                      <Badge variant="outline" className={REPORT_STATUS_BADGE_CLS[r.status]}>
                        {REPORT_STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Period: <FormattedDate date={r.periodStart} /> → <FormattedDate date={r.periodEnd} />
                      {' · '}{r.serviceIds.length} service(s)
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-foreground/80 line-clamp-2">{r.summary}</p>
                    {r.reviewNotes && r.status === 'RETURNED' && (
                      <p className="mt-1.5 text-xs italic text-rose-700 dark:text-rose-300 line-clamp-2">
                        CM Leader notes: {r.reviewNotes}
                      </p>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Created <RelativeTime date={r.createdAt} />
                      {r.approvedAt && <> · Approved <RelativeTime date={r.approvedAt} /></>}
                      {r.issuedAt && <> · Issued <RelativeTime date={r.issuedAt} /></>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {r.status === 'DRAFT' && (
                      <Button
                        size="sm"
                        onClick={() => submitReportMutation.mutate(r.id)}
                        disabled={submitReportMutation.isPending}
                      >
                        {submitReportMutation.isPending ? (
                          <Clock className="h-3.5 w-3.5 animate-pulse" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Submit for Review
                      </Button>
                    )}
                    {r.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        onClick={() => issueReportMutation.mutate(r.id)}
                        disabled={issueReportMutation.isPending}
                      >
                        {issueReportMutation.isPending ? (
                          <Clock className="h-3.5 w-3.5 animate-pulse" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Issue to Customer
                      </Button>
                    )}
                    {r.status === 'PENDING_REVIEW' && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 justify-center py-1">
                        Awaiting CM Leader
                      </Badge>
                    )}
                    {r.status === 'RETURNED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => submitReportMutation.mutate(r.id)}
                        disabled={submitReportMutation.isPending}
                      >
                        Re-submit for Review
                      </Button>
                    )}
                    {r.status === 'ISSUED' && (
                      <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 justify-center py-1">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Issued
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Compliance summary + trend */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="SLA Compliance Summary"
            description="Compliance = closed-in-time / (closed-in-time + breaches). Warnings are advisory only."
          >
            {isLoading ? (
              <LoadingState rows={5} />
            ) : complianceRows.length === 0 ? (
              <EmptyState
                icon={<Gauge className="h-7 w-7" />}
                title="No SLA events recorded"
                description="Compliance metrics will appear once events are captured."
              />
            ) : (
              <DataTable
                columns={complianceColumns}
                rows={complianceRows}
              />
            )}
          </SectionCard>
        </div>
        <SectionCard
          title="Compliance Trend"
          description="Last 6 months (rolling)"
        >
          <SlaTrendChart data={trendData} height={200} />
        </SectionCard>
      </div>

      {/* Active breaches + recent communications */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title="Active Breaches"
            description="Open SLA breaches in your customer scope requiring communication."
            actions={
              breaches.length > 0 ? (
                <Badge variant="outline" className="text-xs text-rose-700 border-rose-200 bg-rose-50">
                  {breaches.length} open
                </Badge>
              ) : undefined
            }
          >
            {breaches.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-7 w-7" />}
                title="No active breaches"
                description="All SLA commitments are currently being met."
              />
            ) : (
              <div className="space-y-2">
                {breaches.map((e) => (
                  <BreachRow
                    key={e.id}
                    event={e}
                    serviceName={serviceMap.get(e.serviceId)?.name ?? 'Unknown'}
                    onCommunicate={() => setCommTarget(e)}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="Recent Communications"
          description="The last 5 customer communications you have sent."
        >
          {commsQ.isLoading ? (
            <LoadingState rows={3} />
          ) : (commsQ.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Mail className="h-7 w-7" />}
              title="No communications yet"
              description="Customer breach notifications and other portal messages you send will appear here."
            />
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
              {(commsQ.data ?? []).slice(0, 5).map((c) => (
                <li key={c.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{c.subject}</div>
                      <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                        <Badge
                          variant="outline"
                          className={
                            c.direction === 'TO_CUSTOMER'
                              ? 'border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                              : 'border-muted bg-muted/40 text-muted-foreground'
                          }
                        >
                          {c.direction === 'TO_CUSTOMER' ? 'To Customer' : 'Internal'}
                        </Badge>
                        <span>{c.channel}</span>
                        <span>· by {c.authorName}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.body}</p>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        <RelativeTime date={c.createdAt} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Communicate dialog */}
      <CommunicateDialog
        open={!!commTarget}
        onOpenChange={(v) => !v && setCommTarget(null)}
        event={commTarget}
        serviceName={commTarget ? serviceMap.get(commTarget.serviceId)?.name ?? 'Service' : ''}
        pending={commMutation.isPending}
        onConfirm={(subject, body) => {
          if (!commTarget) return;
          commMutation.mutate({ event: commTarget, subject, body });
        }}
      />

      {/* Prepare report dialog */}
      <PrepareReportDialog
        open={prepareOpen}
        onOpenChange={setPrepareOpen}
        services={services ?? []}
        pending={createReportMutation.isPending}
        onConfirm={(input) => createReportMutation.mutate(input)}
      />
    </div>
  );
}

/* --------------------- Helpers --------------------- */

const complianceColumns: Column<ComplianceRow>[] = [
  {
    key: 'service',
    header: 'Service',
    render: (r) => <span className="font-medium">{r.serviceName}</span>,
  },
  {
    key: 'class',
    header: 'SLA Class',
    render: (r) => <SlaClassBadge slaClass={r.slaClass} />,
  },
  {
    key: 'closed',
    header: 'Closed in time',
    render: (r) => <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{r.closedInTime}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'breaches',
    header: 'Breaches',
    render: (r) => <span className={`tabular-nums ${r.breaches > 0 ? 'text-rose-700 dark:text-rose-300 font-medium' : ''}`}>{r.breaches}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'warnings',
    header: 'Warnings',
    render: (r) => <span className={`tabular-nums ${r.warnings > 0 ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}`}>{r.warnings}</span>,
    headerClassName: 'text-right',
    className: 'text-right',
  },
  {
    key: 'compliance',
    header: 'Compliance',
    render: (r) =>
      r.compliance === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex items-center gap-2">
          <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={
                r.compliance >= 95
                  ? 'h-full bg-emerald-500'
                  : r.compliance >= 85
                    ? 'h-full bg-amber-500'
                    : 'h-full bg-rose-500'
              }
              style={{ width: `${r.compliance}%` }}
            />
          </div>
          <span className="tabular-nums font-medium text-sm">{r.compliance}%</span>
        </div>
      ),
  },
];

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneCls = {
    default: '',
    warning: 'border-amber-200 dark:border-amber-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
  }[tone];
  return (
    <Card className={toneCls}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function BreachRow({
  event,
  serviceName,
  onCommunicate,
}: {
  event: SlaEvent;
  serviceName: string;
  onCommunicate: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SlaHealthBadge health="red" />
          <span className="text-sm font-medium">{serviceName}</span>
          {event.serviceCustomerId && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Customer-scoped
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground/80">{event.message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Detected <RelativeTime date={event.createdAt} />
          {' · '}
          <FormattedDate date={event.createdAt} />
        </p>
      </div>
      <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={onCommunicate}>
        <Megaphone className="h-3.5 w-3.5" />
        Communicate to Customer
      </Button>
    </div>
  );
}
