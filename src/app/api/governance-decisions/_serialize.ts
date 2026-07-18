// Shared helpers for the governance-decisions API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.
//
// The GovernanceDecision model has no JSON-string columns. The decidedById
// column is a plain String foreign key (no Prisma relation) but the
// decidedByName is stored alongside it, so no extra lookup is required.
// The followUpDate column is a nullable DateTime that must be ISO-converted.

import { NextResponse } from 'next/server';
import type { GovernanceDecision as PrismaGovernanceDecision } from '@prisma/client';

export type GovernanceDecisionType =
  | 'COMMITMENT_APPROVAL'
  | 'COMMITMENT_ESCALATION'
  | 'BREACH_RESPONSE'
  | 'LIFECYCLE_DIRECTION'
  | 'CATALOG_ACCURACY';

export type GovernanceDecisionValue =
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'REMEDIATION_AUTHORIZED'
  | 'RESOURCES_AUTHORIZED'
  | 'EMERGENCY_CHANGE_DIRECTED';

export interface GovernanceDecision {
  id: string;
  serviceId: string;
  demandId: string | null;
  slaEventId: string | null;
  problemId: string | null;
  decisionType: GovernanceDecisionType;
  decision: GovernanceDecisionValue;
  rationale: string;
  resourcesAuthorized: string | null;
  followUpOwner: string | null;
  followUpDate: string | null;
  decidedById: string;
  decidedByName: string;
  createdAt: string;
}

export function serializeGovernanceDecision(
  row: PrismaGovernanceDecision,
): GovernanceDecision {
  return {
    id: row.id,
    serviceId: row.serviceId,
    demandId: row.demandId,
    slaEventId: row.slaEventId,
    problemId: row.problemId,
    decisionType: row.decisionType as GovernanceDecisionType,
    decision: row.decision as GovernanceDecisionValue,
    rationale: row.rationale,
    resourcesAuthorized: row.resourcesAuthorized,
    followUpOwner: row.followUpOwner,
    followUpDate: row.followUpDate ? row.followUpDate.toISOString() : null,
    decidedById: row.decidedById,
    decidedByName: row.decidedByName,
    createdAt: row.createdAt.toISOString(),
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
