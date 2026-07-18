'use client';

/**
 * DeliveryAdmin — CM Leader notification-delivery oversight view.
 *
 * Features:
 *   - Stat cards: PENDING count, SENT count, FAILED count, success rate.
 *   - Filters: status, channel, date range.
 *   - DataTable of NotificationDelivery rows joined to their parent
 *     Notification (title, recipient user).
 *   - [Retry] button on FAILED deliveries — POST /api/notification-deliveries
 *     (creates a new PENDING delivery for the same notification + channel).
 *   - [Process Pending] button — POST /api/notification-deliveries/process
 *     (flushes the queue immediately).
 *
 * Mounted at view 'delivery-failures' on the CM Leader workspace.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  RelativeTime,
  UserAvatar,
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
  MailCheck,
  Mail,
  RefreshCw,
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  Inbox,
  Activity,
  X,
  PlayCircle,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---- Wire types ------------------------------------------------------------

interface DeliveryRow {
  id: string;
  notificationId: string;
  channel: 'PORTAL' | 'EMAIL' | 'TEAMS' | 'SLACK';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  notification: {
    id: string;
    userId: string;
    type: string;
    title: string;
    entityRef: string | null;
    createdAt: string;
    user: { id: string; name: string; email: string; avatarColor: string } | null;
  } | null;
}

interface DeliveryStats {
  byStatus: Record<string, number>;
  byChannel: Record<string, Record<string, number>>;
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

// ---- Helpers ---------------------------------------------------------------

const CHANNEL_LABELS: Record<string, string> = {
  PORTAL: 'Portal',
  EMAIL: 'Email',
  TEAMS: 'Teams',
  SLACK: 'Slack',
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  PORTAL: <Inbox className="h-3.5 w-3.5" />,
  EMAIL: <Mail className="h-3.5 w-3.5" />,
  TEAMS: <Send className="h-3.5 w-3.5" />,
  SLACK: <Send className="h-3.5 w-3.5" />,
};

function statusTone(status: string): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'FAILED') return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300';
  if (status === 'PENDING') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300';
  if (status === 'SKIPPED') return 'bg-muted text-muted-foreground border-border';
  return 'bg-muted text-muted-foreground border-border';
}

// ---- Main component --------------------------------------------------------

export default function DeliveryAdmin() {
  const qc = useQueryClient();

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('__all');
  const [channelFilter, setChannelFilter] = useState<string>('__all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Stats query (independent of filters — always tenant-wide totals).
  const statsQuery = useQuery<DeliveryStats>({
    queryKey: ['notification-deliveries', 'stats'],
    queryFn: () => apiGet<DeliveryStats>('/api/notification-deliveries?stats=1'),
    refetchInterval: 15_000, // refresh stats every 15s for live oversight
  });

  // Build the rows query URL from filters.
  const rowsQueryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '200');
    if (statusFilter !== '__all') p.set('status', statusFilter);
    if (channelFilter !== '__all') p.set('channel', channelFilter);
    if (dateFrom) p.set('dateFrom', new Date(dateFrom).toISOString());
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      p.set('dateTo', end.toISOString());
    }
    return p.toString();
  }, [statusFilter, channelFilter, dateFrom, dateTo]);

  const rowsQuery = useQuery<DeliveryRow[]>({
    queryKey: ['notification-deliveries', 'list', rowsQueryParams],
    queryFn: () => apiGet<DeliveryRow[]>(`/api/notification-deliveries?${rowsQueryParams}`),
  });

  // Client-side date filtering (the API doesn't yet support date filters on
  // rows; we filter here to keep the API surface stable).
  const filteredRows = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 86_399_999 : null;
    return (rowsQuery.data ?? []).filter((r) => {
      const ts = new Date(r.createdAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      return true;
    });
  }, [rowsQuery.data, dateFrom, dateTo]);

  // ---- Mutations ----------------------------------------------------------
  const retryMut = useMutation({
    mutationFn: (delivery: DeliveryRow) =>
      apiPost('/api/notification-deliveries', {
        notificationId: delivery.notificationId,
        channel: delivery.channel,
      }),
    onSuccess: () => {
      toast.success('Retry scheduled — new PENDING delivery created');
      qc.invalidateQueries({ queryKey: ['notification-deliveries'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Retry failed'),
  });

  const processMut = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; sent: number; failed: number; skipped: number; processed: number; durationMs: number; message: string }>('/api/notification-deliveries/process'),
    onSuccess: (data) => {
      toast.success(data.message || `Processed ${data.processed} deliveries`);
      qc.invalidateQueries({ queryKey: ['notification-deliveries'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Processing failed'),
  });

  // ---- Derived stats ------------------------------------------------------
  const stats = statsQuery.data;
  const successRate =
    stats && stats.total > 0
      ? Math.round(((stats.sent ?? 0) / stats.total) * 100)
      : null;

  // Filter reset
  const clearFilters = () => {
    setStatusFilter('__all');
    setChannelFilter('__all');
    setDateFrom('');
    setDateTo('');
  };
  const hasActiveFilters =
    statusFilter !== '__all' ||
    channelFilter !== '__all' ||
    dateFrom !== '' ||
    dateTo !== '';

  // ---- Render -------------------------------------------------------------
  return (
    <div className="space-y-5">
      <PageHeader
        title="Notification Delivery Admin"
        description="Operational oversight of the notification delivery queue. Retry failed deliveries, flush pending ones, and monitor channel-level success rates."
        icon={<MailCheck className="h-5 w-5" />}
        actions={
          <Button
            size="sm"
            onClick={() => processMut.mutate()}
            disabled={processMut.isPending}
            className="gap-1.5"
          >
            {processMut.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {processMut.isPending ? 'Processing…' : 'Process Pending'}
          </Button>
        }
      />

      {/* Stat cards */}
      {statsQuery.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Pending"
            value={stats?.pending ?? 0}
            icon={<Clock className="h-4 w-4" />}
            tone="warning"
            hint="Awaiting worker pickup"
          />
          <StatCard
            label="Sent"
            value={stats?.sent ?? 0}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="success"
            hint="Successfully delivered"
          />
          <StatCard
            label="Failed"
            value={stats?.failed ?? 0}
            icon={<AlertCircle className="h-4 w-4" />}
            tone="danger"
            hint="Needs retry or investigation"
          />
          <StatCard
            label="Success Rate"
            value={successRate === null ? '—' : `${successRate}%`}
            icon={<Activity className="h-4 w-4" />}
            hint={`${stats?.total ?? 0} total deliveries`}
          />
        </div>
      )}

      {/* Per-channel breakdown */}
      {stats && (
        <SectionCard title="Channel Breakdown" description="Per-channel delivery outcomes across the tenant.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['PORTAL', 'EMAIL', 'TEAMS', 'SLACK'] as const).map((ch) => {
              const b = stats.byChannel[ch] ?? {};
              const total = (b.PENDING ?? 0) + (b.SENT ?? 0) + (b.FAILED ?? 0) + (b.SKIPPED ?? 0);
              const rate = total > 0 ? Math.round(((b.SENT ?? 0) / total) * 100) : null;
              return (
                <div key={ch} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    {CHANNEL_ICONS[ch]}
                    <span className="text-xs font-medium">{CHANNEL_LABELS[ch]}</span>
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{total}</div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {b.SENT ?? 0} sent
                    </Badge>
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300">
                      {b.PENDING ?? 0} pending
                    </Badge>
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300">
                      {b.FAILED ?? 0} failed
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {rate === null ? '—' : `${rate}% success`}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <SectionCard
        title="Delivery Queue"
        description="Filter and inspect individual delivery records. Retry failures or wait for the worker tick."
        actions={
          hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-status" className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="d-status" className="w-full">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SENT">Sent</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-channel" className="text-xs">Channel</Label>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger id="d-channel" className="w-full">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All channels</SelectItem>
                <SelectItem value="PORTAL">Portal</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="TEAMS">Teams</SelectItem>
                <SelectItem value="SLACK">Slack</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-from" className="text-xs">From</Label>
            <Input id="d-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-to" className="text-xs">To</Label>
            <Input id="d-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        {/* Rows */}
        {rowsQuery.isLoading ? (
          <LoadingState rows={5} />
        ) : rowsQuery.isError ? (
          <EmptyState
            icon={<AlertCircle className="h-10 w-10 text-muted-foreground/50" />}
            title="Failed to load deliveries"
            description={rowsQuery.error instanceof Error ? rowsQuery.error.message : 'Unknown error'}
            action={
              <Button onClick={() => rowsQuery.refetch()} variant="outline" size="sm">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            }
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={<MailCheck className="h-10 w-10 text-muted-foreground/50" />}
            title="No deliveries match your filters"
            description={hasActiveFilters ? 'Try widening your filters.' : 'The queue is empty — no deliveries have been recorded yet.'}
            action={
              hasActiveFilters ? (
                <Button onClick={clearFilters} variant="outline" size="sm" className="gap-1.5">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ScrollArea className="max-h-[calc(100vh-440px)] pr-3">
            <div className="space-y-2">
              {filteredRows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-md border bg-card hover:bg-muted/20 transition-colors p-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[11px]', statusTone(r.status))}>
                          {r.status}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] gap-1">
                          {CHANNEL_ICONS[r.channel]}
                          {CHANNEL_LABELS[r.channel]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          <RelativeTime date={r.createdAt} />
                        </span>
                      </div>
                      <div className="text-sm font-medium truncate">
                        {r.notification?.title ?? '(notification missing)'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {r.notification?.user && (
                          <span className="flex items-center gap-1.5">
                            <UserAvatar name={r.notification.user.name} color={r.notification.user.avatarColor} size="sm" />
                            {r.notification.user.name}
                          </span>
                        )}
                        <span className="font-mono text-[10px]">
                          {r.notification?.type ?? ''}
                        </span>
                      </div>
                      {r.error && (
                        <div className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded px-2 py-1 mt-1.5">
                          <span className="font-medium">Error: </span>
                          <span className="font-mono">{r.error}</span>
                        </div>
                      )}
                      {r.sentAt && (
                        <div className="text-[10px] text-muted-foreground">
                          Sent at {new Date(r.sentAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 md:items-end">
                      {r.status === 'FAILED' && r.notification && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryMut.mutate(r)}
                          disabled={retryMut.isPending}
                          className="gap-1.5"
                        >
                          {retryMut.isPending && retryMut.variables?.id === r.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SectionCard>
    </div>
  );
}
