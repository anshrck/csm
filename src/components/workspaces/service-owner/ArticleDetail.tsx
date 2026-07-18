'use client';

/**
 * Service Owner — Article Detail view.
 *
 * A simple, focused read-only view for a single knowledge article, reached
 * from the Known Errors and Knowledge views. Renders title, type, status,
 * service, author, reviewer, body markdown, version history button, and the
 * EntityLinks panel.
 *
 * The Service Owner's editorial actions (Approve accuracy, Request changes,
 * Retire) are surfaced inline.
 */

import * as React from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  RelativeTime,
  FormattedDate,
  Badge,
  Button,
} from '@/components/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import ReactMarkdown from 'react-markdown';
import EntityLinks from '@/components/workspaces/shared/EntityLinks';
import {
  KnowledgeTypeBadge,
} from '@/components/workspaces/shared/KnowledgeSearch';
import {
  ArrowLeft,
  ShieldCheck,
  Archive,
  Pencil,
  Send,
  BookOpen,
  History,
  Loader2,
} from 'lucide-react';

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

interface ArticleVersion {
  id: string;
  title: string;
  body: string;
  version: number;
  createdById: string;
  createdAt: string;
  current: boolean;
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

export default function ArticleDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const articleQ = useQuery<ArticleDetail>({
    queryKey: ['knowledge', 'detail', id],
    queryFn: () => apiGet<ArticleDetail>(`/api/knowledge/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });

  const publishMut = useMutation({
    mutationFn: () => apiPost(`/api/knowledge/${id}/publish`),
    onSuccess: () => {
      toast.success('Article approved + published');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      // Record a KNOWLEDGE_APPROVAL governance decision
      if (articleQ.data?.serviceId) {
        apiPost('/api/governance-decisions', {
          serviceId: articleQ.data.serviceId,
          decisionType: 'KNOWLEDGE_APPROVAL',
          decision: 'APPROVED',
          rationale: `Knowledge article "${articleQ.data.title}" approved for accuracy and published.`,
        }).catch(() => {});
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retireMut = useMutation({
    mutationFn: () => apiPost(`/api/knowledge/${id}/retire`),
    onSuccess: () => {
      toast.success('Article retired');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Request changes dialog ----
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesNotes, setChangesNotes] = useState('');
  const requestChangesMut = useMutation({
    mutationFn: (notes: string) =>
      apiPost('/api/communications', {
        serviceId: articleQ.data?.serviceId ?? undefined,
        direction: 'INTERNAL_NOTE',
        channel: 'PORTAL',
        subject: `Knowledge article changes requested: ${articleQ.data?.title ?? ''}`,
        body: notes,
      }),
    onSuccess: () => {
      toast.success('Change request sent to author');
      qc.invalidateQueries({ queryKey: ['communications'] });
      setChangesOpen(false);
      setChangesNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Version history drawer ----
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsQ = useQuery<ArticleVersion[]>({
    queryKey: ['knowledge', 'versions', id],
    queryFn: () => apiGet<ArticleVersion[]>(`/api/knowledge/${id}/versions`),
    enabled: !!id && versionsOpen,
    staleTime: 30_000,
  });

  const restoreMut = useMutation({
    mutationFn: (versionId: string) =>
      apiPost(`/api/knowledge/${id}/versions`, { sourceVersionId: versionId }),
    onSuccess: () => {
      toast.success('Version restored');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      setVersionsOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!id) {
    return (
      <EmptyState
        icon={<BookOpen className="h-8 w-8" />}
        title="No article selected"
        description="Use the back button to return to the knowledge base."
      />
    );
  }

  if (articleQ.isLoading) return <LoadingState rows={6} />;
  if (articleQ.isError || !articleQ.data) {
    return (
      <EmptyState
        icon={<BookOpen className="h-8 w-8" />}
        title="Article not found"
        description="The article you are looking for may have been retired or deleted."
        action={
          <Button variant="outline" onClick={() => navigate('knowledge')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Knowledge
          </Button>
        }
      />
    );
  }

  const a = articleQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${a.serviceName ?? 'No service'} · by ${a.authorName}${a.reviewerName ? ` · reviewed by ${a.reviewerName}` : ''}`}
        icon={<BookOpen className="h-6 w-6" />}
        actions={
          <>
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('knowledge')}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setVersionsOpen(true)}>
              <History className="h-3.5 w-3.5" /> Versions
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <KnowledgeTypeBadge type={a.type} />
        <Badge variant="outline" className={cn('border font-medium', STATUS_BADGE_CLS[a.status])}>
          {STATUS_LABELS[a.status] ?? a.status}
        </Badge>
        {a.serviceName && (
          <Badge variant="outline" className="text-xs">
            {a.serviceName}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          Updated <RelativeTime date={a.updatedAt} />
        </span>
        {a.publishedAt && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              Published <FormattedDate date={a.publishedAt} />
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(a.status === 'REVIEW' || a.status === 'DRAFT') && (
          <Button
            size="sm"
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
            className="gap-1"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Approve accuracy & publish
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => setChangesOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" /> Request changes
        </Button>
        {a.status === 'PUBLISHED' && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-rose-600 dark:text-rose-400"
            onClick={() => {
              if (confirm('Retire this article? It will no longer be visible to customers.')) {
                retireMut.mutate();
              }
            }}
            disabled={retireMut.isPending}
          >
            <Archive className="h-3.5 w-3.5" /> Retire
          </Button>
        )}
      </div>

      <SectionCard title="Article body" description="Markdown rendered.">
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-muted/20 p-4">
          <ReactMarkdown>{a.body || '*No body content.*'}</ReactMarkdown>
        </div>
      </SectionCard>

      <SectionCard title="Entity Links" description="Tickets, problems, demands, or changes related to this article.">
        <EntityLinks entityType="KNOWLEDGE_ARTICLE" entityId={a.id} />
      </SectionCard>

      {/* Request-changes dialog */}
      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              {a.title}
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
            <Button variant="ghost" onClick={() => setChangesOpen(false)}>Cancel</Button>
            <Button
              onClick={() => changesNotes.trim() && requestChangesMut.mutate(changesNotes)}
              disabled={requestChangesMut.isPending || !changesNotes.trim()}
            >
              <Send className="h-3.5 w-3.5 mr-1" /> Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history drawer */}
      <Sheet open={versionsOpen} onOpenChange={setVersionsOpen}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
            <SheetDescription>
              Each saved edit creates a version snapshot. Restore a previous version to roll back content.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {versionsQ.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading versions…
              </div>
            ) : (versionsQ.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No version history recorded yet.</p>
            ) : (
              (versionsQ.data ?? []).map((v) => (
                <div key={v.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono">v{v.version}</Badge>
                      {v.current && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">
                          Live
                        </Badge>
                      )}
                    </div>
                    <RelativeTime date={v.createdAt} className="text-[11px]" />
                  </div>
                  <div className="text-xs font-medium mt-1.5">{v.title}</div>
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">
                    {v.body.slice(0, 200)}
                    {v.body.length > 200 ? '…' : ''}
                  </p>
                  {!v.current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 h-7 text-xs gap-1"
                      onClick={() => {
                        if (confirm(`Restore version ${v.version}? This will create a new version with the previous content.`)) {
                          restoreMut.mutate(v.id);
                        }
                      }}
                      disabled={restoreMut.isPending}
                    >
                      <History className="h-3 w-3" /> Restore
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
