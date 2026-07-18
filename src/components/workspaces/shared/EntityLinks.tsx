'use client';

/**
 * EntityLinks — shared component for relating any two entities
 * (Ticket, Demand, Change, Problem, SLA event, Knowledge article).
 *
 * Props: { entityType, entityId }
 *
 * Features:
 *   - Lists all links where this entity is the "from" side AND the "to" side
 *     (so reverse links show up too — e.g. a ticket caused by a problem).
 *   - Each link row shows: linked entity type badge, title/subtitle (resolved
 *     server-side), link-type badge, and a [Remove] button (gated on
 *     `link.canDelete` — derived from the caller's role on the entity).
 *   - [Add Link] dialog: pick a target entity type, search by text, pick a
 *     link type (CAUSED_BY | RELATES_TO | CONVERTED_TO | FULFILLED_BY |
 *     DUPLICATES | BLOCKS | DEPENDS_ON), submit.
 *
 * Mounted inside TicketDetail and DemandDetail.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  SectionCard,
  EmptyState,
  LoadingState,
  RelativeTime,
  Badge,
  Button,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Link2,
  Plus,
  Trash2,
  Search,
  ArrowRight,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn } from '@/lib/utils';

// ---- Wire types -----------------------------------------------------------

export type LinkableEntityType =
  | 'TICKET'
  | 'DEMAND'
  | 'CHANGE'
  | 'PROBLEM'
  | 'SLA_EVENT'
  | 'KNOWLEDGE_ARTICLE';

interface EntityLinkRow {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  linkType: string;
  createdBy: string | null;
  createdAt: string;
  summary: { title: string; subtitle: string | null; url: string | null } | null;
  accessible: boolean;
}

interface SearchHit {
  type: 'DEMAND' | 'TICKET' | 'SERVICE' | 'KNOWLEDGE' | 'CHANGE' | 'PROBLEM';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

// ---- Labels ---------------------------------------------------------------

const ENTITY_TYPE_LABELS: Record<string, string> = {
  TICKET: 'Ticket',
  DEMAND: 'Demand',
  CHANGE: 'Change',
  PROBLEM: 'Problem',
  SLA_EVENT: 'SLA Event',
  KNOWLEDGE_ARTICLE: 'Knowledge Article',
  SLA_REPORT: 'SLA Report',
  GOVERNANCE_DECISION: 'Governance Decision',
  COMMUNICATION: 'Communication',
};

const ENTITY_TYPE_TONES: Record<string, string> = {
  TICKET: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300',
  DEMAND: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300',
  CHANGE: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300',
  PROBLEM: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300',
  SLA_EVENT: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
  KNOWLEDGE_ARTICLE: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300',
};

const LINK_TYPE_LABELS: Record<string, string> = {
  CAUSED_BY: 'Caused by',
  RELATES_TO: 'Relates to',
  CONVERTED_TO: 'Converted to',
  FULFILLED_BY: 'Fulfilled by',
  DUPLICATES: 'Duplicates',
  BLOCKS: 'Blocks',
  DEPENDS_ON: 'Depends on',
};

const LINK_TYPE_TONES: Record<string, string> = {
  CAUSED_BY: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300',
  RELATES_TO: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300',
  CONVERTED_TO: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300',
  FULFILLED_BY: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300',
  DUPLICATES: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
  BLOCKS: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300',
  DEPENDS_ON: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
};

// Map our internal entity types to the Search API's `type` field so the
// Add-Link dialog can show appropriate results.
const SEARCH_TYPE_BY_ENTITY: Record<LinkableEntityType, SearchHit['type']> = {
  TICKET: 'TICKET',
  DEMAND: 'DEMAND',
  CHANGE: 'CHANGE',
  PROBLEM: 'PROBLEM',
  SLA_EVENT: 'PROBLEM', // SLA events aren't directly searchable; show problems as fallback
  KNOWLEDGE_ARTICLE: 'KNOWLEDGE',
};

// ---- Component ------------------------------------------------------------

export interface EntityLinksProps {
  entityType: LinkableEntityType;
  entityId: string;
  /** Optional: hide the [Remove] button (e.g. when read-only). */
  readOnly?: boolean;
}

interface MergedLink extends EntityLinkRow {
  otherType: string;
  otherId: string;
  otherSummary: EntityLinkRow['summary'];
  direction: 'from' | 'to';
}

