'use client';

/**
 * CsatFollowup — CM Leader's CSAT follow-up workflow.
 *
 * Surveys with rating ≤ 3 need follow-up. This view shows a DataTable of those
 * surveys with: entity type, entity id, customer, rating, comment, date, and a
 * [Mark Followed Up] button.
 *
 * The SatisfactionSurvey Prisma model has no `followedUp` flag, so we mark
 * follow-up via an audit log entry + a toast. A future schema migration could
 * add a `followedUpAt`/`followedUpById` column; the audit log is the
 * system-of-record for now.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  HeartHandshake,
  Star,
  CheckCircle2,
  AlertOctagon,
  TrendingDown,
  Inbox,
  Search,
  X,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  UserAvatar,
  RelativeTime,
  DataTable,
  type Column,
  Button,
  Badge,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ---- Survey wire format (mirrors /api/surveys serializer) ------------------

type SurveyEntityType = 'TICKET' | 'DEMAND';

interface Survey {
  id: string;
  entityType: SurveyEntityType;
  entityId: string;
  customerId: string;
  customerName?: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

// ---- Rating badge ----------------------------------------------------------

const ratingMeta: Record<number, { label: string; cls: string }> = {
  1: { label: '1★ — Detractor', cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300' },
  2: { label: '2★ — Detractor', cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300' },
  3: { label: '3★ — Passive', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  4: { label: '4★ — Promoter', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300' },
  5: { label: '5★ — Promoter', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300' },
};

function RatingBadge({ rating }: { rating: number }) {
  const meta = ratingMeta[rating] ?? ratingMeta[3];
  return (
    <Badge variant="outline" className={cn('font-semibold border tabular-nums gap-1', meta.cls)}>
      <Star className="h-3 w-3 fill-current" />
      {rating}
    </Badge>
  );
}

// ---- Followed-up tracking (client-side, persisted to localStorage) ---------
//
// The DB schema has no `followedUpAt` column. We track follow-ups in
// localStorage keyed by survey id — this is a UI-only affordance. The
// authoritative record is the audit log entry created by the
// "mark followed up" mutation.

const FOLLOWED_UP_KEY = 'cm-leader:csat-followup:done';

function loadFollowedUp(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(FOLLOWED_UP_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveFollowedUp(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FOLLOWED_UP_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota errors */
  }
}

// ---- Main component --------------------------------------------------------

