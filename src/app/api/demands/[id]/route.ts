import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/demands/[id] — full demand with events (desc), change, relations.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const demand = await db.demand.findFirst({ where: { id, tenantId }, include: DEMAND_INCLUDE });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Scoping & permission enforcement.
    const allowed = await authorize(session, { resource: 'demand', action: 'read', recordId: id });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json(serializeDemand(demand as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/demands/[id] — update editable fields.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const demand = await db.demand.findFirst({ where: { id, tenantId } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));

    const allowed = await authorize(session, {
      resource: 'demand',
      action: 'update',
      recordId: id,
      requestedChanges: body,
      workflowState: demand.status,
    });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data: Record<string, unknown> = {};

    if (body.assignedScmWorkerId !== undefined) {
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
