// Shared helpers for the demands API routes.
// Filename prefixed with `_` so Next.js does NOT treat it as a route handler.

import { NextResponse } from 'next/server';
import type {
  Demand as PrismaDemand,
  DemandEvent as PrismaDemandEvent,
  Change as PrismaChange,
  User,
  OrgNode,
  ProcessHandover,
} from '@prisma/client';
import type { Demand, DemandEvent, Change } from '@/lib/types';

// Prisma include shape used by every demand fetch so the serializer can rely
// on the relations being present.
export const DEMAND_INCLUDE = {
  customer: true,
  submitter: true,
  scmWorker: true,
  events: { orderBy: { createdAt: 'desc' as const } },
  change: {
    include: {
      handovers: true,
      ceWorker: true,
    },
  },
} as const;

export type DemandWithRelations = PrismaDemand & {
  customer: OrgNode;
  submitter: User;
  scmWorker: User | null;
  events: PrismaDemandEvent[];
  change: (PrismaChange & { handovers: ProcessHandover[]; ceWorker: User | null }) | null;
};

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonAny(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeEvent(e: PrismaDemandEvent): DemandEvent {
  return {
    id: e.id,
    demandId: e.demandId,
    eventType: e.eventType,
    actorId: e.actorId,
    actorName: e.actorName,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeChange(c: PrismaChange & { handovers?: ProcessHandover[]; ceWorker?: User | null }): Change {
  return {
    id: c.id,
    title: c.title,
    type: c.type as Change['type'],
    status: c.status as Change['status'],
    complexity: c.complexity as Change['complexity'],
    originType: c.originType as Change['originType'],
    originDemandId: c.originDemandId,
    originProblemId: c.originProblemId,
    affectedServiceIds: parseJsonArray(c.affectedServiceIds),
    implementationPlan: c.implementationPlan,
    technicalOwnerTasksJson: parseJsonAny(c.technicalOwnerTasksJson),
    assignedCeWorkerId: c.assignedCeWorkerId,
    assignedCeWorkerName: c.ceWorker?.name,
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

export function serializeDemand(d: DemandWithRelations): Demand {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    businessJustification: d.businessJustification,
    desiredTimeline: d.desiredTimeline,
    relatedServiceIds: parseJsonArray(d.relatedServiceIds),
    serviceCustomerId: d.serviceCustomerId,
    serviceCustomerName: d.customer?.name,
    submittedById: d.submittedById,
    submittedByName: d.submitter?.name,
    assignedScmWorkerId: d.assignedScmWorkerId,
    assignedScmWorkerName: d.scmWorker?.name ?? undefined,
    status: d.status as Demand['status'],
    estimatedEffortDays: d.estimatedEffortDays,
    estimatedCost: d.estimatedCost,
    quoteNotes: d.quoteNotes,
    quoteApprovedByCmLeader: d.quoteApprovedByCmLeader,
    quoteApprovedAt: d.quoteApprovedAt ? d.quoteApprovedAt.toISOString() : null,
    commitmentNotes: d.commitmentNotes,
    rejectionReason: d.rejectionReason,
    redirectedToOfferingId: d.redirectedToOfferingId,
    changeRequestId: d.changeRequestId,
    quotedAt: d.quotedAt ? d.quotedAt.toISOString() : null,
    acceptedAt: d.acceptedAt ? d.acceptedAt.toISOString() : null,
    handedToCeAt: d.handedToCeAt ? d.handedToCeAt.toISOString() : null,
    fulfilledAt: d.fulfilledAt ? d.fulfilledAt.toISOString() : null,
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    events: d.events?.map(serializeEvent),
    change: d.change ? serializeChange(d.change) : null,
  };
}

// Convert errors thrown by auth helpers (or thrown manually) to JSON responses.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Surface our own validation errors verbatim.
    if (
      err.message.startsWith('INVALID_') ||
      err.message === 'NOT_FOUND' ||
      err.message === 'CONFLICT'
    ) {
      const status =
        err.message === 'NOT_FOUND' ? 404 : err.message === 'CONFLICT' ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
