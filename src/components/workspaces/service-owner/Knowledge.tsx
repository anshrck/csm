'use client';

/**
 * Service Owner — Knowledge view (Owned Services).
 *
 * Tabs: Published, Drafts, Review Queue, Known-Error Articles, Retired.
 * Article cards show: title, type badge, service, status badge, author,
 * reviewer, last updated, and linked ticket/problem counts (via entity links).
 *
 * Service Owner actions per card:
 *   - Review article → opens the article detail view.
 *   - Approve accuracy → POST /api/knowledge/[id]/publish (Service Owner is a
 *     publishing authority on services they own, alongside CM Leader).
 *   - Request changes → toast + INTERNAL_NOTE communication.
 *   - Retire stale article → POST /api/knowledge/[id]/retire.
 *   - Link article → EntityLinks shared component.
 *
 * Data: GET /api/knowledge (filtered client-side to owned service ids).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  RelativeTime,
  FormattedDate,
  Badge,
  Button,
} from '@/components/shared';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import EntityLinks from '@/components/workspaces/shared/EntityLinks';
import {
  KnowledgeTypeBadge,
  type KnowledgeArticleSummary,
} from '@/components/workspaces/shared/KnowledgeSearch';
import {
  BookOpen,
  CheckCircle2,
  Archive,
  Pencil,
  FileText,
  Send,
  Eye,
  Link2,
  AlertOctagon,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { useOwnerServices } from './_hooks';

interface ArticleDetail {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
  serviceId: string | null;
  serviceName: string | null;
  authorId: string;
  authorName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

interface LinkedCount {
  articleId: string;
  tickets: number;
  problems: number;
}

const STATUS_BADGE_CLS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  REVIEW: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  PUBLISHED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  RETIRED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  REVIEW: 'In Review',
  PUBLISHED: 'Published',
  RETIRED: 'Retired',
};

export default function Knowledge() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const servicesQ = useOwnerServices();
  const articlesQ = useQuery<KnowledgeArticleSummary[]>({
    queryKey: ['knowledge', 'manage', 'owner-all'],
    queryFn: () => apiGet<KnowledgeArticleSummary[]>('/api/knowledge?summary=1'),
    staleTime: 30_000,
  });

  const services = servicesQ.data ?? [];
  const allArticles = articlesQ.data ?? [];

  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);
  const serviceName = (id: string | null) =>
    id ? services.find((s) => s.id === id)?.name ?? 'Service' : 'No service';

  // Filter to owned services — Service Owner's editorial authority is scoped
  // to articles on services they own.
  const ownedArticles = useMemo(
    () => allArticles.filter((a) => a.serviceId && myServiceIds.has(a.serviceId)),
    [allArticles, myServiceIds],
  );

  // Linked counts (tickets + problems) per article via entity-links.
  // We batch this client-side; the entity-links API only does one entity at a
  // time, so we issue parallel requests for owned articles.
  const linkedCountsQ = useQuery<LinkedCount[]>({
    queryKey: ['knowledge', 'linked-counts', ownedArticles.map((a) => a.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        ownedArticles.map(async (a) => {
          try {
            const [fromLinks, toLinks] = await Promise.all([
              apiGet<{ toType: string }[]>(`/api/entity-links?fromType=KNOWLEDGE_ARTICLE&fromId=${a.id}`),
              apiGet<{ fromType: string }[]>(`/api/entity-links?toType=KNOWLEDGE_ARTICLE&toId=${a.id}`),
            ]);
            const all = [...fromLinks, ...toLinks];
            return {
              articleId: a.id,
              tickets: all.filter((l) => 'toType' in l ? l.toType === 'TICKET' : l.fromType === 'TICKET').length,
              problems: all.filter((l) => 'toType' in l ? l.toType === 'PROBLEM' : l.fromType === 'PROBLEM').length,
            };
          } catch {
            return { articleId: a.id, tickets: 0, problems: 0 };
          }
        }),
      );
      return results;
    },
    enabled: ownedArticles.length > 0,
    staleTime: 60_000,
  });

  const linkedCounts = linkedCountsQ.data ?? [];
  const linkedFor = (id: string) =>
    linkedCounts.find((l) => l.articleId === id) ?? { tickets: 0, problems: 0 };

  // ---- Tab buckets ----
  const buckets = useMemo(() => {
    const byStatus = (s: string) => ownedArticles.filter((a) => a.status === s);
    return {
      published: byStatus('PUBLISHED'),
      drafts: byStatus('DRAFT'),
      review: byStatus('REVIEW'),
      knownError: ownedArticles.filter((a) => a.type === 'KNOWN_ERROR'),
      retired: byStatus('RETIRED'),
    };
  }, [ownedArticles]);

  // ---- Mutations ----
  const publishMut = useMutation({
    mutationFn: (id: string) => apiPost(`/api/knowledge/${id}/publish`),
    onSuccess: (_data, id) => {
      toast.success('Article approved + published', {
        description: 'Article is now visible to customers and SCM workers.',
      });
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      // Record a KNOWLEDGE_APPROVAL governance decision so the audit trail
      // captures the Service Owner's explicit accuracy approval.
      const article = ownedArticles.find((a) => a.id === id);
      if (article?.serviceId) {
        apiPost('/api/governance-decisions', {
          serviceId: article.serviceId,
          decisionType: 'KNOWLEDGE_APPROVAL',
          decision: 'APPROVED',
          rationale: `Knowledge article "${article.title}" approved for accuracy and published.`,
        }).catch(() => {
          /* best-effort */
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retireMut = useMutation({
    mutationFn: (id: string) => apiPost(`/api/knowledge/${id}/retire`),
    onSuccess: () => {
      toast.success('Article retired');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Request-changes flow: opens a dialog and posts an INTERNAL_NOTE.
  const [changesTarget, setChangesTarget] = useState<KnowledgeArticleSummary | null>(null);
  const [changesNotes, setChangesNotes] = useState('');
  const requestChangesMut = useMutation({
    mutationFn: (args: { article: KnowledgeArticleSummary; notes: string }) =>
      apiPost('/api/communications', {
        serviceId: args.article.serviceId ?? undefined,
        direction: 'INTERNAL_NOTE',
        channel: 'PORTAL',
        subject: `Knowledge article changes requested: ${args.article.title}`,
        body: args.notes,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Change request sent to author', {
        description: `"${vars.article.title}" — internal note recorded.`,
      });
      qc.invalidateQueries({ queryKey: ['communications'] });
      setChangesTarget(null);
      setChangesNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Article detail sheet ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const [linkOpenId, setLinkOpenId] = useState<string | null>(null);
  const detailQ = useQuery<ArticleDetail>({
    queryKey: ['knowledge', 'detail', detailId],
    queryFn: () => apiGet<ArticleDetail>(`/api/knowledge/${detailId}`),
    enabled: !!detailId,
    staleTime: 30_000,
  });

  const loading = servicesQ.isLoading || articlesQ.isLoading;

  // ---- Render helpers ----
  function renderArticleCard(a: KnowledgeArticleSummary) {
    const counts = linkedFor(a.id);
    return (
      <div
        key={a.id}
        className="rounded-lg border p-4 hover:shadow-sm transition-shadow flex flex-col gap-2"
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setDetailId(a.id)}
            className="text-left min-w-0 flex-1"
          >
            <div className="flex items-center gap-2">
              <KnowledgeTypeBadge type={a.type} />
              <Badge
                variant="outline"
                className={cn('border font-medium text-[10px]', STATUS_BADGE_CLS[a.status])}
              >
                {STATUS_LABELS[a.status] ?? a.status}
              </Badge>
            </div>
            <h3 className="text-sm font-semibold mt-1.5 truncate hover:underline">{a.title}</h3>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.snippet}</p>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" /> {serviceName(a.serviceId)}
          </span>
          <span>·</span>
          <span>by {a.authorName}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> <RelativeTime date={a.updatedAt} />
          </span>
          {counts.tickets > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-700 dark:text-amber-300">{counts.tickets} linked tickets</span>
            </>
          )}
          {counts.problems > 0 && (
            <>
              <span>·</span>
              <span className="text-orange-700 dark:text-orange-300">{counts.problems} linked problems</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap pt-1 border-t">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setDetailId(a.id)}
          >
            <Eye className="h-3 w-3" /> Review
          </Button>
          {(a.status === 'REVIEW' || a.status === 'DRAFT') && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => publishMut.mutate(a.id)}
              disabled={publishMut.isPending}
            >
              <ShieldCheck className="h-3 w-3" /> Approve accuracy
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => {
              setChangesTarget(a);
              setChangesNotes('');
            }}
          >
            <Pencil className="h-3 w-3" /> Request changes
          </Button>
          {a.status === 'PUBLISHED' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
              onClick={() => {
                if (confirm(`Retire article "${a.title}"? It will no longer be visible to customers.`)) {
                  retireMut.mutate(a.id);
                }
              }}
              disabled={retireMut.isPending}
            >
              <Archive className="h-3 w-3" /> Retire
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setLinkOpenId(a.id)}
          >
            <Link2 className="h-3 w-3" /> Link
          </Button>
        </div>
      </div>
    );
  }

  function renderArticleGrid(list: KnowledgeArticleSummary[], emptyTitle: string, emptyDesc: string) {
    if (list.length === 0) {
      return (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title={emptyTitle}
          description={emptyDesc}
        />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map(renderArticleCard)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge — Owned Services"
        description="As Service Owner you hold editorial authority for knowledge articles on services you own. Approve accuracy before publication, request changes from authors, and retire stale articles so the customer-facing knowledge base stays current."
        icon={<BookOpen className="h-6 w-6" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Owned Articles" value={ownedArticles.length} hint="Across all states" />
        <StatCard label="Published" value={buckets.published.length} tone="success" />
        <StatCard label="Drafts" value={buckets.drafts.length} />
        <StatCard
          label="Awaiting Review"
          value={buckets.review.length}
          tone="warning"
          hint="Awaiting your accuracy approval"
        />
        <StatCard
          label="Known-Error Articles"
          value={buckets.knownError.length}
          tone="danger"
          hint="Customer-facing known errors"
        />
      </div>

      {loading ? (
        <LoadingState rows={6} />
      ) : ownedArticles.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<BookOpen className="h-8 w-8" />}
            title="No knowledge articles on your services yet"
            description="When SCM Workers or you create knowledge articles tied to your services, they will appear here for your editorial review."
          />
        </SectionCard>
      ) : (
        <Tabs defaultValue="published" className="w-full">
          <TabsList>
            <TabsTrigger value="published" className="text-xs">
              Published ({buckets.published.length})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="text-xs">
              Drafts ({buckets.drafts.length})
            </TabsTrigger>
            <TabsTrigger value="review" className="text-xs">
              Review Queue ({buckets.review.length})
            </TabsTrigger>
            <TabsTrigger value="known-error" className="text-xs">
              Known-Error Articles ({buckets.knownError.length})
            </TabsTrigger>
            <TabsTrigger value="retired" className="text-xs">
              Retired ({buckets.retired.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="published" className="mt-4">
            {renderArticleGrid(
              buckets.published,
              'No published articles',
              'Articles you approve will appear here, visible to customers and SCM workers.',
            )}
          </TabsContent>
          <TabsContent value="drafts" className="mt-4">
            {renderArticleGrid(
              buckets.drafts,
              'No drafts on your services',
              'Drafts created by SCM Workers (or by you) on your services appear here.',
            )}
          </TabsContent>
          <TabsContent value="review" className="mt-4">
            {renderArticleGrid(
              buckets.review,
              'Nothing in the review queue',
              'When an author submits a draft for review, it appears here for your accuracy approval.',
            )}
          </TabsContent>
          <TabsContent value="known-error" className="mt-4">
            {renderArticleGrid(
              buckets.knownError,
              'No known-error articles',
              'Known-error articles document workarounds for diagnosed problems on your services.',
            )}
          </TabsContent>
          <TabsContent value="retired" className="mt-4">
            {renderArticleGrid(
              buckets.retired,
              'No retired articles',
              'Retired articles are kept for historical reference but no longer shown to customers.',
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Request-changes dialog */}
      <Dialog open={!!changesTarget} onOpenChange={(o) => !o && setChangesTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              {changesTarget?.title} · {serviceName(changesTarget?.serviceId ?? null)}
              <br />
              Your note is recorded as an internal communication visible to the article author and SCM workers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="changes-notes" className="text-xs">Requested changes</Label>
            <Textarea
              id="changes-notes"
              value={changesNotes}
              onChange={(e) => setChangesNotes(e.target.value)}
              placeholder="Describe what should be updated, corrected, or expanded before this article can be approved."
              className="min-h-[120px] text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChangesTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (changesTarget && changesNotes.trim()) {
                  requestChangesMut.mutate({ article: changesTarget, notes: changesNotes });
                }
              }}
              disabled={requestChangesMut.isPending || !changesNotes.trim()}
            >
              <Send className="h-3.5 w-3.5 mr-1" /> Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Article detail sheet */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {detailQ.data && <KnowledgeTypeBadge type={detailQ.data.type} />}
              {detailQ.data?.title ?? 'Loading…'}
            </SheetTitle>
            <SheetDescription>
              {detailQ.data && (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline" className={cn('border text-[10px]', STATUS_BADGE_CLS[detailQ.data.status])}>
                    {STATUS_LABELS[detailQ.data.status] ?? detailQ.data.status}
                  </Badge>
                  <span>{serviceName(detailQ.data.serviceId)}</span>
                  <span>·</span>
                  <span>by {detailQ.data.authorName}</span>
                  {detailQ.data.reviewerName && (
                    <>
                      <span>·</span>
                      <span>reviewed by {detailQ.data.reviewerName}</span>
                    </>
                  )}
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {detailQ.isLoading ? (
              <LoadingState rows={6} />
            ) : detailQ.data ? (
              <>
                <div className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto scrollbar-thin">
                {detailQ.data.body || <span className="text-muted-foreground italic">No body content.</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Created <FormattedDate date={detailQ.data.createdAt} /></span>
                  <span>·</span>
                  <span>Updated <RelativeTime date={detailQ.data.updatedAt} /></span>
                  {detailQ.data.publishedAt && (
                    <>
                      <span>·</span>
                      <span>Published <FormattedDate date={detailQ.data.publishedAt} /></span>
                    </>
                  )}
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                    <Link2 className="h-3.5 w-3.5" /> Entity Links
                  </div>
                  <EntityLinks entityType="KNOWLEDGE_ARTICLE" entityId={detailQ.data.id} />
                </div>
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      publishMut.mutate(detailQ.data.id);
                    }}
                    disabled={publishMut.isPending || detailQ.data.status === 'PUBLISHED'}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Approve accuracy & publish
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setChangesTarget({
                        id: detailQ.data.id,
                        title: detailQ.data.title,
                        type: detailQ.data.type,
                        status: detailQ.data.status,
                        serviceId: detailQ.data.serviceId,
                        serviceName: detailQ.data.serviceName,
                        authorName: detailQ.data.authorName,
                        updatedAt: detailQ.data.updatedAt,
                        publishedAt: detailQ.data.publishedAt,
                        snippet: '',
                      });
                      setChangesNotes('');
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Request changes
                  </Button>
                  {detailQ.data.status === 'PUBLISHED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 dark:text-rose-400"
                      onClick={() => {
                        if (confirm('Retire this article?')) {
                          retireMut.mutate(detailQ.data.id);
                          setDetailId(null);
                        }
                      }}
                      disabled={retireMut.isPending}
                    >
                      <Archive className="h-3.5 w-3.5 mr-1" /> Retire
                    </Button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Entity-links sheet */}
      <Sheet open={!!linkOpenId} onOpenChange={(o) => !o && setLinkOpenId(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Link Article</SheetTitle>
            <SheetDescription>
              Relate this knowledge article to tickets, problems, demands, or changes so customers and SCM workers can find it from those entities.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {linkOpenId && <EntityLinks entityType="KNOWLEDGE_ARTICLE" entityId={linkOpenId} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
