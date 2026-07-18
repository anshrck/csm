// Shared serializer for the Knowledge Article API routes.
//
// The Prisma `KnowledgeArticle` row carries `serviceId`, `authorId`,
// `reviewerId` foreign keys (the last two are Prisma relations to User). To
// keep the response shape self-contained, we resolve the related service +
// author + reviewer names here so the UI doesn't have to fan out extra
// requests.

import { NextResponse } from 'next/server';
import type { KnowledgeArticle, Service, User } from '@prisma/client';

export interface KnowledgeArticleWithRelations extends KnowledgeArticle {
  service: Service | null;
  author: User;
  reviewer: User | null;
}

export interface SerializedKnowledgeArticle {
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

export function serializeKnowledgeArticle(
  row: KnowledgeArticleWithRelations,
): SerializedKnowledgeArticle {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    status: row.status,
    serviceId: row.serviceId,
    serviceName: row.service?.name ?? null,
    authorId: row.authorId,
    authorName: row.author?.name ?? 'Unknown',
    reviewerId: row.reviewerId,
    reviewerName: row.reviewer?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

// Lightweight shape used by the list/search endpoints — excludes the full
// markdown body so we don't ship 100KB of markdown for a search dropdown.
export interface KnowledgeArticleSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  serviceId: string | null;
  serviceName: string | null;
  authorName: string;
  updatedAt: string;
  publishedAt: string | null;
  // Short text snippet derived from the markdown body (first ~160 chars with
  // markdown syntax stripped). Used by the search-result list.
  snippet: string;
}

export function summarizeKnowledgeArticle(
  row: KnowledgeArticleWithRelations,
  snippetLength = 160,
): KnowledgeArticleSummary {
  const plain = row.body
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: keep text
    .replace(/[#>*_~\-]+/g, ' ') // markdown syntax chars
    .replace(/\s+/g, ' ')
    .trim();
  const snippet = plain.length > snippetLength ? plain.slice(0, snippetLength) + '…' : plain;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    serviceId: row.serviceId,
    serviceName: row.service?.name ?? null,
    authorName: row.author?.name ?? 'Unknown',
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    snippet,
  };
}

// Convert errors thrown by auth helpers (or thrown manually) to JSON responses.
// Mirrors the convention used by the demands API.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      err.message.startsWith('INVALID_') ||
      err.message === 'NOT_FOUND' ||
      err.message === 'CONFLICT'
    ) {
      const status = err.message === 'NOT_FOUND' ? 404 : err.message === 'CONFLICT' ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// Prisma include shape that the serializer relies on.
export const KNOWLEDGE_INCLUDE = {
  service: true,
  author: true,
  reviewer: true,
} as const;
