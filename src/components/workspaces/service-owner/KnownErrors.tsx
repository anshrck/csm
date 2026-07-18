'use client';

/**
 * Service Owner — Known Errors view.
 *
 * A Known Error is a problem that has been diagnosed and has a documented
 * workaround (or a deliberate "no workaround" decision). For each owned
 * service the Service Owner:
 *   - Reviews the workaround (refresh notes, mark reviewed).
 *   - Approves customer visibility (POST a KNOWLEDGE_APPROVAL governance
 *     decision so the audit trail reflects explicit owner sign-off).
 *   - Requests a better workaround from the PM worker (toast + audit comment
 *     via /api/communications as an INTERNAL_NOTE).
 *   - Links the error to a knowledge article (navigate to Knowledge view).
 *   - Directs a permanent fix (navigate to the demand pipeline).
 *   - Retires the known error (PATCH the problem status → CLOSED).
 *
 * Data: problems with status KNOWN_ERROR on owned services, joined with
 * knowledge articles of type KNOWN_ERROR for the same services.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Problem } from '@/lib/types';
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
import {
  BookOpen,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Wrench,
  ArrowRight,
  Archive,
  Eye,
  EyeOff,
  MessageSquare,
  Bug,
  AlertTriangle,
} from 'lucide-react';
import { useOwnerServices, useOwnerProblems } from './_hooks';

interface KnowledgeArticleSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  serviceId: string | null;
  serviceName: string | null;
  authorName: string;
  updatedAt: string;
  publishedAt: string | null;
  snippet: string;
}

interface KnownErrorRow {
  id: string;
  kind: 'problem' | 'article';
  title: string;
  serviceId: string;
  serviceName: string;
  hasWorkaround: boolean;
  workaroundPreview: string | null;
  linkedProblemId: string | null;
  linkedArticleId: string | null;
  customerVisible: boolean;
  lastReviewedAt: string | null;
  openAffectedTickets: number;
  permanentFixChangeId: string | null;
  status: string;
  updatedAt: string;
}

const STALE_DAYS = 90;

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  const d = new Date(iso).getTime();
  return Date.now() - d > STALE_DAYS * 86400000;
}

export default function KnownErrors() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();
  const problemsQ = useOwnerProblems();

  // Knowledge articles of type KNOWN_ERROR (filter client-side to owned services)
  const articlesQ = useQuery<KnowledgeArticleSummary[]>({
    queryKey: ['knowledge', 'known-error', 'owner'],
    queryFn: () => apiGet<KnowledgeArticleSummary[]>('/api/knowledge?type=KNOWN_ERROR&summary=1'),
    staleTime: 30_000,
  });

  // Tickets on owned services — used to compute "open affected tickets" per problem.
  // We fetch the open ticket count per service to attribute impact.
  const ticketsQ = useQuery<{ serviceId: string; count: number }[]>({
    queryKey: ['tickets', 'owned-open-counts'],
    queryFn: async () => {
      const tickets = await apiGet<
        { id: string; serviceId: string; status: string }[]
      >('/api/tickets?status=NEW,TRIAGED,ASSIGNED,IN_PROGRESS,WAITING_CUSTOMER');
      const byService = new Map<string, number>();
      for (const t of tickets) {
        byService.set(t.serviceId, (byService.get(t.serviceId) ?? 0) + 1);
      }
      return Array.from(byService.entries()).map(([serviceId, count]) => ({
        serviceId,
        count,
      }));
    },
    staleTime: 30_000,
  });

  // Changes that touch owned services — used to detect "permanent fix linked".
  const changesQ = useQuery<{ id: string; title: string; affectedServiceIds: string[]; originProblemId: string | null }[]>({
    queryKey: ['changes', 'known-error-linkage'],
    queryFn: async () => {
      const all = await apiGet<
        { id: string; title: string; affectedServiceIds: string; originProblemId: string | null }[]
      >('/api/changes');
      return all.map((c) => ({
        id: c.id,
        title: c.title,
        affectedServiceIds: safeParseArray(c.affectedServiceIds),
        originProblemId: c.originProblemId,
      }));
    },
    staleTime: 30_000,
  });

  const services = servicesQ.data ?? [];
  const problems = problemsQ.data ?? [];
  const articles = articlesQ.data ?? [];
  const ticketCounts = ticketsQ.data ?? [];
  const changes = changesQ.data ?? [];

  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);

  // Build unified rows from problems + articles.
  const rows: KnownErrorRow[] = useMemo(() => {
    const out: KnownErrorRow[] = [];
    const seenArticleIds = new Set<string>();

    // Inline helper closures — keep them inside the memo so the React
    // compiler can verify dependencies.
    const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Service';
    const ticketCountFor = (serviceId: string) =>
      ticketCounts.find((t) => t.serviceId === serviceId)?.count ?? 0;
    const changeForProblem = (problemId: string) =>
      changes.find((c) => c.originProblemId === problemId) ?? null;

    // Problems with KNOWN_ERROR status on owned services
    for (const p of problems) {
      if (p.status !== 'KNOWN_ERROR') continue;
      if (!myServiceIds.has(p.serviceId)) continue;
      const article = articles.find(
        (a) =>
          a.serviceId === p.serviceId &&
          a.type === 'KNOWN_ERROR' &&
          (a.title.toLowerCase().includes(p.title.toLowerCase().slice(0, 20)) ||
            p.knownErrorId === a.id),
      );
      if (article) seenArticleIds.add(article.id);
      const change = changeForProblem(p.id);
      out.push({
        id: `p:${p.id}`,
        kind: 'problem',
        title: p.title,
        serviceId: p.serviceId,
        serviceName: p.serviceName ?? svcName(p.serviceId),
        hasWorkaround: Boolean(p.workaroundDescription),
        workaroundPreview: p.workaroundDescription,
        linkedProblemId: p.id,
        linkedArticleId: article?.id ?? null,
        // Customer-visible when a published KNOWN_ERROR article exists.
        customerVisible: article?.status === 'PUBLISHED',
        lastReviewedAt: p.updatedAt,
        openAffectedTickets: ticketCountFor(p.serviceId),
        permanentFixChangeId: change?.id ?? null,
        status: p.status,
        updatedAt: p.updatedAt,
      });
    }

    // Standalone KNOWN_ERROR articles (no matching problem row) on owned services
    for (const a of articles) {
      if (seenArticleIds.has(a.id)) continue;
      if (!a.serviceId || !myServiceIds.has(a.serviceId)) continue;
      out.push({
        id: `a:${a.id}`,
        kind: 'article',
        title: a.title,
        serviceId: a.serviceId,
        serviceName: a.serviceName ?? svcName(a.serviceId),
        hasWorkaround: true, // KNOWN_ERROR articles always carry a workaround
        workaroundPreview: a.snippet,
        linkedProblemId: null,
        linkedArticleId: a.id,
        customerVisible: a.status === 'PUBLISHED',
        lastReviewedAt: a.updatedAt,
        openAffectedTickets: ticketCountFor(a.serviceId),
        permanentFixChangeId: null,
        status: a.status,
        updatedAt: a.updatedAt,
      });
    }

    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [problems, articles, myServiceIds, services, ticketCounts, changes]);

  // ---- Filters ----
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [workaroundFilter, setWorkaroundFilter] = useState<string>('ALL');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('ALL');
  const [linkedFilter, setLinkedFilter] = useState<string>('ALL');
  const [staleFilter, setStaleFilter] = useState<string>('ALL');

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (serviceFilter !== 'ALL' && r.serviceId !== serviceFilter) return false;
      if (workaroundFilter === 'HAS' && !r.hasWorkaround) return false;
      if (workaroundFilter === 'NO' && r.hasWorkaround) return false;
      if (visibilityFilter === 'VISIBLE' && !r.customerVisible) return false;
      if (visibilityFilter === 'INTERNAL' && r.customerVisible) return false;
      if (linkedFilter === 'PROBLEM' && !r.linkedProblemId) return false;
      if (linkedFilter === 'ARTICLE' && !r.linkedArticleId) return false;
      if (linkedFilter === 'NONE' && (r.linkedProblemId || r.linkedArticleId)) return false;
      if (staleFilter === 'STALE' && !isStale(r.lastReviewedAt)) return false;
      if (staleFilter === 'CURRENT' && isStale(r.lastReviewedAt)) return false;
      return true;
    });
  }, [rows, serviceFilter, workaroundFilter, visibilityFilter, linkedFilter, staleFilter]);

  // ---- Summary tiles ----
  const summary = useMemo(() => {
    const total = rows.length;
    const noWorkaround = rows.filter((r) => !r.hasWorkaround).length;
    const customerVisible = rows.filter((r) => r.customerVisible).length;
    const stale = rows.filter((r) => isStale(r.lastReviewedAt)).length;
    const withPermanentFix = rows.filter((r) => r.permanentFixChangeId).length;
    return { total, noWorkaround, customerVisible, stale, withPermanentFix };
  }, [rows]);

  // ---- Mutations ----
  const [reviewTarget, setReviewTarget] = useState<KnownErrorRow | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const reviewMutation = useMutation({
    mutationFn: (args: { row: KnownErrorRow; notes: string }) => {
      if (!args.row.linkedProblemId) {
        // Article-only known error — there's no problem row to PATCH.
        // Record an internal communication as the audit trail.
        return apiPost('/api/communications', {
          serviceId: args.row.serviceId,
          direction: 'INTERNAL_NOTE',
          channel: 'PORTAL',
          subject: `Known-error workaround reviewed: ${args.row.title}`,
          body: args.notes || 'Workaround reviewed by Service Owner — still valid.',
        });
      }
      return apiPatch(`/api/problems/${args.row.linkedProblemId}`, {
        workaroundDescription: args.notes || undefined,
        decisionRationale: args.notes
          ? `Workaround reviewed by Service Owner: ${args.notes}`
          : 'Workaround reviewed by Service Owner — still valid.',
      });
    },
    onSuccess: (_data, vars) => {
      toast.success('Workaround reviewed', {
        description: `Known error "${vars.row.title}" marked reviewed.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-problems'] });
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      setReviewTarget(null);
      setReviewNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveVisibilityMutation = useMutation({
    mutationFn: (row: KnownErrorRow) =>
      apiPost('/api/governance-decisions', {
        serviceId: row.serviceId,
        problemId: row.linkedProblemId ?? undefined,
        decisionType: 'KNOWLEDGE_APPROVAL',
        decision: 'APPROVED',
        rationale: `Customer visibility approved for known error: ${row.title}`,
      }),
    onSuccess: (_data, row) => {
      toast.success('Customer visibility approved', {
        description: `Governance decision recorded for "${row.title}".`,
      });
      qc.invalidateQueries({ queryKey: ['governance-decisions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestBetterWorkaroundMutation = useMutation({
    mutationFn: (row: KnownErrorRow) =>
      apiPost('/api/communications', {
        serviceId: row.serviceId,
        direction: 'INTERNAL_NOTE',
        channel: 'PORTAL',
        subject: `Better workaround requested: ${row.title}`,
        body: `Service Owner requests an improved workaround for known error "${row.title}". Current workaround: ${
          row.workaroundPreview ? 'see existing notes' : 'none documented'
        }. Please coordinate with the PM worker.`,
      }),
    onSuccess: (_data, row) => {
      toast.success('Better workaround requested', {
        description: `Internal note recorded for "${row.title}".`,
      });
      qc.invalidateQueries({ queryKey: ['communications'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retireMutation = useMutation({
    mutationFn: (row: KnownErrorRow) => {
      if (!row.linkedProblemId) {
        // Article-only: retire the article instead.
        return apiPost(`/api/knowledge/${row.linkedArticleId}/retire`);
      }
      return apiPatch(`/api/problems/${row.linkedProblemId}`, {
        status: 'CLOSED',
        decisionRationale: 'Known error retired by Service Owner.',
      });
    },
    onSuccess: (_data, row) => {
      toast.success('Known error retired', {
        description: `"${row.title}" is no longer tracked as an active known error.`,
      });
      qc.invalidateQueries({ queryKey: ['owner-problems'] });
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading =
    servicesQ.isLoading || problemsQ.isLoading || articlesQ.isLoading;

  // ---- Columns ----
  const columns: Column<KnownErrorRow>[] = [
    {
      key: 'title',
      header: 'Known Error',
      render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-medium truncate">{r.title}</span>
          </div>
          {r.workaroundPreview && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {r.workaroundPreview}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            {r.kind === 'article' && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900">
                Article
              </Badge>
            )}
            {r.kind === 'problem' && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900">
                Problem
              </Badge>
            )}
            {isStale(r.lastReviewedAt) && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900">
                Stale review
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'service',
      header: 'Service',
      render: (r) => <span className="text-xs">{r.serviceName}</span>,
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
    },
    {
      key: 'workaround',
      header: 'Workaround',
      render: (r) =>
        r.hasWorkaround ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">
            <Wrench className="h-3 w-3 mr-1" /> Has workaround
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900">
            No workaround
          </Badge>
        ),
    },
    {
      key: 'visibility',
      header: 'Customer Visibility',
      render: (r) =>
        r.customerVisible ? (
          <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900">
            <Eye className="h-3 w-3 mr-1" /> Visible
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
            <EyeOff className="h-3 w-3 mr-1" /> Internal
          </Badge>
        ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'lastReviewed',
      header: 'Last Reviewed',
      render: (r) =>
        r.lastReviewedAt ? (
          <div className="flex flex-col">
            <RelativeTime date={r.lastReviewedAt} className="text-xs" />
            {isStale(r.lastReviewedAt) && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">stale</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'affectedTickets',
      header: 'Open Tickets',
      render: (r) => (
        <span className="text-xs tabular-nums">
          {r.openAffectedTickets > 0 ? (
            <span className="font-semibold text-amber-700 dark:text-amber-300">{r.openAffectedTickets}</span>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </span>
      ),
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell',
    },
    {
      key: 'permanentFix',
      header: 'Perm. Fix',
      render: (r) =>
        r.permanentFixChangeId ? (
          <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900">
            Linked
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell',
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setReviewTarget(r);
              setReviewNotes('');
            }}
          >
            <RefreshCw className="h-3 w-3" /> Review
          </Button>
          {!r.customerVisible && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                approveVisibilityMutation.mutate(r);
              }}
              disabled={approveVisibilityMutation.isPending}
            >
              <ShieldCheck className="h-3 w-3" /> Approve visibility
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              requestBetterWorkaroundMutation.mutate(r);
            }}
            disabled={requestBetterWorkaroundMutation.isPending}
          >
            <MessageSquare className="h-3 w-3" /> Request better
          </Button>
          {r.linkedArticleId ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                navigate('article-detail', { id: r.linkedArticleId! });
              }}
            >
              <BookOpen className="h-3 w-3" /> Article
            </Button>
          ) : null}
          {r.permanentFixChangeId ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                navigate('changes');
              }}
            >
              <ArrowRight className="h-3 w-3" /> Fix
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                navigate('submit-demand');
              }}
            >
              <ArrowRight className="h-3 w-3" /> Demand fix
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Retire known error "${r.title}"?`)) {
                retireMutation.mutate(r);
              }
            }}
            disabled={retireMutation.isPending}
          >
            <Archive className="h-3 w-3" /> Retire
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Known Errors"
        description="Known errors on your services. Each entry needs an active workaround, an explicit customer-visibility decision, and a path to a permanent fix. A stale review means it has been more than 90 days since the workaround was last reviewed."
        icon={<Bug className="h-6 w-6" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total Known Errors" value={summary.total} hint="Across owned services" />
        <StatCard
          label="No Workaround"
          value={summary.noWorkaround}
          tone="danger"
          hint="Requires immediate PM action"
        />
        <StatCard
          label="Customer Visible"
          value={summary.customerVisible}
          tone="success"
          hint="Published to customer portal"
        />
        <StatCard
          label="Stale Review"
          value={summary.stale}
          tone="warning"
          hint=">90 days since review"
        />
        <StatCard
          label="Permanent Fix Linked"
          value={summary.withPermanentFix}
          tone="success"
          hint="Change in progress"
        />
      </div>

      <SectionCard
        title="Known Errors — Owned Services"
        description="Filter and act on known errors. The Review button updates the workaround notes; Approve visibility records a KNOWLEDGE_APPROVAL governance decision so customer visibility is explicitly authorised by you as Service Owner."
      >
        {/* Filters */}
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

          <Select value={workaroundFilter} onValueChange={setWorkaroundFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Workaround" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any workaround</SelectItem>
              <SelectItem value="HAS">Has workaround</SelectItem>
              <SelectItem value="NO">No workaround</SelectItem>
            </SelectContent>
          </Select>

          <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any visibility</SelectItem>
              <SelectItem value="VISIBLE">Customer visible</SelectItem>
              <SelectItem value="INTERNAL">Internal only</SelectItem>
            </SelectContent>
          </Select>

          <Select value={linkedFilter} onValueChange={setLinkedFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Linked entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any linkage</SelectItem>
              <SelectItem value="PROBLEM">Linked to problem</SelectItem>
              <SelectItem value="ARTICLE">Linked to article</SelectItem>
              <SelectItem value="NONE">No linkage</SelectItem>
            </SelectContent>
          </Select>

          <Select value={staleFilter} onValueChange={setStaleFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Review status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any review</SelectItem>
              <SelectItem value="STALE">Stale review</SelectItem>
              <SelectItem value="CURRENT">Current review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <LoadingState rows={4} />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-8 w-8" />}
            title="No known errors match the filter"
            description="Either your services have no open known errors, or all entries match the filter combination you have selected."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredRows}
            onRowClick={(r) => {
              if (r.linkedArticleId) {
                navigate('article-detail', { id: r.linkedArticleId });
              } else if (r.linkedProblemId) {
                navigate('problems');
              }
            }}
          />
        )}
      </SectionCard>

      {/* Review Workaround Dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Workaround</DialogTitle>
            <DialogDescription>
              {reviewTarget?.title} · {reviewTarget?.serviceName}
              <br />
              Confirm the workaround is still valid, or update the notes. The review is logged
              with your name and timestamp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Current workaround</Label>
              <div className="mt-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto scrollbar-thin">
                {reviewTarget?.workaroundPreview ?? (
                  <span className="italic">No workaround documented — please describe one.</span>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="review-notes" className="text-xs">Review notes / updated workaround</Label>
              <Textarea
                id="review-notes"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Confirm the workaround is valid, or document an updated procedure. Leave blank to mark reviewed without changes."
                className="mt-1 min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (reviewTarget) {
                  reviewMutation.mutate({ row: reviewTarget, notes: reviewNotes });
                }
              }}
              disabled={reviewMutation.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark reviewed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function safeParseArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
