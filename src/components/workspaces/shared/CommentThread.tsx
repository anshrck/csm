'use client';

/**
 * CommentThread — drop-in threaded comments widget for any entity detail page.
 *
 * Props:
 *   entityType — 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT'
 *   entityId   — string
 *   customerScope — when true, force the SERVICE_CUSTOMER view (CUSTOMER_VISIBLE
 *                   comments only) regardless of the session role. Useful when a
 *                   non-customer renders a "customer-facing" preview.
 *
 * Behaviour:
 *   - On mount, GET /api/conversations?entityType=…&entityId=… returns the
 *     existing conversation (or an empty shell with id=null).
 *   - Posting a comment:
 *       1. if conversation.id is null → POST /api/conversations to seed it.
 *       2. POST /api/conversations/[id]/comments with { body, visibility }.
 *   - Edit own comments via PATCH /api/conversations/comments/[id].
 *   - TanStack Query refetchInterval keeps the thread fresh (5s when focused).
 *   - Visibility toggle (CUSTOMER_VISIBLE / INTERNAL) is shown only to
 *     SCM_WORKER / CM_LEADER / SERVICE_OWNER. SERVICE_CUSTOMER can only post
 *     CUSTOMER_VISIBLE.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Send,
  Pencil,
  Check,
  X,
  Lock,
  Eye,
  Clock,
  RefreshCw,
} from 'lucide-react';

import { useApp } from '@/lib/store';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import {
  Badge,
  Button,
  EmptyState,
  LoadingState,
  RelativeTime,
  UserAvatar,
} from '@/components/shared';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type EntityType = 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT';

interface CommentAuthor {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
  title: string | null;
}

interface Comment {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  author?: CommentAuthor;
  visibility: 'CUSTOMER_VISIBLE' | 'INTERNAL';
  body: string;
  createdAt: string;
  editedAt: string | null;
}

interface Conversation {
  id: string | null;
  entityType: EntityType;
  entityId: string;
  comments: Comment[];
  createdAt?: string;
  updatedAt?: string;
}

interface Props {
  entityType: EntityType | string;
  entityId: string;
  customerScope?: boolean;
  className?: string;
}

export function CommentThread({ entityType, entityId, customerScope = false, className }: Props) {
  const { session } = useApp();
  const qc = useQueryClient();

  const queryKey = useMemo(
    () => ['conversation', entityType, entityId] as const,
    [entityType, entityId],
  );

  const { data: conv, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<Conversation>(
        `/api/conversations?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    enabled: !!entityId,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = useState<'CUSTOMER_VISIBLE' | 'INTERNAL'>(
    'CUSTOMER_VISIBLE',
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const canSeeInternal =
    !customerScope &&
    (session?.role === 'SCM_WORKER' ||
      session?.role === 'CM_LEADER' ||
      session?.role === 'SERVICE_OWNER');

  const visibleComments = useMemo(() => {
    if (!conv?.comments) return [];
    if (customerScope || session?.role === 'SERVICE_CUSTOMER') {
      return conv.comments.filter((c) => c.visibility === 'CUSTOMER_VISIBLE');
    }
    return conv.comments;
  }, [conv, customerScope, session?.role]);

  // --- post comment ---
  const postMutation = useMutation({
    mutationFn: async (input: { body: string; visibility: 'CUSTOMER_VISIBLE' | 'INTERNAL' }) => {
      let convId = conv?.id;
      if (!convId) {
        const created = await apiPost<Conversation>('/api/conversations', {
          entityType,
          entityId,
        });
        convId = created.id;
      }
      return apiPost<Conversation>(
        `/api/conversations/${convId}/comments`,
        input,
      );
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error('Could not post comment', { description: e.message }),
  });

  // --- edit comment ---
  const editMutation = useMutation({
    mutationFn: (input: { id: string; body: string }) =>
      apiPatch<Comment>(`/api/conversations/comments/${input.id}`, { body: input.body }),
    onSuccess: () => {
      setEditId(null);
      setEditText('');
      qc.invalidateQueries({ queryKey });
      toast.success('Comment updated');
    },
    onError: (e: Error) => toast.error('Could not edit comment', { description: e.message }),
  });

  const onSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    if (!canSeeInternal && visibility === 'INTERNAL') return;
    postMutation.mutate({ body: text, visibility });
  };

  const startEdit = (c: Comment) => {
    setEditId(c.id);
    setEditText(c.body);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditText('');
  };

  const saveEdit = () => {
    if (!editId) return;
    const text = editText.trim();
    if (!text) return;
    editMutation.mutate({ id: editId, body: text });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Comments</h3>
          <Badge variant="outline" className="tabular-nums">
            {visibleComments.length}
          </Badge>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </TooltipTrigger>
          <TooltipContent>Auto-refreshes every 5s</TooltipContent>
        </Tooltip>
      </div>

      {isLoading ? (
        <LoadingState rows={3} />
      ) : isError ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="Couldn't load comments"
          description="Try refreshing the thread."
        />
      ) : visibleComments.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="No comments yet"
          description={
            customerScope
              ? 'No customer-visible messages have been posted yet.'
              : 'Start the conversation by adding the first comment below.'
          }
        />
      ) : (
        <ol className="space-y-3 max-h-[28rem] overflow-y-auto scrollbar-thin pr-1">
          {visibleComments.map((c, idx) => {
            const isOwn = c.authorId === session?.id;
            const editing = editId === c.id;
            const isInternal = c.visibility === 'INTERNAL';
            const authorColor = c.author?.avatarColor ?? '#0d9488';
            return (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: idx * 0.02 }}
                className={cn(
                  'flex gap-3 rounded-lg border p-3',
                  isInternal
                    ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
                    : 'border-border bg-card',
                )}
              >
                <UserAvatar name={c.authorName} color={authorColor} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold">{c.authorName}</span>
                    {c.author?.title && (
                      <span className="text-xs text-muted-foreground">{c.author.title}</span>
                    )}
                    {isInternal && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      >
                        <Lock className="size-3" /> Internal
                      </Badge>
                    )}
                    {!isInternal && (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <Eye className="size-3" /> Customer-visible
                      </Badge>
                    )}
                    <RelativeTime
                      date={c.createdAt}
                      className="text-xs text-muted-foreground"
                    />
                    {c.editedAt && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Pencil className="size-3" /> edited{' '}
                        <RelativeTime date={c.editedAt} />
                      </span>
                    )}
                  </div>

                  {editing ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={saveEdit}
                          disabled={editMutation.isPending || !editText.trim()}
                          className="h-7"
                        >
                          {editMutation.isPending ? (
                            <Clock className="size-3.5 animate-pulse" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEdit}
                          className="h-7"
                          disabled={editMutation.isPending}
                        >
                          <X className="size-3.5" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                      {c.body}
                    </p>
                  )}
                </div>

                {isOwn && !editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => startEdit(c)}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                )}
              </motion.li>
            );
          })}
        </ol>
      )}

      {/* Input box */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <Textarea
          rows={3}
          placeholder={
            customerScope || session?.role === 'SERVICE_CUSTOMER'
              ? 'Add a public reply…'
              : 'Add a comment to the thread…'
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={postMutation.isPending}
          className="resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {canSeeInternal ? (
              <div className="inline-flex rounded-md border overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setVisibility('CUSTOMER_VISIBLE')}
                  className={cn(
                    'px-2.5 py-1 inline-flex items-center gap-1 transition-colors',
                    visibility === 'CUSTOMER_VISIBLE'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  <Eye className="size-3" /> Customer-visible
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('INTERNAL')}
                  className={cn(
                    'px-2.5 py-1 inline-flex items-center gap-1 transition-colors',
                    visibility === 'INTERNAL'
                      ? 'bg-amber-500 text-white'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  <Lock className="size-3" /> Internal
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="size-3.5" /> Visible to the customer
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={postMutation.isPending || !draft.trim()}
            className="gap-1.5"
          >
            {postMutation.isPending ? (
              <>
                <Clock className="size-3.5 animate-pulse" /> Posting…
              </>
            ) : (
              <>
                <Send className="size-3.5" /> Post
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CommentThread;
