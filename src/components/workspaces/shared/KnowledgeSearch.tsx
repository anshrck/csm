'use client';

/**
 * KnowledgeSearch — shared knowledge base search component.
 *
 * Surfaces published knowledge articles via a debounced text search, with
 * optional type filtering. Results show the article type badge, title, and a
 * short markdown-stripped snippet. Clicking a result opens a Dialog that
 * renders the full article body as markdown via react-markdown.
 *
 * Used by every role's knowledge view:
 *   - SERVICE_CUSTOMER → browse-only (read-only).
 *   - SCM_WORKER / CM_LEADER / SERVICE_OWNER → same search UX, but the
 *     surrounding workspace page wraps this component with a CRUD editor.
 *
 * API contract:
 *   GET /api/knowledge?summary=1&q=<text>&type=<TYPE>&serviceId=<id>
 *   → KnowledgeArticleSummary[] (no body field, lightweight for search lists)
 *
 *   GET /api/knowledge/[id]  → SerializedKnowledgeArticle (full body included)
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookOpen, FileText, HelpCircle, AlertOctagon, Wrench, Loader2, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// ---- Types ----
// Mirrors the summary shape returned by /api/knowledge?summary=1.
export interface KnowledgeArticleSummary {
  id: string;
  title: string;
  type: string; // HOW_TO | KNOWN_ERROR | FAQ | RUNBOOK
  status: string;
  serviceId: string | null;
  serviceName: string | null;
  authorName: string;
  updatedAt: string;
  publishedAt: string | null;
  snippet: string;
}

interface KnowledgeArticleFull extends KnowledgeArticleSummary {
  body: string;
  reviewerName: string | null;
  createdAt: string;
}

// ---- Type metadata ----
// Centralised badge styling + icon for each article type so the search UI and
// any consumer stays consistent.
export const KNOWLEDGE_TYPE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  HOW_TO: {
    label: 'How To',
    icon: FileText,
    cls: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900',
  },
  KNOWN_ERROR: {
    label: 'Known Error',
    icon: AlertOctagon,
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  },
  FAQ: {
    label: 'FAQ',
    icon: HelpCircle,
    cls: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
  },
  RUNBOOK: {
    label: 'Runbook',
    icon: Wrench,
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  },
};

export function KnowledgeTypeBadge({ type }: { type: string }) {
  const meta = KNOWLEDGE_TYPE_META[type] ?? {
    label: type,
    icon: FileText,
    cls: 'bg-muted text-muted-foreground border-border',
  };
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn('gap-1 border font-medium', meta.cls)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

// ---- Component ----
export interface KnowledgeSearchProps {
  /** Optional pre-applied type filter (e.g. a tab "Known Errors" pre-selects KNOWN_ERROR). */
  initialType?: string;
  /** Optional serviceId filter — e.g. Service Owner view filters to owned services. */
  serviceId?: string;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Render a "no results" empty state message. */
  emptyLabel?: string;
  /** Optional className applied to the outer container. */
  className?: string;
  /** When true, only published articles are returned (always true for the customer view; scm/cm/owner can opt to see drafts via a separate list). */
  publishedOnly?: boolean;
  /** Optional callback invoked when the user picks an article (e.g. to navigate). */
  onSelect?: (article: KnowledgeArticleSummary) => void;
}

export function KnowledgeSearch({
  initialType,
  serviceId,
  placeholder = 'Search articles…',
  emptyLabel = 'No articles found.',
  className,
  publishedOnly = true,
  onSelect,
}: KnowledgeSearchProps) {
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Debounce the search input so we don't fire a request on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Build the query string. We always pass summary=1 so the list endpoint
  // doesn't ship full markdown bodies.
  const search = new URLSearchParams({ summary: '1' });
  if (debounced) search.set('q', debounced);
  if (initialType) search.set('type', initialType);
  if (serviceId) search.set('serviceId', serviceId);
  // SERVICE_CUSTOMER would always get PUBLISHED only via the API role scope,
  // but for non-customer roles the caller can opt to see drafts too — if they
  // don't, we filter to PUBLISHED here.
  if (publishedOnly) search.set('status', 'PUBLISHED');

  const { data: results = [], isLoading } = useQuery<KnowledgeArticleSummary[]>({
    queryKey: ['knowledge', 'search', debounced, initialType ?? '', serviceId ?? '', publishedOnly ? 'PUBLISHED' : 'ALL'],
    queryFn: () => apiGet(`/api/knowledge?${search.toString()}`),
    staleTime: 15_000,
  });

  // Fetch the full article (with body) when the user picks one.
  const { data: selected, isLoading: loadingDetail } = useQuery<KnowledgeArticleFull | null>({
    queryKey: ['knowledge', 'article', openId],
    queryFn: () => (openId ? apiGet(`/api/knowledge/${openId}`) : Promise.resolve(null)),
    enabled: !!openId,
    staleTime: 60_000,
  });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
          aria-label="Search knowledge base"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading articles…
        </div>
      ) : results.length === 0 ? (
        <div className="py-12 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[60vh]">
          <ul className="space-y-1.5 pr-2">
            {results.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(a.id);
                    onSelect?.(a);
                  }}
                  className="w-full text-left rounded-lg border p-3 transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <KnowledgeTypeBadge type={a.type} />
                      <h3 className="text-sm font-medium truncate">{a.title}</h3>
                    </div>
                    {a.serviceName && (
                      <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                        {a.serviceName}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.snippet}</p>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}

      {/* Article detail dialog */}
      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {loadingDetail || !selected ? (
            <div className="py-16 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading article…
            </div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <KnowledgeTypeBadge type={selected.type} />
                  {selected.serviceName && (
                    <Badge variant="outline" className="text-[11px]">
                      {selected.serviceName}
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-xl">{selected.title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>By {selected.authorName}</span>
                  {selected.reviewerName && <span>Reviewed by {selected.reviewerName}</span>}
                  {selected.publishedAt && (
                    <span>Published {new Date(selected.publishedAt).toLocaleDateString()}</span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="flex-1 -mx-1 px-1">
                <article className="text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-5 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4 [&_hr]:border-border [&_strong]:font-semibold [&_em]:italic [&_table]:w-full [&_table]:my-3 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:bg-muted/50 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1">
                  <ReactMarkdown>{selected.body}</ReactMarkdown>
                </article>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default KnowledgeSearch;
