// Helper to serialize a Prisma Change row (with optional relations) into the API Change shape.
// Parses JSON-string columns (affectedServiceIds, technicalOwnerTasksJson) and converts Dates to ISO strings.

import type { Change } from '@/lib/types';

type CeWorkerSelect = { id: string; name: string } | null;

export type ChangeWithRelations = {
  id: string;
  title: string;
  type: string;
  status: string;
  complexity: string | null;
  originType: string;
  originDemandId: string | null;
  originProblemId: string | null;
  affectedServiceIds: string;
  implementationPlan: string | null;
  technicalOwnerTasksJson: string;
  assignedCeWorkerId: string | null;
  assignedCeLeaderId: string | null;
  rejectionReason: string | null;
  verificationNotes: string | null;
  catalogUpdatedAt: Date | null;
  isEmergencyPostReviewDue: boolean;
  postImplementationReview: string | null;
  approvalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  ceWorker?: CeWorkerSelect;
};

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function serializeChange(c: ChangeWithRelations): Change {
  return {
    id: c.id,
    title: c.title,
    type: c.type as Change['type'],
    status: c.status as Change['status'],
    complexity: c.complexity as Change['complexity'],
    originType: c.originType as Change['originType'],
    originDemandId: c.originDemandId,
    originProblemId: c.originProblemId,
    affectedServiceIds: safeParse<string[]>(c.affectedServiceIds, []),
    implementationPlan: c.implementationPlan,
    technicalOwnerTasksJson: safeParse<any[]>(c.technicalOwnerTasksJson, []),
    assignedCeWorkerId: c.assignedCeWorkerId,
    assignedCeWorkerName: c.ceWorker?.name ?? undefined,
    rejectionReason: c.rejectionReason,
    verificationNotes: c.verificationNotes,
    catalogUpdatedAt: c.catalogUpdatedAt ? c.catalogUpdatedAt.toISOString() : null,
    isEmergencyPostReviewDue: c.isEmergencyPostReviewDue,
    postImplementationReview: c.postImplementationReview,
    approvalNotes: c.approvalNotes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    closedAt: c.closedAt ? c.closedAt.toISOString() : null,
  };
}

// Shared auth-error helper for API routes that use requireRole (throws 'UNAUTHORIZED' | 'FORBIDDEN').
import { NextResponse } from 'next/server';

export function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Internal error';
  if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}
