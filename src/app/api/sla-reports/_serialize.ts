// Shared helpers for the sla-reports API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.
//
// The SlaReport model stores serviceIds / serviceCustomerIds / metricsJson as
// JSON-string columns and preparedById / reviewedByCmLeaderId as plain String
// foreign keys (no Prisma relation). On read we parse the JSON columns and
// resolve the user display names via an in-memory map.
//
// All Date fields are returned as ISO strings.

import { NextResponse } from 'next/server';
import type { SlaReport as PrismaSlaReport } from '@prisma/client';
import { db } from '@/lib/db';

export type SlaReportStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'RETURNED' | 'ISSUED';

export interface SlaReport {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  serviceIds: string[];
  serviceCustomerIds: string[];
  preparedById: string;
  preparedByName: string | null;
  reviewedByCmLeaderId: string | null;
  reviewedByCmLeaderName: string | null;
  status: SlaReportStatus;
  summary: string;
  metricsJson: unknown;
  reviewNotes: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function safeParseJson(raw: string | null | undefined, fallback: unknown): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeParseArray(raw: string | null | undefined): string[] {
  const parsed = safeParseJson(raw, []);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export type UserMap = Record<string, string>;

/**
 * Serialize a SlaReport Prisma row.
 *
 * @param row        The Prisma SlaReport row.
 * @param userMap    Optional map of { userId → name } used to resolve
 *                   preparedByName and reviewedByCmLeaderName.
 */
export function serializeSlaReport(
  row: PrismaSlaReport,
  userMap: UserMap = {},
): SlaReport {
  return {
    id: row.id,
    title: row.title,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    serviceIds: safeParseArray(row.serviceIds),
    serviceCustomerIds: safeParseArray(row.serviceCustomerIds),
    preparedById: row.preparedById,
    preparedByName: userMap[row.preparedById] ?? null,
    reviewedByCmLeaderId: row.reviewedByCmLeaderId,
    reviewedByCmLeaderName: row.reviewedByCmLeaderId
      ? (userMap[row.reviewedByCmLeaderId] ?? null)
      : null,
    status: row.status as SlaReportStatus,
    summary: row.summary,
    metricsJson: safeParseJson(row.metricsJson, {}),
    reviewNotes: row.reviewNotes,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Bulk-lookup display names for a set of user ids.
 */
export async function buildUserMap(ids: string[]): Promise<UserMap> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};
  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const map: UserMap = {};
  for (const u of users) map[u.id] = u.name;
  return map;
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
