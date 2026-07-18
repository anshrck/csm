'use client';

/**
 * CsatWidget — Customer Satisfaction survey component.
 *
 * Props:
 *   entityType — 'TICKET' | 'DEMAND'
 *   entityId   — string
 *
 * Behaviour depends on the session role:
 *
 *   SERVICE_CUSTOMER
 *     - Shows a star rating selector (1-5) + optional comment textarea.
 *     - If the customer has already submitted a survey, their rating + comment
 *       are shown read-only with a "thank you" callout.
 *     - Submit → POST /api/surveys. 409 (already submitted) is handled by
 *       invalidating and showing the existing survey.
 *
 *   CM_LEADER / SERVICE_OWNER
 *     - Shows the average rating, response count, distribution bars, and the
 *       most recent low-rating comments (rating ≤ 2).
 *     - Fetches GET /api/surveys?entityType=…&entityId=… (role-scoped server-side).
 *
 *   SCM_WORKER
 *     - Read-only view: average + count. SCM workers do not see individual
 *       survey comments (customer identity protection).
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Star, Send, Clock, CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet, apiPost } from '@/lib/api';
import {
  Badge,
  Button,
  EmptyState,
  LoadingState,
  RelativeTime,
} from '@/components/shared';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type EntityType = 'TICKET' | 'DEMAND';

interface Survey {
  id: string;
  entityType: EntityType;
  entityId: string;
  customerId: string;
  customerName?: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface Props {
  entityType: EntityType | string;
  entityId: string;
  className?: string;
}

export function CsatWidget({ entityType, entityId, className }: Props) {
  const { session } = useApp();
  const role = session?.role;

  if (role === 'SERVICE_CUSTOMER') {
    return <CustomerCsatWidget entityType={entityType as EntityType} entityId={entityId} className={className} />;
  }
  if (role === 'CM_LEADER' || role === 'SERVICE_OWNER') {
    return <LeaderCsatWidget entityType={entityType as EntityType} entityId={entityId} className={className} />;
  }
  if (role === 'SCM_WORKER') {
    return <WorkerCsatWidget entityType={entityType as EntityType} entityId={entityId} className={className} />;
  }
  // Unauthenticated / unknown role → render nothing.
  return null;
}

/* ----------------------------- customer view ----------------------------- */

