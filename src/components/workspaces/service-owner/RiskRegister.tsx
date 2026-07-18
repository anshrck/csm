'use client';

/**
 * Service Owner — Risk Register.
 *
 * A unified view of risks on the services you own. Risks come from two sources:
 *   1. Persisted risks you created (POST /api/service-owner/risk-register).
 *   2. Derived risks the API synthesises from live data (SLA breaches,
 *      problems without workarounds, emergency changes, stale catalog reviews).
 *
 * Features:
 *   - Summary cards: CRITICAL count, HIGH count, OPEN count, MITIGATING count.
 *   - Filters: service, severity, status, source type.
 *   - Risk DataTable with: Service, Title, Source type badge, Severity badge,
 *     Status badge, Due date, Mitigation summary.
 *   - [Create Risk] button → Dialog (service, title, sourceType, severity,
 *     mitigation, dueDate).
 *   - Row actions: Accept risk (PATCH status=ACCEPTED), Create/Edit mitigation
 *     (Dialog → PATCH mitigation), Close risk (PATCH status=CLOSED), Open
 *     linked entity (navigate).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { OwnerRiskItem } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
  RelativeTime,
  FormattedDate,
  Badge,
  Button,
  type Column,
} from '@/components/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  TriangleAlert,
  Plus,
  ShieldCheck,
  Wrench,
  Archive,
  ArrowUpRight,
  Flame,
  Bug,
  GitBranch,
  BookOpen,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import { useOwnerServices } from './_hooks';

// ---- Constants ----

const SEVERITY_BADGE_CLS: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  HIGH: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  MEDIUM: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-900',
  LOW: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
};

const STATUS_BADGE_CLS: Record<string, string> = {
  OPEN: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
  MITIGATING: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  ACCEPTED: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
  CLOSED: 'bg-muted text-muted-foreground border-border',
};

const SOURCE_TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  SLA: { label: 'SLA Breach', icon: Flame },
  PROBLEM: { label: 'Problem', icon: Bug },
  CHANGE: { label: 'Emergency Change', icon: GitBranch },
  CATALOG: { label: 'Catalog Stale', icon: RefreshCw },
  TICKET: { label: 'Ticket', icon: TriangleAlert },
  KNOWLEDGE: { label: 'Knowledge', icon: BookOpen },
  CSAT: { label: 'CSAT', icon: TrendingDown },
  MANUAL: { label: 'Manual Entry', icon: Plus },
};

const SOURCE_TYPES = ['SLA', 'PROBLEM', 'CHANGE', 'CATALOG', 'TICKET', 'KNOWLEDGE', 'CSAT', 'MANUAL'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = ['OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED'];

// ---- Component ----

export default function RiskRegister() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();
  const risksQ = useQuery<OwnerRiskItem[]>({
    queryKey: ['service-owner', 'risk-register'],
    queryFn: () => apiGet<OwnerRiskItem[]>('/api/service-owner/risk-register'),
    staleTime: 30_000,
  });

  const services = servicesQ.data ?? [];
  const allRisks = risksQ.data ?? [];

  // ---- Filters ----
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  const filteredRisks = useMemo(() => {
    return allRisks.filter((r) => {
      if (serviceFilter !== 'ALL' && r.serviceId !== serviceFilter) return false;
      if (severityFilter !== 'ALL' && r.severity !== severityFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (sourceFilter !== 'ALL' && r.sourceType !== sourceFilter) return false;
      return true;
    });
  }, [allRisks, serviceFilter, severityFilter, statusFilter, sourceFilter]);

  // ---- Summary tiles ----
  const summary = useMemo(() => {
    const open = allRisks.filter((r) => r.status === 'OPEN').length;
    const mitigating = allRisks.filter((r) => r.status === 'MITIGATING').length;
    const critical = allRisks.filter((r) => r.severity === 'CRITICAL' && r.status !== 'CLOSED').length;
    const high = allRisks.filter((r) => r.severity === 'HIGH' && r.status !== 'CLOSED').length;
    return { open, mitigating, critical, high };
  }, [allRisks]);

  // ---- Mutations ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    serviceId: '',
    title: '',
    sourceType: 'MANUAL',
    severity: 'MEDIUM',
    mitigation: '',
    dueDate: '',
  });

  const createMut = useMutation({
    mutationFn: (form: typeof createForm) =>
      apiPost('/api/service-owner/risk-register', {
        serviceId: form.serviceId,
        title: form.title,
        sourceType: form.sourceType,
        severity: form.severity,
        mitigation: form.mitigation || undefined,
        dueDate: form.dueDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Risk created', {
        description: 'Persisted risk added to the register.',
      });
      qc.invalidateQueries({ queryKey: ['service-owner', 'risk-register'] });
      setCreateOpen(false);
      setCreateForm({
        serviceId: '',
        title: '',
        sourceType: 'MANUAL',
        severity: 'MEDIUM',
        mitigation: '',
        dueDate: '',
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptMut = useMutation({
    mutationFn: (risk: OwnerRiskItem) => {
      if (risk.id.startsWith('derived:')) {
        // Derived risks can't be PATCHed — they're synthesised from live data.
        // We POST a persisted ACCEPTED risk with the same source to shadow the
        // derived one. The API dedupes on sourceType:sourceId.
        return apiPost('/api/service-owner/risk-register', {
          serviceId: risk.serviceId,
          title: risk.title,
          sourceType: risk.sourceType,
          sourceId: risk.sourceId,
          severity: risk.severity,
          status: 'ACCEPTED',
          mitigation: 'Risk accepted by Service Owner.',
        });
      }
      return apiPatch(`/api/service-risks/${risk.id}`, { status: 'ACCEPTED' });
    },
    onSuccess: () => {
      toast.success('Risk accepted');
      qc.invalidateQueries({ queryKey: ['service-owner', 'risk-register'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: (risk: OwnerRiskItem) => {
      if (risk.id.startsWith('derived:')) {
        return apiPost('/api/service-owner/risk-register', {
          serviceId: risk.serviceId,
          title: risk.title,
          sourceType: risk.sourceType,
          sourceId: risk.sourceId,
          severity: risk.severity,
          status: 'CLOSED',
          mitigation: 'Risk closed by Service Owner.',
        });
      }
      return apiPatch(`/api/service-risks/${risk.id}`, { status: 'CLOSED' });
    },
    onSuccess: () => {
      toast.success('Risk closed');
      qc.invalidateQueries({ queryKey: ['service-owner', 'risk-register'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [mitigationTarget, setMitigationTarget] = useState<OwnerRiskItem | null>(null);
  const [mitigationText, setMitigationText] = useState('');
  const [mitigationStatus, setMitigationStatus] = useState<'MITIGATING' | 'ACCEPTED'>('MITIGATING');
  const [mitigationDueDate, setMitigationDueDate] = useState('');

  const mitigationMut = useMutation({
    mutationFn: (args: { risk: OwnerRiskItem; mitigation: string; status: 'MITIGATING' | 'ACCEPTED'; dueDate: string }) => {
      if (args.risk.id.startsWith('derived:')) {
        // Promote to a persisted risk with mitigation.
        return apiPost('/api/service-owner/risk-register', {
          serviceId: args.risk.serviceId,
          title: args.risk.title,
          sourceType: args.risk.sourceType,
          sourceId: args.risk.sourceId,
          severity: args.risk.severity,
          status: args.status,
          mitigation: args.mitigation,
          dueDate: args.dueDate || undefined,
        });
      }
      return apiPatch(`/api/service-risks/${args.risk.id}`, {
        mitigation: args.mitigation,
        status: args.status,
        dueDate: args.dueDate || undefined,
      });
    },
    onSuccess: (_data, vars) => {
      toast.success('Mitigation recorded', {
        description: `"${vars.risk.title}" — mitigation plan saved.`,
      });
      qc.invalidateQueries({ queryKey: ['service-owner', 'risk-register'] });
      setMitigationTarget(null);
      setMitigationText('');
      setMitigationStatus('MITIGATING');
      setMitigationDueDate('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = servicesQ.isLoading || risksQ.isLoading;

  // ---- Columns ----
  const columns: Column<OwnerRiskItem>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{r.serviceName}</div>
          <div className="text-[10px] text-muted-foreground">{r.sourceType}</div>
        </div>
      ),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
    },
    {
      key: 'title',
      header: 'Risk',
      render: (r) => {
        const meta = SOURCE_TYPE_META[r.sourceType] ?? SOURCE_TYPE_META.MANUAL;
        const Icon = meta.icon;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{r.title}</span>
            </div>
            {r.mitigation && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.mitigation}</p>
            )}
            <Badge variant="outline" className="text-[10px] mt-1 py-0 px-1.5">
              {meta.label}
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (r) => (
        <Badge variant="outline" className={cn('font-semibold', SEVERITY_BADGE_CLS[r.severity] ?? '')}>
          {r.severity}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge variant="outline" className={cn('font-medium', STATUS_BADGE_CLS[r.status] ?? '')}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      render: (r) =>
        r.dueDate ? (
          <div className="flex flex-col">
            <FormattedDate date={r.dueDate} className="text-xs" />
            {new Date(r.dueDate).getTime() < Date.now() && r.status !== 'CLOSED' && (
              <span className="text-[10px] text-rose-600 dark:text-rose-400">overdue</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'created',
      header: 'Identified',
      render: (r) => <RelativeTime date={r.createdAt} className="text-xs" />,
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell',
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1">
          {r.status === 'OPEN' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                acceptMut.mutate(r);
              }}
              disabled={acceptMut.isPending}
            >
              <ShieldCheck className="h-3 w-3" /> Accept
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setMitigationTarget(r);
              setMitigationText(r.mitigation ?? '');
              setMitigationStatus(r.status === 'OPEN' ? 'MITIGATING' : (r.status as 'MITIGATING' | 'ACCEPTED'));
              setMitigationDueDate(r.dueDate ? r.dueDate.slice(0, 10) : '');
            }}
          >
            <Wrench className="h-3 w-3" /> {r.mitigation ? 'Edit' : 'Mitigate'}
          </Button>
          {r.status !== 'CLOSED' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Close risk "${r.title}"?`)) {
                  closeMut.mutate(r);
                }
              }}
              disabled={closeMut.isPending}
            >
              <Archive className="h-3 w-3" /> Close
            </Button>
          )}
          {r.sourceId && !r.id.startsWith('derived:') && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                if (r.sourceType === 'PROBLEM') navigate('problems');
                else if (r.sourceType === 'CHANGE') navigate('changes');
                else if (r.sourceType === 'SLA') navigate('sla');
                else if (r.sourceType === 'CATALOG') navigate('portfolio');
                else if (r.sourceType === 'KNOWLEDGE') navigate('knowledge');
                else navigate('portfolio');
              }}
            >
              <ArrowUpRight className="h-3 w-3" /> Open
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Register"
        description="Risks on the services you own — derived from live SLA breaches, problems without workarounds, emergency changes, and stale catalog reviews, plus any manual risks you record. Each CRITICAL or HIGH risk needs an explicit decision: accept, mitigate, or escalate."
        icon={<TriangleAlert className="h-6 w-6" />}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Create Risk
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Critical"
          value={summary.critical}
          tone="danger"
          hint="OPEN + not closed"
          icon={<Flame className="h-4 w-4" />}
        />
        <StatCard
          label="High"
          value={summary.high}
          tone="warning"
          hint="OPEN + not closed"
        />
        <StatCard
          label="Open"
          value={summary.open}
          tone="danger"
          hint="Awaiting decision"
        />
        <StatCard
          label="Mitigating"
          value={summary.mitigating}
          tone="warning"
          hint="Plan in progress"
        />
      </div>

      <SectionCard
        title="Risk Register — Owned Services"
        description="Derived risks are synthesised from live data; manual risks are persisted entries you create. Both kinds can be accepted, mitigated, or closed — accepting a derived risk promotes it to a persisted entry so the decision sticks."
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any severity</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[170px] h-8 text-xs">
              <SelectValue placeholder="Source type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any source</SelectItem>
              {SOURCE_TYPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_TYPE_META[s]?.label ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <LoadingState rows={5} />
        ) : filteredRisks.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="No risks match the filter"
            description="Either your services have no current risks, or all entries are filtered out. Derived risks will reappear when underlying conditions (SLA breaches, missing workarounds) reoccur."
          />
        ) : (
          <DataTable columns={columns} rows={filteredRisks} />
        )}
      </SectionCard>

      {/* Create Risk Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Manual Risk</DialogTitle>
            <DialogDescription>
              Record a risk you have identified on one of your services. Manual risks persist until you explicitly close them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="risk-service" className="text-xs">Service (required)</Label>
              <Select
                value={createForm.serviceId}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, serviceId: v }))}
              >
                <SelectTrigger id="risk-service" className="mt-1 h-9 text-sm">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="risk-title" className="text-xs">Title (required)</Label>
              <Input
                id="risk-title"
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Single-vendor dependency on backup appliance"
                className="mt-1 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="risk-source" className="text-xs">Source type</Label>
                <Select
                  value={createForm.sourceType}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, sourceType: v }))}
                >
                  <SelectTrigger id="risk-source" className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SOURCE_TYPE_META[s]?.label ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="risk-severity" className="text-xs">Severity</Label>
                <Select
                  value={createForm.severity}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, severity: v }))}
                >
                  <SelectTrigger id="risk-severity" className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="risk-mitigation" className="text-xs">Mitigation plan (optional)</Label>
              <Textarea
                id="risk-mitigation"
                value={createForm.mitigation}
                onChange={(e) => setCreateForm((f) => ({ ...f, mitigation: e.target.value }))}
                placeholder="Describe the mitigation plan, owner, and target outcome."
                className="mt-1 min-h-[80px] text-sm"
              />
            </div>
            <div>
              <Label htmlFor="risk-due" className="text-xs">Due date (optional)</Label>
              <Input
                id="risk-due"
                type="date"
                value={createForm.dueDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, dueDate: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate(createForm)}
              disabled={createMut.isPending || !createForm.serviceId || !createForm.title.trim()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Create risk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mitigation Dialog */}
      <Dialog open={!!mitigationTarget} onOpenChange={(o) => !o && setMitigationTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mitigation Plan</DialogTitle>
            <DialogDescription>
              {mitigationTarget?.title}
              <br />
              {mitigationTarget?.serviceName} · {mitigationTarget?.severity} · {mitigationTarget?.sourceType}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="mitigation-text" className="text-xs">Mitigation plan / notes</Label>
              <Textarea
                id="mitigation-text"
                value={mitigationText}
                onChange={(e) => setMitigationText(e.target.value)}
                placeholder="Describe the mitigation plan, the owner, the actions being taken, and the target outcome."
                className="mt-1 min-h-[100px] text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mitigation-status" className="text-xs">Set status to</Label>
                <Select value={mitigationStatus} onValueChange={(v) => setMitigationStatus(v as 'MITIGATING' | 'ACCEPTED')}>
                  <SelectTrigger id="mitigation-status" className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MITIGATING">MITIGATING — plan in progress</SelectItem>
                    <SelectItem value="ACCEPTED">ACCEPTED — risk accepted with rationale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="mitigation-due" className="text-xs">Due date (optional)</Label>
                <Input
                  id="mitigation-due"
                  type="date"
                  value={mitigationDueDate}
                  onChange={(e) => setMitigationDueDate(e.target.value)}
                  className="mt-1 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMitigationTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (mitigationTarget && mitigationText.trim()) {
                  mitigationMut.mutate({
                    risk: mitigationTarget,
                    mitigation: mitigationText,
                    status: mitigationStatus,
                    dueDate: mitigationDueDate,
                  });
                }
              }}
              disabled={mitigationMut.isPending || !mitigationText.trim()}
            >
              <Wrench className="h-3.5 w-3.5 mr-1" /> Save mitigation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
