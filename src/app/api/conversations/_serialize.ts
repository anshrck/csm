// Shared helpers for the conversations + comments API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.
//
// Conversation / Comment models store no JSON-string columns, but they DO have
// Date fields (createdAt, updatedAt, editedAt) that must be ISO-converted on
// read. The Comment model includes a non-null author relation (User) — we
// surface author display info (name, role, avatarColor) on every comment so
// the frontend can render avatars without a second round-trip.

import { NextResponse } from 'next/server';
import type { Conversation as PrismaConversation, Comment as PrismaComment, User } from '@prisma/client';

export type CommentVisibility = 'CUSTOMER_VISIBLE' | 'INTERNAL';
export type ConversationEntityType = 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT';

export interface CommentAuthor {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
  title: string | null;
}

export interface Comment {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  author?: CommentAuthor;
  visibility: CommentVisibility;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface Conversation {
  id: string;
  entityType: ConversationEntityType;
  entityId: string;
  serviceCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
}

// Prisma include shape used by every conversation fetch so the serializer
// can rely on the comments + author relations being present.
export const CONVERSATION_INCLUDE = {
  comments: {
    include: { author: true },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

export type ConversationWithComments = PrismaConversation & {
  comments: (PrismaComment & { author: User })[];
};

function serializeAuthor(u: User): CommentAuthor {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    avatarColor: u.avatarColor,
    title: u.title,
  };
}

export function serializeComment(c: PrismaComment & { author?: User }): Comment {
  return {
    id: c.id,
    conversationId: c.conversationId,
    authorId: c.authorId,
    authorName: c.authorName,
    author: c.author ? serializeAuthor(c.author) : undefined,
    visibility: c.visibility as CommentVisibility,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
  };
}

export function serializeConversation(conv: ConversationWithComments): Conversation {
  return {
    id: conv.id,
    entityType: conv.entityType as ConversationEntityType,
    entityId: conv.entityId,
    serviceCustomerId: conv.serviceCustomerId,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    comments: conv.comments.map(serializeComment),
  };
}

/**
 * Convert errors thrown by auth helpers (UNAUTHORIZED / FORBIDDEN) or
 * hand-rolled validation errors (NOT_FOUND, CONFLICT, INVALID_*) into
 * NextResponse objects with proper status codes.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err.message === 'CONFLICT') {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 });
    }
    if (err.message.startsWith('INVALID_')) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ---- shared domain validators ----
export const VALID_ENTITY_TYPES = new Set<ConversationEntityType>([
  'TICKET',
  'DEMAND',
  'CHANGE',
  'PROBLEM',
  'SLA_EVENT',
]);

export function asEntityType(v: unknown): ConversationEntityType | null {
  return typeof v === 'string' && VALID_ENTITY_TYPES.has(v as ConversationEntityType)
    ? (v as ConversationEntityType)
    : null;
}
