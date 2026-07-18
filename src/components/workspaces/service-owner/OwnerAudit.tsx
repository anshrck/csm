'use client';

/**
 * Service Owner — Audit Log view (Owned Services).
 *
 * Filters: service (select owned services), entity type (select), actor (text
 * contains), action (text contains), date range (dateFrom / dateTo).
 *
 * DataTable: Timestamp, Actor, Action, Entity type, Entity ID, expandable
 * before/after JSON diff.
 *
 * Load-more pagination (no infinite scroll — explicit button).
 * Export CSV button.
 *
 * Data from GET /api/audit-logs (scoped to owned services server-side).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ScrollText,
  ChevronRight,
  Download,
  User,
  Filter,
  X,
  Loader2,
} from 'lucide-react';
import { useOwnerServices } from './_hooks';

interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ENTITY_TYPES = [
  'Service',
  'Demand',
  'Change',
  'Problem',
  'Ticket',
  'KnowledgeArticle',
  'SlaEvent',
  'Communication',
  'ServiceRisk',
  'GovernanceDecision',
];

const PAGE_SIZE = 50;

export default function OwnerAudit() {
  const servicesQ = useOwnerServices();
  const services = servicesQ.data ?? [];

  // ---- Filters ----
  const [serviceId, setServiceId] = useState<string>('ALL');
  const [entityType, setEntityType] = useState<string>('ALL');
  const [actor, setActor] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [limit, setLimit] = useState<number>(PAGE_SIZE);

  // Build the query string. When a service filter is applied, we can't ask
  // the audit API to filter by service directly — but the API already scopes
  // to owned services server-side, so we just rely on the entity-type filter
  // and a client-side filter on the service id embedded in entity refs.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (entityType !== 'ALL') params.set('entityType', entityType);
    if (action.trim()) params.set('action', action.trim());
    if (dateFrom) params.set('dateFrom', new Date(dateFrom).toISOString());
    if (dateTo) params.set('dateTo', new Date(`${dateTo}T23:59:59`).toISOString());
    return params.toString();
  }, [entityType, action, dateFrom, dateTo, limit]);

  const logsQ = useQuery<AuditLogEntry[]>({
    queryKey: ['audit-logs', 'owner', queryString],
    queryFn: () => apiGet<AuditLogEntry[]>(`/api/audit-logs?${queryString}`),
    staleTime: 30_000,
  });

  const allLogs = logsQ.data ?? [];

  // ---- Client-side post-filters: actor contains, serviceId match ----
  // The audit API doesn't accept these filters directly; we post-filter here.
  const filteredLogs = useMemo(() => {
    return allLogs.filter((l) => {
      if (actor.trim()) {
        const q = actor.trim().toLowerCase();
        if (!l.actorName.toLowerCase().includes(q)) return false;
      }
      if (serviceId !== 'ALL') {
        // The audit log doesn't expose a serviceId directly. We match on
        // before/after JSON containing the serviceId string, OR on entityId
        // when the entity is a Service.
        if (l.entityType === 'Service' && l.entityId !== serviceId) return false;
        else if (l.entityType !== 'Service') {
          const blob = JSON.stringify({ before: l.before, after: l.after });
          if (!blob.includes(serviceId)) return false;
        }
      }
      return true;
    });
  }, [allLogs, actor, serviceId]);

  // ---- Summary ----
  const summary = useMemo(() => {
    const total = filteredLogs.length;
    const uniqueActors = new Set(filteredLogs.map((l) => l.actorId).filter(Boolean)).size;
    const uniqueEntities = new Set(filteredLogs.map((l) => `${l.entityType}:${l.entityId}`)).size;
    const last24h = filteredLogs.filter(
      (l) => Date.now() - new Date(l.createdAt).getTime() < 86400000,
    ).length;
    return { total, uniqueActors, uniqueEntities, last24h };
  }, [filteredLogs]);

  // ---- Export CSV ----
  const exportCsv = () => {
    const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Before', 'After'];
    const rows = filteredLogs.map((l) => [
      new Date(l.createdAt).toISOString(),
      l.actorName,
      l.action,
      l.entityType,
      l.entityId,
      l.before ? JSON.stringify(l.before).replace(/"/g, '""') : '',
      l.after ? JSON.stringify(l.after).replace(/"/g, '""') : '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell)}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-owned-services-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV exported', {
      description: `${rows.length} audit entries downloaded.`,
    });
  };

  const resetFilters = () => {
    setServiceId('ALL');
    setEntityType('ALL');
    setActor('');
    setAction('');
    setDateFrom('');
    setDateTo('');
    setLimit(PAGE_SIZE);
  };

  const loading = servicesQ.isLoading || logsQ.isLoading;
  const hasMore = filteredLogs.length >= limit;

  // ---- Columns ----
  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'timestamp',
      header: 'Timestamp',
      render: (l) => (
        <div className="flex flex-col">
          <span className="text-xs font-medium tabular-nums">
            {new Date(l.createdAt).toLocaleString()}
          </span>
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (l) => (
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs">{l.actorName}</span>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (l) => (
        <Badge variant="outline" className="text-[10px] font-mono py-0 px-1.5 bg-muted/40">
          {l.action}
        </Badge>
      ),
    },
    {
      key: 'entityType',
      header: 'Entity Type',
      render: (l) => (
        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
          {l.entityType}
        </Badge>
      ),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
    },
    {
      key: 'entityId',
      header: 'Entity ID',
      render: (l) => (
        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px] block">
          {l.entityId}
        </span>
      ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'diff',
      header: 'Changes',
      render: (l) => <DiffCell entry={l} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log — Owned Services"
        description="Every persisted change to entities tied to the services you own — demands, tickets, problems, changes, SLA events, knowledge articles, communications, risks, and governance decisions. Filter, expand a row to inspect before/after JSON, and export to CSV for governance review."
        icon={<ScrollText className="h-6 w-6" />}
        actions={
          <Button
            onClick={exportCsv}
            disabled={filteredLogs.length === 0}
            variant="outline"
            className="gap-1.5"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Entries (current view)" value={summary.total} hint={`Top ${limit} loaded`} />
        <StatCard label="Unique Actors" value={summary.uniqueActors} />
        <StatCard label="Unique Entities" value={summary.uniqueEntities} />
        <StatCard label="Last 24h" value={summary.last24h} tone="success" />
      </div>

      <SectionCard
        title="Filters"
        description="Narrow the audit log by entity type, actor, action keyword, or date range. The service filter matches entries whose before/after JSON references the selected service id."
        actions={
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={resetFilters}>
            <X className="h-3 w-3" /> Reset
          </Button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="All services" />
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
          </div>
          <div>
            <Label className="text-xs">Entity Type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Actor (contains)</Label>
            <Input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="e.g. Henrik"
              className="mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Action (contains)</Label>
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. CREATED"
              className="mt-1 h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 h-8 text-xs"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Audit Entries"
        description="Expand a row to inspect the before/after JSON diff. Entries are scoped server-side to entities on services you own."
        actions={
          <Badge variant="outline" className="text-xs gap-1">
            <Filter className="h-3 w-3" /> {filteredLogs.length} shown
          </Badge>
        }
      >
        {loading ? (
          <LoadingState rows={5} />
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-8 w-8" />}
            title="No audit entries match the filter"
            description="Try widening the date range, clearing the action filter, or selecting a different entity type."
          />
        ) : (
          <>
            <DataTable columns={columns} rows={filteredLogs} />
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                  disabled={logsQ.isFetching}
                >
                  {logsQ.isFetching ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Loading…
                    </>
                  ) : (
                    <>Load {PAGE_SIZE} more</>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

// ---- Diff cell (expandable before/after JSON) ----

function DiffCell({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDiff = entry.before != null || entry.after != null;
  if (!hasDiff) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline">
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
        />
        {open ? 'Hide' : 'Show'} diff
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl">
          <div className="rounded border bg-rose-50/40 dark:bg-rose-950/20 p-2">
            <div className="text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300 mb-1">
              Before
            </div>
            <pre className="text-[10px] font-mono overflow-x-auto scrollbar-thin max-h-40 whitespace-pre-wrap break-all">
              {entry.before ? JSON.stringify(entry.before, null, 2) : '—'}
            </pre>
          </div>
          <div className="rounded border bg-emerald-50/40 dark:bg-emerald-950/20 p-2">
            <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300 mb-1">
              After
            </div>
            <pre className="text-[10px] font-mono overflow-x-auto scrollbar-thin max-h-40 whitespace-pre-wrap break-all">
              {entry.after ? JSON.stringify(entry.after, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