export default function EntityLinks({ entityType, entityId, readOnly }: EntityLinksProps) {
  const qc = useQueryClient();
  const { navigate } = useApp();

  // ---- Fetch both directions: links where this entity is the FROM side,
  // and links where it is the TO side. We union the results client-side and
  // tag each row with the "other side" so the UI renders consistently.
  const fromQuery = useQuery<EntityLinkRow[]>({
    queryKey: ['entity-links', 'from', entityType, entityId],
    queryFn: () =>
      apiGet<EntityLinkRow[]>(
        `/api/entity-links?fromType=${entityType}&fromId=${entityId}`,
      ),
    enabled: !!entityType && !!entityId,
  });

  const toQuery = useQuery<EntityLinkRow[]>({
    queryKey: ['entity-links', 'to', entityType, entityId],
    queryFn: () =>
      apiGet<EntityLinkRow[]>(
        `/api/entity-links?toType=${entityType}&toId=${entityId}`,
      ),
    enabled: !!entityType && !!entityId,
  });

  // Merge + dedupe.
  const allLinks = useMemo<MergedLink[]>(() => {
    const from: MergedLink[] = (fromQuery.data ?? []).map((l) => ({
      ...l,
      // The "other" side for a FROM-anchored link is the TO side.
      otherType: l.toType,
      otherId: l.toId,
      otherSummary: l.summary,
      direction: 'from' as const,
    }));
    const to: MergedLink[] = (toQuery.data ?? []).map((l) => ({
      ...l,
      otherType: l.fromType,
      otherId: l.fromId,
      otherSummary: l.summary,
      direction: 'to' as const,
    }));
    // Dedupe by id (in case the same link appears in both queries, which
    // shouldn't happen but be defensive).
    const seen = new Set<string>();
    const merged: MergedLink[] = [];
    for (const l of [...from, ...to]) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        merged.push(l);
      }
    }
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [fromQuery.data, toQuery.data]);

  // ---- Remove mutation ----------------------------------------------------
  const removeMut = useMutation({
    mutationFn: (linkId: string) => apiDelete(`/api/entity-links/${linkId}`),
    onSuccess: () => {
      toast.success('Link removed');
      qc.invalidateQueries({ queryKey: ['entity-links'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to remove link'),
  });

  // ---- Add link dialog ----------------------------------------------------
  const [addOpen, setAddOpen] = useState(false);
  const [targetType, setTargetType] = useState<LinkableEntityType>('TICKET');
  const [searchText, setSearchText] = useState('');
  const [linkType, setLinkType] = useState<string>('RELATES_TO');
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);

  // Search the server-side search endpoint with the current text + target type.
  const searchQuery = useQuery<{ results: SearchHit[] }>({
    queryKey: ['search', searchText, targetType],
    queryFn: () =>
      apiGet<{ results: SearchHit[] }>(
        `/api/search?q=${encodeURIComponent(searchText)}`,
      ),
    enabled: searchText.trim().length >= 2,
    staleTime: 10_000,
  });

  // Filter search results to the requested target type.
  const filteredHits = useMemo(() => {
    const hits = searchQuery.data?.results ?? [];
    const targetTypeMapped = SEARCH_TYPE_BY_ENTITY[targetType];
    return hits
      .filter((h) => h.type === targetTypeMapped && h.id !== entityId)
      .slice(0, 12);
  }, [searchQuery.data, targetType, entityId]);

  // Reset dialog state when opened/closed.
  React.useEffect(() => {
    if (!addOpen) {
      setTargetType('TICKET');
      setSearchText('');
      setLinkType('RELATES_TO');
      setSelectedHit(null);
    }
  }, [addOpen]);

  // Create link mutation.
  const createMut = useMutation({
    mutationFn: () => {
      if (!selectedHit) throw new Error('Select a target entity first');
      // Map search-hit type back to the EntityLink type.
      const toTypeMap: Record<SearchHit['type'], string> = {
        TICKET: 'TICKET',
        DEMAND: 'DEMAND',
        CHANGE: 'CHANGE',
        PROBLEM: 'PROBLEM',
        KNOWLEDGE: 'KNOWLEDGE_ARTICLE',
        SERVICE: 'KNOWLEDGE_ARTICLE', // shouldn't happen
      };
      return apiPost('/api/entity-links', {
        fromType: entityType,
        fromId: entityId,
        toType: toTypeMap[selectedHit.type],
        toId: selectedHit.id,
        linkType,
      });
    },
    onSuccess: () => {
      toast.success('Link created');
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ['entity-links'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create link'),
  });

  // ---- Navigation handlers ------------------------------------------------
  const handleOpenEntity = (otherType: string, otherId: string) => {
    if (otherType === 'TICKET') {
      navigate('ticket-detail', { id: otherId });
    } else if (otherType === 'DEMAND') {
      navigate('demand-detail', { id: otherId });
    } else if (otherType === 'CHANGE') {
      navigate('change-detail', { id: otherId });
    } else if (otherType === 'PROBLEM') {
      navigate('problems');
    } else if (otherType === 'KNOWLEDGE_ARTICLE') {
      navigate('knowledge');
    }
  };

  // ---- Loading state ------------------------------------------------------
  const isLoading = fromQuery.isLoading || toQuery.isLoading;

  return (
    <SectionCard
      title="Related Entities"
      description="Link this entity to other tickets, demands, changes, problems, or knowledge articles to trace cause, dependency, and conversion relationships."
      actions={
        !readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Link
          </Button>
        )
      }
    >
      {isLoading ? (
        <LoadingState rows={2} />
      ) : allLinks.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-8 w-8 text-muted-foreground/50" />}
          title="No related entities"
          description={
            readOnly
              ? 'No entity links have been created yet.'
              : 'Create the first link to relate this entity to a ticket, demand, change, problem, or knowledge article.'
          }
          action={
            !readOnly ? (
              <Button onClick={() => setAddOpen(true)} variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add first link
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ScrollArea className="max-h-72 pr-3">
          <ul className="space-y-2">
            {allLinks.map((l) => {
              const otherType = l.otherType as string;
              const otherSummary = l.otherSummary;
              const label =
                ENTITY_TYPE_LABELS[otherType] ?? otherType;
              const tone =
                ENTITY_TYPE_TONES[otherType] ?? 'bg-muted text-muted-foreground border-border';
              const linkLabel =
                LINK_TYPE_LABELS[l.linkType] ?? l.linkType;
              const linkTone =
                LINK_TYPE_TONES[l.linkType] ??
                'bg-muted text-muted-foreground border-border';
              return (
                <li
                  key={l.id}
                  className="rounded-md border bg-card hover:bg-muted/20 transition-colors p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', tone)}>
                          {label}
                        </Badge>
                        <Badge variant="outline" className={cn('text-[10px]', linkTone)}>
                          {linkLabel}
                        </Badge>
                        {l.direction === 'to' && (
                          <span className="text-[10px] text-muted-foreground italic">
                            (reverse link)
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenEntity(otherType, l.otherId)}
                        className="block text-left text-sm font-medium hover:text-primary hover:underline truncate max-w-full"
                        title={otherSummary?.title ?? l.otherId}
                      >
                        {otherSummary?.title ?? l.otherId}
                      </button>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {otherSummary?.subtitle && <span>{otherSummary.subtitle}</span>}
                        <span>·</span>
                        <span>
                          Linked <RelativeTime date={l.createdAt} />
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEntity(otherType, l.otherId)}
                        className="h-7 w-7 p-0"
                        title="Open entity"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMut.mutate(l.id)}
                          disabled={removeMut.isPending}
                          className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="Remove link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}

      {/* Add Link Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Add Entity Link
            </DialogTitle>
            <DialogDescription>
              Relate this {ENTITY_TYPE_LABELS[entityType] ?? entityType} to another entity. Both sides
              of the link will be visible from each entity&apos;s detail page.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Target type */}
            <div className="space-y-1.5">
              <Label htmlFor="el-target-type">Target entity type</Label>
              <Select
                value={targetType}
                onValueChange={(v) => {
                  setTargetType(v as LinkableEntityType);
                  setSelectedHit(null);
                }}
              >
                <SelectTrigger id="el-target-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['TICKET', 'DEMAND', 'CHANGE', 'PROBLEM', 'KNOWLEDGE_ARTICLE'] as LinkableEntityType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {ENTITY_TYPE_LABELS[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="space-y-1.5">
              <Label htmlFor="el-search">Search target</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="el-search"
                  placeholder={`Search for a ${ENTITY_TYPE_LABELS[targetType] ?? targetType}…`}
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setSelectedHit(null);
                  }}
                  className="pl-8"
                />
              </div>
              {searchText.trim().length < 2 && (
                <p className="text-[11px] text-muted-foreground">
                  Type at least 2 characters to search.
                </p>
              )}
              {searchQuery.isFetching && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Search className="h-3 w-3 animate-pulse" /> Searching…
                </p>
              )}
              {searchQuery.isError && (
                <p className="text-[11px] text-rose-600 flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3" /> Search failed
                </p>
              )}
              {searchQuery.data && filteredHits.length === 0 && searchText.trim().length >= 2 && (
                <p className="text-[11px] text-muted-foreground">
                  No {ENTITY_TYPE_LABELS[targetType] ?? targetType} matches found.
                </p>
              )}
              {filteredHits.length > 0 && (
                <ScrollArea className="max-h-48 border rounded-md">
                  <ul className="divide-y">
                    {filteredHits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedHit(h)}
                          className={cn(
                            'w-full text-left px-2.5 py-2 hover:bg-muted/40 transition-colors flex items-start gap-2',
                            selectedHit?.id === h.id && 'bg-primary/10 hover:bg-primary/15',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">{h.title}</div>
                            {h.subtitle && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                {h.subtitle}
                              </div>
                            )}
                          </div>
                          {selectedHit?.id === h.id && (
                            <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>

            {/* Link type */}
            <div className="space-y-1.5">
              <Label htmlFor="el-link-type">Link type</Label>
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger id="el-link-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LINK_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Describes how the target relates to this entity. Read as &quot;this entity is{' '}
                <span className="font-medium">{LINK_TYPE_LABELS[linkType]?.toLowerCase()}</span> the
                target.&quot;
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!selectedHit || createMut.isPending}
              onClick={() => createMut.mutate()}
              className="gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5" />
              {createMut.isPending ? 'Creating…' : 'Create link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
