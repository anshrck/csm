import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/demands/[id]/accept
// QUOTED → ACCEPTED. Customer accepts the quote.
// Caller must be SERVICE_CUSTOMER and a member of the demand's org node.
// Notifies the assigned SCM worker (DemandAccepted).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role !== 'SERVICE_CUSTOMER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const demand = await db.demand.findUnique({ where: { id } });
    if (!demand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (demand.serviceCustomerId !== session.orgNodeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (demand.status !== 'QUOTED') {
      return NextResponse.json(
        { error: `Demand must be QUOTED to accept (current: ${demand.status})` },
        { status: 409 },
      );
    }

    const updated = await db.demand.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
      include: DEMAND_INCLUDE,
    });

    await db.demandEvent.create({
      data: {
        demandId: id,
        eventType: 'ACCEPTED',
        actorId: session.id,
        actorName: session.name,
        notes: `Quote accepted by customer (${session.name}).`,
      },
    });

    // Notify the assigned SCM worker (if any). Fallback to all SCM workers if
    // somehow unassigned.
    if (demand.assignedScmWorkerId) {
      await db.notification.create({
        data: {
          userId: demand.assignedScmWorkerId,
          type: 'DemandAccepted',
          title: 'Demand accepted by customer',
          message: `The customer accepted your quote for "${demand.title}". You can now hand it to CE.`,
          entityRef: `demand:${id}`,
        },
      });
    } else {
      const scmWorkers = await db.user.findMany({ where: { role: 'SCM_WORKER' } });
      if (scmWorkers.length) {
        await db.notification.createMany({
          data: scmWorkers.map((u) => ({
            userId: u.id,
            type: 'DemandAccepted',
            title: 'Demand accepted by customer',
            message: `The customer accepted the quote for "${demand.title}".`,
            entityRef: `demand:${id}`,
          })),
        });
      }
    }

    const fresh = await db.demand.findUnique({
      where: { id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations));
  } catch (err) {
    return errorResponse(err);
  }
}
