import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/demands/[id] — full demand with events (desc), change, relations.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole(
      'SERVICE_CUSTOMER' as Role,
      'SCM_WORKER' as Role,
      'CM_LEADER' as Role,
      'SERVICE_OWNER' as Role,
    );
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id }, include: DEMAND_INCLUDE });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Scoping enforcement.
    if (session.role === 'SERVICE_CUSTOMER') {
      if (demand.serviceCustomerId !== session.orgNodeId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.role === 'SCM_WORKER') {
      // SCM workers can see if assigned to them or unassigned.
      if (
        demand.assignedScmWorkerId !== null &&
        demand.assignedScmWorkerId !== session.id
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    // CM_LEADER and SERVICE_OWNER: no scoping restriction.

    return NextResponse.json(serializeDemand(demand as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/demands/[id] — update editable fields (assignedScmWorkerId,
// estimatedEffortDays, estimatedCost, quoteNotes, commitmentNotes).
// Role: SCM_WORKER or CM_LEADER.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // SCM scoping: must be assigned (or unassigned — allow claim via patch).
    if (
      session.role === 'SCM_WORKER' &&
      demand.assignedScmWorkerId !== null &&
      demand.assignedScmWorkerId !== session.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (body.assignedScmWorkerId !== undefined) {
      // Allow null (unassign) or a valid user id with role SCM_WORKER/CM_LEADER.
      const v = body.assignedScmWorkerId;
      if (v === null) {
        data.assignedScmWorkerId = null;
      } else if (typeof v === 'string' && v.trim()) {
        const user = await db.user.findUnique({ where: { id: v } });
        if (!user) {
          return NextResponse.json({ error: 'Assigned user not found' }, { status: 400 });
        }
        if (user.role !== 'SCM_WORKER' && user.role !== 'CM_LEADER') {
          return NextResponse.json(
            { error: 'Assigned user must be an SCM Worker or CM Leader' },
            { status: 400 },
          );
        }
        data.assignedScmWorkerId = v;
      }
    }
    if (body.estimatedEffortDays !== undefined) {
      const v = body.estimatedEffortDays;
      if (v === null) {
        data.estimatedEffortDays = null;
      } else if (typeof v === 'number' && v >= 0) {
        data.estimatedEffortDays = v;
      } else if (typeof v === 'string' && v.trim() && !isNaN(Number(v))) {
        data.estimatedEffortDays = Number(v);
      } else {
        return NextResponse.json(
          { error: 'estimatedEffortDays must be a non-negative number' },
          { status: 400 },
        );
      }
    }
    if (body.estimatedCost !== undefined) {
      const v = body.estimatedCost;
      if (v === null) {
        data.estimatedCost = null;
      } else if (typeof v === 'number' && v >= 0) {
        data.estimatedCost = v;
      } else if (typeof v === 'string' && v.trim() && !isNaN(Number(v))) {
        data.estimatedCost = Number(v);
      } else {
        return NextResponse.json(
          { error: 'estimatedCost must be a non-negative number' },
          { status: 400 },
        );
      }
    }
    if (body.quoteNotes !== undefined) {
      data.quoteNotes =
        typeof body.quoteNotes === 'string' ? body.quoteNotes || null : null;
    }
    if (body.commitmentNotes !== undefined) {
      data.commitmentNotes =
        typeof body.commitmentNotes === 'string' ? body.commitmentNotes || null : null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields provided' },
        { status: 400 },
      );
    }

    const updated = await db.demand.update({
      where: { id },
      data,
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(updated as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