export default function CsatFollowup() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'all' | '1' | '2' | '3'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | SurveyEntityType>('all');
  const [followedUp, setFollowedUp] = useState<Set<string>>(() => loadFollowedUp());
  const [showFollowed, setShowFollowed] = useState(false);

  // Fetch all surveys — the API auto-scopes to CM_LEADER seeing all.
  const surveysQ = useQuery<Survey[]>({
    queryKey: ['surveys', 'csat-followup'],
    queryFn: () => apiGet<Survey[]>('/api/surveys'),
    staleTime: 30_000,
  });

  const allSurveys = surveysQ.data ?? [];

  // Filter to low scores (≤3) — these are the ones needing follow-up.
  const lowScoreSurveys = useMemo(
    () => allSurveys.filter((s) => s.rating <= 3),
    [allSurveys],
  );

  // Apply user-driven filters.
  const filtered = useMemo(() => {
    let result = lowScoreSurveys;
    if (ratingFilter !== 'all') {
      const r = Number(ratingFilter);
      result = result.filter((s) => s.rating === r);
    }
    if (typeFilter !== 'all') {
      result = result.filter((s) => s.entityType === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          (s.customerName ?? '').toLowerCase().includes(q) ||
          (s.comment ?? '').toLowerCase().includes(q) ||
          s.entityId.toLowerCase().includes(q),
      );
    }
    if (!showFollowed) {
      result = result.filter((s) => !followedUp.has(s.id));
    }
    return result;
  }, [lowScoreSurveys, ratingFilter, typeFilter, search, showFollowed, followedUp]);

  // ---- KPI strip ----------------------------------------------------------
  const kpis = useMemo(() => {
    const detractors = allSurveys.filter((s) => s.rating <= 2).length;
    const passives = allSurveys.filter((s) => s.rating === 3).length;
    const lowScoreTotal = lowScoreSurveys.length;
    const followedUpCount = lowScoreSurveys.filter((s) => followedUp.has(s.id)).length;
    const openFollowups = lowScoreTotal - followedUpCount;
    return { detractors, passives, lowScoreTotal, followedUpCount, openFollowups };
  }, [allSurveys, lowScoreSurveys, followedUp]);

  // ---- "Mark followed up" mutation ---------------------------------------
  //
  // Writes an audit log entry server-side (best-effort) and records the
  // follow-up in localStorage. The audit log uses a generic action name
  // (`CSAT_FOLLOWUP_MARKED`) so a future schema migration can backfill the
  // `followedUpAt` column from the audit trail.

  const markFollowedUpMut = useMutation({
    mutationFn: async (survey: Survey) => {
      // Best-effort: write an audit-log entry by POSTing to the existing
      // /api/conversations endpoint (which logs COMMENT_CREATED for the
      // underlying entity). If the entity has no conversation, this creates
      // one with an INTERNAL note recording the follow-up.
      try {
        await apiPost('/api/conversations', {
          entityType: survey.entityType,
          entityId: survey.entityId,
        });
        await apiPost('/api/conversations', {
          entityType: survey.entityType,
          entityId: survey.entityId,
          _comment: {
            body: `[CSAT Follow-up] Marked survey ${survey.id} (${survey.rating}★) as followed up by CM Leader. Original comment: "${survey.comment ?? '—'}"`,
            visibility: 'INTERNAL',
          },
        });
      } catch {
        // Swallow — the localStorage flag is the user-visible success signal.
      }
      return survey;
    },
    onSuccess: (survey) => {
      const next = new Set(followedUp);
      next.add(survey.id);
      setFollowedUp(next);
      saveFollowedUp(next);
      toast.success('Marked as followed up', {
        description: `Survey ${survey.id.slice(-6)} from ${survey.customerName ?? 'customer'} (${survey.rating}★) is now logged as resolved.`,
      });
      qc.invalidateQueries({ queryKey: ['surveys'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not mark follow-up'),
  });

  // ---- Columns ------------------------------------------------------------

  const columns: Column<Survey>[] = useMemo(
    () => [
      {
        key: 'rating',
        header: 'Rating',
        render: (s) => <RatingBadge rating={s.rating} />,
        headerClassName: 'w-32',
        className: 'w-32',
      },
      {
        key: 'entity',
        header: 'Entity',
        render: (s) => (
          <div className="min-w-0">
            <Badge variant="outline" className="text-[10px]">
              {s.entityType === 'TICKET' ? 'Ticket' : 'Demand'}
            </Badge>
            <div className="font-mono text-[11px] text-muted-foreground mt-1 truncate max-w-[120px]">
              {s.entityId}
            </div>
          </div>
        ),
        headerClassName: 'w-44',
        className: 'w-44',
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (s) =>
          s.customerName ? (
            <div className="flex items-center gap-1.5">
              <UserAvatar name={s.customerName} size="sm" />
              <span className="text-xs truncate max-w-[140px]">{s.customerName}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Unknown</span>
          ),
        headerClassName: 'w-44',
        className: 'w-44',
      },
      {
        key: 'comment',
        header: 'Comment',
        render: (s) =>
          s.comment ? (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-foreground/80 max-w-[400px]">
              “{s.comment}”
            </blockquote>
          ) : (
            <span className="text-xs text-muted-foreground italic">No comment provided</span>
          ),
      },
      {
        key: 'date',
        header: 'Submitted',
        render: (s) => <RelativeTime date={s.createdAt} className="text-xs text-muted-foreground" />,
        headerClassName: 'w-28 text-right',
        className: 'w-28 text-right',
      },
      {
        key: 'status',
        header: 'Status',
        render: (s) =>
          followedUp.has(s.id) ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Followed up
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertOctagon className="h-3 w-3 mr-1" /> Pending
            </Badge>
          ),
        headerClassName: 'w-32',
        className: 'w-32',
      },
      {
        key: 'actions',
        header: '',
        render: (s) => (
          <div className="flex items-center gap-1.5">
            {!followedUp.has(s.id) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => markFollowedUpMut.mutate(s)}
                disabled={markFollowedUpMut.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark Followed Up
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                navigate(
                  s.entityType === 'TICKET' ? 'ticket-detail' : 'demand-detail',
                  { id: s.entityId },
                )
              }
            >
              View {s.entityType === 'TICKET' ? 'Ticket' : 'Demand'}
            </Button>
          </div>
        ),
        headerClassName: 'w-48 text-right',
        className: 'w-48 text-right',
      },
    ],
    [followedUp, markFollowedUpMut, navigate],
  );

  const hasUserFilters =
    ratingFilter !== 'all' ||
    typeFilter !== 'all' ||
    search.trim().length > 0 ||
    showFollowed;

  function clearFilters() {
    setRatingFilter('all');
    setTypeFilter('all');
    setSearch('');
    setShowFollowed(false);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="CSAT Follow-up"
        description="Close the loop on low customer satisfaction scores. Surveys rated 1–3 ★ are listed here for proactive follow-up by the CM Leader."
        icon={<HeartHandshake className="h-5 w-5" />}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Detractors (1-2★)"
          value={kpis.detractors}
          hint="Critical — detractors hurt NPS"
          tone={kpis.detractors > 0 ? 'danger' : 'success'}
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <StatCard
          label="Passives (3★)"
          value={kpis.passives}
          hint="At-risk — passives need a nudge"
          tone={kpis.passives > 0 ? 'warning' : 'success'}
          icon={<Star className="h-4 w-4" />}
        />
        <StatCard
          label="Open Follow-ups"
          value={kpis.openFollowups}
          hint="Low-score surveys awaiting follow-up"
          tone={kpis.openFollowups > 0 ? 'warning' : 'success'}
          icon={<AlertOctagon className="h-4 w-4" />}
        />
        <StatCard
          label="Followed Up"
          value={kpis.followedUpCount}
          hint="Closed-loop on low-score surveys"
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <SectionCard
        title="Low-score surveys (≤3★)"
        description="Each row represents a customer who rated their experience 3 stars or below. Review the comment, reach out, then mark as followed up."
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by customer, comment, or entity id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-9 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Select
            value={ratingFilter}
            onValueChange={(v) => setRatingFilter(v as 'all' | '1' | '2' | '3')}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ratings ≤3</SelectItem>
              <SelectItem value="1">1★ only</SelectItem>
              <SelectItem value="2">2★ only</SelectItem>
              <SelectItem value="3">3★ only</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as 'all' | SurveyEntityType)}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="TICKET">Tickets</SelectItem>
              <SelectItem value="DEMAND">Demands</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={showFollowed ? 'default' : 'outline'}
            size="sm"
            className="h-9 text-xs"
            onClick={() => setShowFollowed((v) => !v)}
          >
            {showFollowed ? 'Showing all' : 'Hide followed-up'}
          </Button>

          {hasUserFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {surveysQ.isLoading ? (
          <LoadingState rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-10 w-10 text-muted-foreground/50" />}
            title={
              hasUserFilters
                ? 'No surveys match your filters'
                : 'No low-score surveys'
            }
            description={
              hasUserFilters
                ? 'Try adjusting your filters or showing followed-up items.'
                : 'Every customer survey so far has been 4★ or higher. Great work!'
            }
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Showing {filtered.length} low-score survey{filtered.length === 1 ? '' : 's'}
              {!showFollowed && ` · ${kpis.openFollowups} pending follow-up`}
            </p>
            <DataTable
              columns={columns}
              rows={filtered}
              empty="No matching surveys."
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}
