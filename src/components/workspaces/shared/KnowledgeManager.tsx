'use client';

/**
 * KnowledgeManager — full CRUD knowledge base UI for SCM_WORKER, CM_LEADER,
 * and SERVICE_OWNER roles.
 *
 * Capabilities per role:
 *   - SCM_WORKER  → create DRAFT, edit own DRAFT/REVIEW articles, submit for review.
 *   - CM_LEADER   → all of the above + edit any DRAFT/REVIEW article, PUBLISH / RETIRE.
 *   - SERVICE_OWNER → same as CM_LEADER + initial filter to articles on owned services
 *     (the user can still clear the filter to see all).
 *
 * Layout:
 *   - Top: stat row (total, drafts, in-review, published, retired) + [New Article] button.
 *   - Filter bar: free-text search, type filter, status filter, optional "my services only".
 *   - List: DataTable of articles with type/status badges, author, last updated, and an
 *     actions dropdown (Edit / Submit for review / Publish / Retire).
 *   - Dialogs: New/Edit article (title, type, service, markdown body), View article (full
 *     markdown render), and confirmation flows for the lifecycle transitions.
 */

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
  type Column,
  Badge,
  Button,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookOpen,
  Plus,
  MoreHorizontal,
  Pencil,
  Send,
  CheckCircle2,
  Archive,
  Eye,
  FileText,
  HelpCircle,
  AlertOctagon,
  Wrench,
  Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  KnowledgeSearch,
  KnowledgeTypeBadge,
  KNOWLEDGE_TYPE_META,
  type KnowledgeArticleSummary,
} from './KnowledgeSearch';

// ---- Types ----
// Reuse the summary shape from the search component for the management list,
// plus the full article (with body) fetched when editing/viewing.
interface KnowledgeArticleFull extends KnowledgeArticleSummary {
  body: string;
  reviewerId: string | null;
  reviewerName: string | null;
  authorId: string;
  createdAt: string;
}

interface ServiceOption {
  id: string;
  name: string;
}

type ManagerRole = 'SCM_WORKER' | 'CM_LEADER' | 'SERVICE_OWNER';

