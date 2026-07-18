import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/hand-to-ce
// ACCEPTED → IN_CHANGE.
// Creates a Change (type NORMAL, originType DEMAND, originDemandId, affectedServiceIds
// from demand.relatedServiceIds, status REQUESTED, implementationPlan from body or default),
// creates a ProcessHandover (type CM_TO_CE, sourceDemandId, targetChangeId),
// sets demand.changeRequestId + status IN_CHANGE + handedToCeAt.
// Role: SCM_WORKER (or CM_LEADER).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (demand.status !== 'ACCEPTED') {
      return NextResponse.json(
        { error: `Demand must be ACCEPTED to hand to CE (current: ${demand.status})` },
        { status: 409 },
      );
    }

    // SCM scoping.
    if (
      session.role === 'SCM_WORKER' &&
      demand.assignedScmWorkerId !== null &&
      demand.assignedScmWorkerId !== session.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If a change already exists for this demand, refuse to create a duplicate.
    if (demand.changeRequestId) {
      return NextResponse.json(
        { error: 'Demand already has an associated change request' },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));

    // affectedServiceIds: prefer body (SCM specifies at handover), else demand.relatedServiceIds.
    let affectedServiceIds: string[] = [];
    if (Array.isArray(body.affectedServiceIds) && body.affectedServiceIds.length > 0) {
      affectedServiceIds = body.affectedServiceIds.map(String).filter(Boolean);
    } else {
      try {
        affectedServiceIds = demand.relatedServiceIds ? JSON.parse(demand.relatedServiceIds) : [];
      } catch {
        affectedServiceIds = [];
      }
    }
    if (affectedServiceIds.length === 0) {
      return NextResponse.json(
        { error: 'Cannot hand to CE — at least one affected service must be specified. Provide affectedServiceIds in the request body or set relatedServiceIds on the demand.' },
        { status: 400 },
      );
    }

    const implementationPlan =
      typeof body.implementationPlan === 'string' && body.implementationPlan.trim()
        ? body.implementationPlan.trim()
        : `Implement changes to fulfill demand "${demand.title}". Coordinate with CE for assessment, planning, implementation and verification.`;

    const complexity =
      typeof body.complexity === 'string' &&
      ['SIMPLE', 'MEDIUM', 'COMPLEX'].includes(body.complexity)
        ? body.complexity
        : 'MEDIUM';

    // Run as a transaction so we never end up with a half-created handover.
    await db.$transaction(async (tx) => {
      const change = await tx.change.create({
        data: {
          title: `Change for demand: ${demand.title}`,
          type: 'NORMAL',
          status: 'REQUESTED',
          complexity,
          originType: 'DEMAND',
          originDemandId: demand.id,
          affectedServiceIds: JSON.stringify(affectedServiceIds),
          implementationPlan,
          technicalOwnerTasksJson: JSON.stringify([]),
        },
      });

      const handover = await tx.processHandover.create({
        data: {
          type: 'CM_TO_CE',
          sourceDemandId: demand.id,
          targetChangeId: change.id,
        },
      });

      await tx.demand.update({
        where: { id: demand.id },
        data: {
          status: 'IN_CHANGE',
          changeRequestId: change.id,
          handedToCeAt: new Date(),
        },
      });

      await tx.demandEvent.create({
        data: {
          demandId: demand.id,
          eventType: 'HANDED_TO_CE',
          actorId: session.id,
          actorName: session.name,
          notes: `Handed to CE. Change ${change.id} created (status REQUESTED). Handover ${handover.id} (CM_TO_CE).`,
        },
      });
    });

    // Re-fetch with all relations for the response.
    const fresh = await db.demand.findUnique({
      where: { id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
