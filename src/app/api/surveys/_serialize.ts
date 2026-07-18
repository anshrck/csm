// Shared helpers for the surveys (CSAT) API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { NextResponse } from 'next/server';
import type { SatisfactionSurvey as PrismaSurvey, User } from '@prisma/client';

export type SurveyEntityType = 'TICKET' | 'DEMAND';

export interface SurveyCustomer {
  id: string;
  name: string;
  orgNodeName: string | null;
}

export interface SatisfactionSurvey {
  id: string;
  entityType: SurveyEntityType;
  entityId: string;
  customerId: string;
  customerName?: string;
  rating: number; // 1-5
  comment: string | null;
  createdAt: string;
}

export const SURVEY_INCLUDE = { customer: true } as const;
export type SurveyWithCustomer = PrismaSurvey & { customer: User };

export const VALID_SURVEY_ENTITY_TYPES = new Set<SurveyEntityType>(['TICKET', 'DEMAND']);

export function asSurveyEntityType(v: unknown): SurveyEntityType | null {
  return typeof v === 'string' && VALID_SURVEY_ENTITY_TYPES.has(v as SurveyEntityType)
    ? (v as SurveyEntityType)
    : null;
}

export function serializeSurvey(s: PrismaSurvey & { customer?: User }): SatisfactionSurvey {
  return {
    id: s.id,
    entityType: s.entityType as SurveyEntityType,
    entityId: s.entityId,
    customerId: s.customerId,
    customerName: s.customer?.name,
    rating: s.rating,
    comment: s.comment,
    createdAt: s.createdAt.toISOString(),
  };
}

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