// ---- Component ----
export interface KnowledgeManagerProps {
  role: ManagerRole;
  /** When true (Service Owner), default the filter to articles on owned services. */
  defaultFilterOwnedServices?: boolean;
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

export function KnowledgeManager({ role, defaultFilterOwnedServices = false }: KnowledgeManagerProps) {
  const { session } = useApp();
  const qc = useQueryClient();

  // ---- Filters ----
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<string>('ALL');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [ownedOnly, setOwnedOnly] = React.useState<boolean>(!!defaultFilterOwnedServices);

  // ---- Article list ----
  // Always fetch with `summary=1` — the management list doesn't need the full
  // markdown body. We refetch the full article when the user opens the editor
  // or viewer dialog.
  const listParams = new URLSearchParams({ summary: '1' });
  if (search.trim()) listParams.set('q', search.trim());
  if (typeFilter !== 'ALL') listParams.set('type', typeFilter);
  if (statusFilter !== 'ALL') listParams.set('status', statusFilter);

  // Service Owner "owned services" filter — we need the list of owned service
  // ids first, then pass one to the API. Since the API only accepts a single
  // serviceId, we fetch all and filter client-side (the article count is small
  // enough that this is fine).
  const { data: ownedServices = [] } = useQuery<ServiceOption[]>({
    queryKey: ['services', 'owned', session?.id],
    queryFn: () => apiGet('/api/services?owner=me'),
    enabled: role === 'SERVICE_OWNER' && ownedOnly,
  });
  const ownedServiceIds = React.useMemo(() => new Set(ownedServices.map((s) => s.id)), [ownedServices]);

  const { data: articles = [], isLoading } = useQuery<KnowledgeArticleSummary[]>({
    queryKey: ['knowledge', 'manage', search, typeFilter, statusFilter, ownedOnly, session?.id],
    queryFn: () => apiGet(`/api/knowledge?${listParams.toString()}`),
  });

  // Apply the owned-services filter client-side if needed.
  const filteredArticles = React.useMemo(() => {
    if (role !== 'SERVICE_OWNER' || !ownedOnly || ownedServiceIds.size === 0) return articles;
    return articles.filter((a) => a.serviceId && ownedServiceIds.has(a.serviceId));
  }, [articles, role, ownedOnly, ownedServiceIds]);

  // ---- Services dropdown options (for the article editor) ----
  const { data: allServices = [] } = useQuery<ServiceOption[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  // ---- Editor / viewer dialog state ----
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [viewingId, setViewingId] = React.useState<string | null>(null);

  // ---- Stats ----
  const stats = React.useMemo(() => {
    const byStatus: Record<string, number> = { DRAFT: 0, REVIEW: 0, PUBLISHED: 0, RETIRED: 0 };
    for (const a of filteredArticles) {
      if (byStatus[a.status] !== undefined) byStatus[a.status]++;
    }
    return {
      total: filteredArticles.length,
      drafts: byStatus.DRAFT,
      review: byStatus.REVIEW,
      published: byStatus.PUBLISHED,
      retired: byStatus.RETIRED,
    };
  }, [filteredArticles]);

  // ---- Mutations ----
  // The mutations below call the dedicated lifecycle endpoints (submit-review,
  // publish, retire) rather than poking status via PATCH. This keeps the audit
  // trail clean and routes every transition through its proper gate.
  const submitReview = useMutation({
    mutationFn: (id: string) => apiPost(`/api/knowledge/${id}/submit-review`),
    onSuccess: () => {
      toast.success('Article submitted for review');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to submit'),
  });

  const publish = useMutation({
    mutationFn: (id: string) => apiPost(`/api/knowledge/${id}/publish`),
    onSuccess: () => {
      toast.success('Article published');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to publish'),
  });

  const retire = useMutation({
    mutationFn: (id: string) => apiPost(`/api/knowledge/${id}/retire`),
    onSuccess: () => {
      toast.success('Article retired');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to retire'),
  });

  // ---- Row actions visibility ----
  // Returns the set of lifecycle actions available for a given article + caller.
  function actionsFor(a: KnowledgeArticleSummary) {
    const isAuthor = a.authorName === session?.name; // best-effort match by name; API enforces authorId
    const canEdit = role === 'CM_LEADER' || role === 'SERVICE_OWNER' || isAuthor;
    const canSubmit = canEdit && (a.status === 'DRAFT' || a.status === 'REVIEW');
    const canPublish = (role === 'CM_LEADER' || role === 'SERVICE_OWNER') && a.status === 'REVIEW';
    const canRetire = (role === 'CM_LEADER' || role === 'SERVICE_OWNER') && a.status === 'PUBLISHED';
    return { canEdit, canSubmit, canPublish, canRetire };
  }

  // ---- Table columns ----
  const columns: Column<KnowledgeArticleSummary>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (a) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KnowledgeTypeBadge type={a.type} />
            <button
              type="button"
              onClick={() => setViewingId(a.id)}
              className="text-sm font-medium hover:underline truncate text-left"
            >
              {a.title}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.snippet}</p>
        </div>
      ),
    },
    {
      key: 'service',
      header: 'Service',
      render: (a) => (a.serviceName ? <span className="text-xs">{a.serviceName}</span> : <span className="text-xs text-muted-foreground">—</span>),
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
    },
    {
      key: 'author',
      header: 'Author',
      render: (a) => <span className="text-xs">{a.authorName}</span>,
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => (
        <Badge variant="outline" className={cn('border font-medium', STATUS_BADGE_CLS[a.status])}>
          {STATUS_LABELS[a.status] ?? a.status}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (a) => <span className="text-xs text-muted-foreground tabular-nums">{new Date(a.updatedAt).toLocaleDateString()}</span>,
      headerClassName: 'hidden sm:table-cell',
      className: 'hidden sm:table-cell',
    },
    {
      key: 'actions',
      header: '',
      render: (a) => {
        const actions = actionsFor(a);
        if (!actions.canEdit && !actions.canSubmit && !actions.canPublish && !actions.canRetire) {
          return (
            <Button variant="ghost" size="sm" onClick={() => setViewingId(a.id)}>
              <Eye className="h-3.5 w-3.5 mr-1" /> View
            </Button>
          );
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setViewingId(a.id)}>
                <Eye className="h-3.5 w-3.5 mr-2" /> View
              </DropdownMenuItem>
              {actions.canEdit && (a.status === 'DRAFT' || a.status === 'REVIEW') && (
                <DropdownMenuItem
                  onClick={() => {
                    setEditingId(a.id);
                    setEditorOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                </DropdownMenuItem>
              )}
              {actions.canSubmit && (
                <DropdownMenuItem
                  onClick={() => submitReview.mutate(a.id)}
                  disabled={submitReview.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-2" /> Submit for review
                </DropdownMenuItem>
              )}
              {actions.canPublish && (
                <DropdownMenuItem
                  onClick={() => publish.mutate(a.id)}
                  disabled={publish.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Publish
                </DropdownMenuItem>
              )}
              {actions.canRetire && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => retire.mutate(a.id)}
                    disabled={retire.isPending}
                    className="text-rose-600 focus:text-rose-700"
                  >
                    <Archive className="h-3.5 w-3.5 mr-2" /> Retire
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Knowledge Base"
        description={
          role === 'SERVICE_OWNER'
            ? 'Curate how-to guides, known errors, FAQs, and runbooks for the services you own. Service Owners hold the publish/retire gate alongside the CM Leader.'
            : 'Author and curate how-to guides, known errors, FAQs, and runbooks. Articles flow DRAFT → REVIEW → PUBLISHED → RETIRED through dedicated governance gates.'
        }
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> New Article
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats.total} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Drafts" value={stats.drafts} icon={<Pencil className="h-4 w-4" />} />
        <StatCard label="In Review" value={stats.review} icon={<Send className="h-4 w-4" />} />
        <StatCard label="Published" value={stats.published} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <StatCard label="Retired" value={stats.retired} icon={<Archive className="h-4 w-4" />} />
      </div>

      {/* Customer-facing search embedded — lets the SCM/CM preview the customer view */}
      <SectionCard
        title="Customer view preview"
        description="What your customers see when they search the published knowledge base."
      >
        <KnowledgeSearch
          placeholder="Preview the customer search experience…"
          emptyLabel="No published articles yet."
        />
      </SectionCard>

      {/* Management list */}
      <SectionCard
        title="All articles"
        description="Manage drafts, articles in review, published articles, and retired articles."
      >
        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Input
            type="search"
            placeholder="Search by title or body…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              <SelectItem value="HOW_TO">How To</SelectItem>
              <SelectItem value="KNOWN_ERROR">Known Error</SelectItem>
              <SelectItem value="FAQ">FAQ</SelectItem>
              <SelectItem value="RUNBOOK">Runbook</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="REVIEW">In Review</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="RETIRED">Retired</SelectItem>
            </SelectContent>
          </Select>
          {role === 'SERVICE_OWNER' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={ownedOnly}
                onChange={(e) => setOwnedOnly(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              My services only
            </label>
          )}
        </div>

        {isLoading ? (
          <LoadingState rows={5} />
        ) : filteredArticles.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-8 w-8" />}
            title="No articles"
            description="Create your first knowledge article with the New Article button."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredArticles}
            empty={<EmptyState title="No articles match your filters." />}
          />
        )}
      </SectionCard>

      {/* Editor dialog */}
      <ArticleEditorDialog
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditingId(null);
        }}
        articleId={editingId}
        services={allServices}
        canSelectService={true}
      />

      {/* Viewer dialog (read-only markdown render) */}
      <ArticleViewerDialog articleId={viewingId} onOpenChange={(o) => !o && setViewingId(null)} />
    </div>
  );
}

// ---- Article editor dialog (create + edit) ----
function ArticleEditorDialog({
  open,
  onOpenChange,
  articleId,
  services,
  canSelectService,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string | null;
  services: ServiceOption[];
  canSelectService: boolean;
}) {
  const qc = useQueryClient();
  const isEdit = !!articleId;

  // Fetch the full article when editing.
  const { data: existing, isLoading } = useQuery<KnowledgeArticleFull | null>({
    queryKey: ['knowledge', 'article', articleId],
    queryFn: () => (articleId ? apiGet(`/api/knowledge/${articleId}`) : Promise.resolve(null)),
    enabled: !!articleId && open,
  });

  // Local form state — initialises from the fetched article on edit, or
  // sensible defaults on create. We use a key-driven reset so opening the
  // dialog for a different article doesn't carry over stale state.
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState<'HOW_TO' | 'KNOWN_ERROR' | 'FAQ' | 'RUNBOOK'>('HOW_TO');
  const [serviceId, setServiceId] = React.useState<string>('');
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setTitle(existing.title);
      setType(existing.type as 'HOW_TO' | 'KNOWN_ERROR' | 'FAQ' | 'RUNBOOK');
      setServiceId(existing.serviceId ?? '');
      setBody(existing.body);
    } else if (!isEdit) {
      setTitle('');
      setType('HOW_TO');
      setServiceId('');
      setBody('');
    }
  }, [open, isEdit, existing]);

  async function handleSubmit() {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        body,
        type,
        serviceId: serviceId || undefined,
      };
      if (isEdit && articleId) {
        await apiPatch(`/api/knowledge/${articleId}`, payload);
        toast.success('Article updated');
      } else {
        await apiPost('/api/knowledge', payload);
        toast.success('Draft article created');
      }
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit article' : 'New knowledge article'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Edit the draft or in-review article. Use the lifecycle actions in the list to publish or retire.'
              : 'Create a DRAFT article. You can submit it for review from the article list.'}
          </DialogDescription>
        </DialogHeader>
        {isEdit && isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading article…
          </div>
        ) : (
          <ScrollArea className="flex-1 -mx-1 px-1">
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="kb-title">Title</Label>
                <Input
                  id="kb-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. How to reset your SSO password"
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="kb-type">Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as 'HOW_TO' | 'KNOWN_ERROR' | 'FAQ' | 'RUNBOOK')}>
                    <SelectTrigger id="kb-type">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOW_TO">How To</SelectItem>
                      <SelectItem value="KNOWN_ERROR">Known Error</SelectItem>
                      <SelectItem value="FAQ">FAQ</SelectItem>
                      <SelectItem value="RUNBOOK">Runbook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {canSelectService && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="kb-service">Service (optional)</Label>
                    <Select value={serviceId} onValueChange={setServiceId}>
                      <SelectTrigger id="kb-service">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="kb-body">Body (Markdown)</Label>
                <Textarea
                  id="kb-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={'# Title\n\nWrite the article in **Markdown**. Supports headings, lists, code blocks, links, and tables.'}
                  className="min-h-[320px] font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Tip: use <code className="font-mono">#</code> for headings, <code className="font-mono">-</code> for lists, <code className="font-mono">```</code> for code blocks.
                </p>
              </div>
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || isLoading}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Article viewer dialog (read-only) ----
function ArticleViewerDialog({
  articleId,
  onOpenChange,
}: {
  articleId: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: article, isLoading } = useQuery<KnowledgeArticleFull | null>({
    queryKey: ['knowledge', 'article', articleId],
    queryFn: () => (articleId ? apiGet(`/api/knowledge/${articleId}`) : Promise.resolve(null)),
    enabled: !!articleId,
    staleTime: 60_000,
  });

  return (
    <Dialog open={!!articleId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {isLoading || !article ? (
          <div className="py-16 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading article…
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <KnowledgeTypeBadge type={article.type} />
                <Badge variant="outline" className={cn('border font-medium', STATUS_BADGE_CLS[article.status])}>
                  {STATUS_LABELS[article.status] ?? article.status}
                </Badge>
                {article.serviceName && (
                  <Badge variant="outline" className="text-[11px]">
                    {article.serviceName}
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-xl">{article.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>By {article.authorName}</span>
                {article.reviewerName && <span>Reviewed by {article.reviewerName}</span>}
                {article.publishedAt && (
                  <span>Published {new Date(article.publishedAt).toLocaleDateString()}</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 -mx-1 px-1">
              <article className="text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-5 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4 [&_hr]:border-border [&_strong]:font-semibold [&_em]:italic [&_table]:w-full [&_table]:my-3 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:bg-muted/50 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1">
                <ReactMarkdown>{article.body}</ReactMarkdown>
              </article>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default KnowledgeManager;