function CustomerCsatWidget({
  entityType,
  entityId,
  className,
}: {
  entityType: EntityType;
  entityId: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const queryKey = useMemo(
    () => ['survey-mine', entityType, entityId] as const,
    [entityType, entityId],
  );

  const { data: existing, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<Survey[]>(
        `/api/surveys?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: !!entityId,
    select: (rows) => rows[0] ?? null,
  });

  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      apiPost<Survey>('/api/surveys', {
        entityType,
        entityId,
        rating,
        comment: comment.trim() || null,
      }),
    onSuccess: (s) => {
      toast.success('Thanks for your feedback!', {
        description:
          s.rating <= 2
            ? 'A Customer Management Leader has been notified.'
            : 'Your rating has been recorded.',
      });
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) {
        toast.info('You have already rated this item.');
        qc.invalidateQueries({ queryKey });
      } else {
        toast.error('Could not submit survey', { description: e.message });
      }
    },
  });

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border p-4', className)}>
        <LoadingState rows={2} />
      </div>
    );
  }

  if (existing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'rounded-lg border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20 p-4',
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-5 text-emerald-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Thanks — we have your feedback</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted <RelativeTime date={existing.createdAt} />
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={cn(
                    'size-6',
                    n <= existing.rating
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-muted text-muted-foreground',
                  )}
                />
              ))}
              <Badge variant="outline" className="ml-2 tabular-nums">
                {existing.rating} / 5
              </Badge>
            </div>
            {existing.comment && (
              <blockquote className="mt-3 border-l-2 border-emerald-300 pl-3 text-sm italic text-foreground/80">
                “{existing.comment}”
              </blockquote>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-3', className)}>
      <div className="flex items-start gap-2">
        <Star className="size-5 text-amber-500 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">How did we do?</h3>
          <p className="text-xs text-muted-foreground">
            Rate your experience with this {entityType.toLowerCase()}. Your feedback goes to the
            Customer Management leadership.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="rounded-md p-1 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Star
                className={cn(
                  'size-7 transition-colors',
                  active ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted-foreground',
                )}
              />
            </button>
          );
        })}
        {rating > 0 && (
          <Badge variant="outline" className="ml-2 tabular-nums">
            {rating} / 5
          </Badge>
        )}
      </div>

      <Textarea
        rows={3}
        placeholder={
          rating <= 2
            ? 'Tell us what went wrong (optional but helpful)…'
            : 'Optional comment…'
        }
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={submitMutation.isPending}
        className="resize-y"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rating === 0
            ? 'Select a rating to submit.'
            : rating <= 2
              ? 'Low ratings are escalated to the CM Leader.'
              : 'Thanks! Click submit to record your rating.'}
        </p>
        <Button
          size="sm"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || rating === 0}
          className="gap-1.5"
        >
          {submitMutation.isPending ? (
            <>
              <Clock className="size-3.5 animate-pulse" /> Submitting…
            </>
          ) : (
            <>
              <Send className="size-3.5" /> Submit
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------- leader / owner view ------------------------- */

interface Stats {
  count: number;
  average: number | null;
  distribution: Record<number, number>;
  lowRatingCount: number;
  detractorCount: number;
  promoterCount: number;
  nps: number | null;
}

function LeaderCsatWidget({
  entityType,
  entityId,
  className,
}: {
  entityType: EntityType;
  entityId: string;
  className?: string;
}) {
  const listKey = useMemo(
    () => ['surveys', entityType, entityId] as const,
    [entityType, entityId],
  );

  const { data: surveys, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      apiGet<Survey[]>(
        `/api/surveys?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: !!entityId,
  });

  const stats: Stats = useMemo(() => {
    const rows = surveys ?? [];
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let detractors = 0;
    let promoters = 0;
    for (const r of rows) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
      sum += r.rating;
      if (r.rating <= 2) detractors++;
      if (r.rating >= 4) promoters++;
    }
    const count = rows.length;
    const average = count > 0 ? Number((sum / count).toFixed(2)) : null;
    const nps = count > 0 ? Number((((promoters - detractors) / count) * 100).toFixed(0)) : null;
    return {
      count,
      average,
      distribution,
      lowRatingCount: distribution[1] + distribution[2],
      detractorCount: detractors,
      promoterCount: promoters,
      nps,
    };
  }, [surveys]);

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border p-4', className)}>
        <LoadingState rows={3} />
      </div>
    );
  }

  if (stats.count === 0) {
    return (
      <div className={cn('rounded-lg border p-4', className)}>
        <EmptyState
          icon={<Star className="size-8 text-amber-500" />}
          title="No CSAT responses yet"
          description={`Customer feedback for this ${entityType.toLowerCase()} will appear here once submitted.`}
        />
      </div>
    );
  }

  const lowRated = (surveys ?? [])
    .filter((s) => s.rating <= 2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);

  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Star className="size-5 text-amber-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Customer Satisfaction</h3>
            <p className="text-xs text-muted-foreground">
              {stats.count} response{stats.count === 1 ? '' : 's'} on this {entityType.toLowerCase()}
            </p>
          </div>
        </div>
        {stats.average !== null && (
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {stats.average.toFixed(2)}
              <span className="text-sm text-muted-foreground"> / 5</span>
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={cn(
                    'size-3',
                    n <= Math.round(stats.average as number)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-muted text-muted-foreground',
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-xs text-muted-foreground">Promoters</div>
          <div className="text-lg font-semibold text-emerald-600 tabular-nums">{stats.promoterCount}</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-xs text-muted-foreground">Detractors</div>
          <div className="text-lg font-semibold text-rose-600 tabular-nums">{stats.detractorCount}</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-xs text-muted-foreground">NPS</div>
          <div
            className={cn(
              'text-lg font-semibold tabular-nums',
              (stats.nps ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
            )}
          >
            {stats.nps !== null ? `${stats.nps > 0 ? '+' : ''}${stats.nps}` : '—'}
          </div>
        </div>
      </div>

      {/* Distribution */}
      <div className="space-y-1.5">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = stats.distribution[n] ?? 0;
          const pct = stats.count > 0 ? Math.round((count / stats.count) * 100) : 0;
          return (
            <div key={n} className="flex items-center gap-2 text-xs">
              <span className="w-6 inline-flex items-center gap-0.5">
                {n} <Star className="size-3 fill-amber-400 text-amber-400" />
              </span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    n >= 4
                      ? 'bg-emerald-500'
                      : n === 3
                        ? 'bg-amber-500'
                        : 'bg-rose-500',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-12 text-right tabular-nums text-muted-foreground">
                {count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>

      {lowRated.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
            <ThumbsDown className="size-3.5" /> Recent low ratings
          </div>
          <ul className="space-y-2">
            {lowRated.map((s) => (
              <li key={s.id} className="rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{s.customerName ?? 'Customer'}</span>
                    <Badge variant="outline" className="text-rose-700 dark:text-rose-300">
                      {s.rating}★
                    </Badge>
                  </div>
                  <RelativeTime date={s.createdAt} className="text-xs text-muted-foreground" />
                </div>
                {s.comment && (
                  <p className="mt-1.5 text-sm text-foreground/80 italic">“{s.comment}”</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lowRated.length === 0 && stats.count > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <ThumbsUp className="size-3.5" /> No low ratings — customers are satisfied.
        </div>
      )}
    </div>
  );
}

/* ----------------------------- SCM worker view ----------------------------- */

function WorkerCsatWidget({
  entityType,
  entityId,
  className,
}: {
  entityType: EntityType;
  entityId: string;
  className?: string;
}) {
  const queryKey = useMemo(
    () => ['surveys', entityType, entityId] as const,
    [entityType, entityId],
  );
  const { data: surveys, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<Survey[]>(
        `/api/surveys?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: !!entityId,
  });

  const rows = surveys ?? [];
  const count = rows.length;
  const average = count > 0 ? rows.reduce((s, r) => s + r.rating, 0) / count : null;

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border p-4', className)}>
        <LoadingState rows={2} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4 flex items-center gap-4', className)}>
      <div className="grid size-12 place-items-center rounded-full bg-amber-100 dark:bg-amber-950/40">
        <Star className="size-6 text-amber-500" />
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-semibold">Customer Satisfaction</h3>
        <p className="text-xs text-muted-foreground">
          {count > 0
            ? `${count} response${count === 1 ? '' : 's'} · individual comments are visible to leadership only.`
            : `No responses yet for this ${entityType.toLowerCase()}.`}
        </p>
      </div>
      {average !== null && (
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">
            {average.toFixed(2)}
            <span className="text-sm text-muted-foreground"> / 5</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CsatWidget;
