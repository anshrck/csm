'use client';

/**
 * AuditViewer — CM Leader audit-log explorer.
 *
 * Features:
 *   - Filters: actor (select populated from audit log distinct actors),
 *     entity type (select), action (text contains), date range.
 *   - DataTable: timestamp, actor, action, entity type, entity ID. Click to
 *     expand a row and reveal the before/after JSON payloads.
 *   - Load-more button (refetches with the API's max limit of 500 rows).
 *   - Export CSV button (exports the currently filtered set, up to 500 rows).
 *
 * The component is mounted at view 'audit' on the CM Leader workspace.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  RelativeTime,
  Badge,
  Button,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ScrollText,
  Download,
  ChevronDown,
  ChevronRight,
  Filter,
  X,
  Clock,
  User,
  Activity,
  Database,
  RefreshCw,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---- Wire types ------------------------------------------------------------

interface AuditLogRow {
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

interface AuditLogResponse {
  // The API returns a flat array of audit log rows.
  rows: AuditLogRow[];
  total: number;
}

// ---- Entity type options ---------------------------------------------------

const ENTITY_TYPES = [
  'Ticket',
  'Demand',
  'Change',
  'Problem',
  'SlaEvent',
  'KnowledgeArticle',
  'SlaReport',
  'GovernanceDecision',
  'Communication',
  'NotificationDelivery',
  'EntityLink',
  'User',
  'OrgNode',
  'Service',
  'ServiceOffering',
  'SlaProfile',
  'SlaPolicy',
  'SlaClock',
];

// ---- Action badge tone helper ---------------------------------------------

function actionTone(action: string): string {
  if (action.includes('DELETE')) return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300';
  if (action.includes('CREATE') || action.includes('SUBMIT') || action.includes('OPEN'))
    return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300';
  if (action.includes('UPDATE') || action.includes('PATCH') || action.includes('APPROVE') || action.includes('ACCEPT'))
    return 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300';
  if (action.includes('REJECT') || action.includes('CLOSE') || action.includes('CANCEL'))
    return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300';
  if (action.includes('BREACH') || action.includes('FAIL') || action.includes('ERROR'))
    return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300';
  return 'bg-muted text-muted-foreground border-border';
}

function entityTypeTone(type: string): string {
  if (type === 'Ticket') return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300';
  if (type === 'Demand') return 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300';
  if (type === 'Change') return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300';
  if (type === 'Problem') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300';
  if (type === 'SlaEvent' || type === 'SlaReport' || type === 'SlaClock')
    return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300';
  if (type === 'KnowledgeArticle')
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300';
  return 'bg-muted text-muted-foreground border-border';
}

// ---- JSON viewer (compact) -------------------------------------------------

function JsonView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted-foreground italic">—</span>;
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  // Truncate very large blobs for display.
  const truncated = pretty.length > 4000 ? pretty.slice(0, 4000) + '\n… (truncated)' : pretty;
  return (
    <pre className="text-[11px] leading-relaxed font-mono bg-muted/40 border rounded-md p-2.5 overflow-x-auto scrollbar-thin max-h-72 whitespace-pre-wrap break-all">
      {truncated}
    </pre>
  );
}

// ---- Main component --------------------------------------------------------

export default function AuditViewer() {
  // Filter state.
  const [actorFilter, setActorFilter] = useState<string>('__all');
  const [entityFilter, setEntityFilter] = useState<string>('__all');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Current page of rows (from the latest fetch).
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build the API URL from the current filters. We use a string-key so React
  // Query re-fetches when any filter changes. The audit-logs API supports up
  // to 500 rows per fetch; we request 200 by default and offer a [Load all]
  // button to bump up to 500.
  const [pageSize, setPageSize] = useState<number>(200);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(pageSize));
    if (actorFilter !== '__all') p.set('actorId', actorFilter);
    if (entityFilter !== '__all') p.set('entityType', entityFilter);
    if (actionFilter.trim()) p.set('action', actionFilter.trim());
    if (dateFrom) p.set('dateFrom', new Date(dateFrom).toISOString());
    if (dateTo) {
      // Date inputs are day-precision; extend to end-of-day.
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      p.set('dateTo', end.toISOString());
    }
    return p.toString();
  }, [actorFilter, entityFilter, actionFilter, dateFrom, dateTo, pageSize]);

  // Fetch the audit log page. The API returns a flat array; we wrap it into
  // the AuditLogResponse shape for client-side pagination compatibility.
  const initialQuery = useQuery<AuditLogResponse>({
    queryKey: ['audit-logs', queryParams],
    queryFn: async () => {
      const arr = await apiGet<AuditLogRow[]>(`/api/audit-logs?${queryParams}`);
      return { rows: arr, total: arr.length };
    },
  });

  // When the initial query resolves, replace accumulated rows.
  React.useEffect(() => {
    if (initialQuery.data) {
      setRows(initialQuery.data.rows);
      setTotal(initialQuery.data.total);
      setExpanded(new Set());
    }
  }, [initialQuery.data]);

  // Load more: the API doesn't support cursor pagination, so we re-fetch with
  // a larger limit (up to the API maximum of 500).
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setPageSize(500);
    try {
      // Wait for the next refetch (driven by the pageSize change above).
      await initialQuery.refetch();
    } finally {
      setLoadingMore(false);
    }
  };

  // Actors (for the actor filter select). We fetch a fresh list of distinct
  // actors by issuing a stats-like call. To keep it simple, we derive the
  // actor options from the current page of results + a separate fetch of the
  // last 200 entries' distinct actors.
  const actorsQuery = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['audit-logs', 'actors'],
    queryFn: async () => {
      const arr = await apiGet<AuditLogRow[]>(`/api/audit-logs?limit=200`);
      const seen = new Map<string, string>();
      for (const r of arr) {
        if (r.actorId && !seen.has(r.actorId)) seen.set(r.actorId, r.actorName);
      }
      return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    },
    staleTime: 5 * 60 * 1000,
  });

  // ---- CSV export ----------------------------------------------------------
  const exportCsv = async () => {
    try {
      // Fetch up to 500 rows for export (re-issue the same filters with the
      // max limit the API supports).
      const p = new URLSearchParams(queryParams);
      p.set('limit', '500');
      const allRows = await apiGet<AuditLogRow[]>(`/api/audit-logs?${p.toString()}`);

      const header = ['Timestamp', 'Actor', 'Action', 'EntityType', 'EntityId', 'IpAddress'];
      const lines = [header.join(',')];
      for (const r of allRows) {
        const cells = [
          r.createdAt,
          `"${(r.actorName || '').replace(/"/g, '""')}"`,
          `"${r.action.replace(/"/g, '""')}"`,
          r.entityType,
          r.entityId,
          r.ipAddress ?? '',
        ];
        lines.push(cells.join(','));
      }
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${allRows.length} rows to CSV`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  // ---- Filters UI ----------------------------------------------------------
  const clearFilters = () => {
    setActorFilter('__all');
    setEntityFilter('__all');
    setActionFilter('');
    setDateFrom('');
    setDateTo('');
  };
  const hasActiveFilters =
    actorFilter !== '__all' ||
    entityFilter !== '__all' ||
    actionFilter.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== '';

  // ---- Row expansion toggle ------------------------------------------------

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Render --------------------------------------------------------------
  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description="Immutable record of every mutation across the platform — ticket, demand, change, SLA, governance, and notification events. CM Leader oversight view."
        icon={<ScrollText className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => initialQuery.refetch()} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', initialQuery.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Filters */}
      <SectionCard
        title="Filters"
        description="Narrow the audit trail by actor, entity type, action keyword, or date range."
        actions={
          hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="audit-actor" className="text-xs flex items-center gap-1.5">
              <User className="h-3 w-3" /> Actor
            </Label>
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger id="audit-actor" className="w-full">
                <SelectValue placeholder="All actors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All actors</SelectItem>
                {(actorsQuery.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="audit-entity" className="text-xs flex items-center gap-1.5">
              <Database className="h-3 w-3" /> Entity type
            </Label>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger id="audit-entity" className="w-full">
                <SelectValue placeholder="All entity types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All entity types</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="audit-action" className="text-xs flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> Action (contains)
            </Label>
            <Input
              id="audit-action"
              placeholder="e.g. TICKET_ or DELETE"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="audit-from" className="text-xs flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> From
            </Label>
            <Input
              id="audit-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="audit-to" className="text-xs flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> To
            </Label>
            <Input
              id="audit-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </SectionCard>

      {/* Results summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Filter className="h-3 w-3" />
          {initialQuery.isLoading ? 'Loading…' : `${rows.length} of ${total ?? rows.length} entries shown`}
        </span>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5" disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Table */}
      {initialQuery.isLoading ? (
        <LoadingState rows={6} />
      ) : initialQuery.isError ? (
        <EmptyState
          icon={<ScrollText className="h-10 w-10 text-muted-foreground/50" />}
          title="Failed to load audit log"
          description={initialQuery.error instanceof Error ? initialQuery.error.message : 'Unknown error'}
          action={
            <Button onClick={() => initialQuery.refetch()} variant="outline" size="sm">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-10 w-10 text-muted-foreground/50" />}
          title="No audit entries match your filters"
          description="Try widening the date range or clearing filters to see more results."
          action={
            hasActiveFilters ? (
              <Button onClick={clearFilters} variant="outline" size="sm" className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ScrollArea className="max-h-[calc(100vh-380px)] pr-3">
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-md border bg-card hover:bg-muted/20 transition-colors p-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-[180px_200px_1fr_160px] gap-3 items-start">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium tabular-nums">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      <RelativeTime date={r.createdAt} />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{r.actorName}</div>
                      {r.ipAddress && (
                        <div className="text-[10px] text-muted-foreground truncate">{r.ipAddress}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={cn('text-[11px] font-mono', actionTone(r.action))}>
                      {r.action}
                    </Badge>
                    <Badge variant="outline" className={cn('text-[11px]', entityTypeTone(r.entityType))}>
                      {r.entityType}
                    </Badge>
                    <span
                      className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]"
                      title={r.entityId}
                    >
                      {r.entityId}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpand(r.id)}
                      className="h-7 px-2 text-xs gap-1"
                    >
                      {expanded.has(r.id) ? (
                        <>
                          <ChevronDown className="h-3 w-3" /> Hide
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3 w-3" /> Payload
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {expanded.has(r.id) && (
                  <div className="mt-3 pt-3 border-t grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Before
                      </div>
                      <JsonView value={r.before} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        After
                      </div>
                      <JsonView value={r.after} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Load more — the API supports up to 500 rows per fetch. When the
                current page returned the full page size, we offer to bump the
                page size up to 500 to retrieve more rows in a single fetch. */}
            <div className="flex justify-center pt-2">
              {pageSize < 500 && rows.length >= pageSize ? (
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="gap-1.5">
                  {loadingMore ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" /> Load up to 500 rows
                    </>
                  )}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  {pageSize >= 500 && rows.length >= 500
                    ? 'Showing the most recent 500 entries — refine filters to narrow further.'
                    : 'End of audit trail'}
                </span>
              )}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
