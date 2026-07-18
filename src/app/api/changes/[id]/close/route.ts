import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/changes/[id]/close — VERIFICATION → CLOSED
// Sets closedAt + catalogUpdatedAt to now. If originDemandId is set:
//   - update that Demand to FULFILLED (fulfilledAt = now)
//   - create a DemandEvent (FULFILLED, actorName = caller.name, notes 'Change closed by CE.')
//   - create a Notification (ChangeClosed) to the demand's submitter (the customer)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  const existing = await db.change.findUnique({
    where: { id },
    include: { originDemand: { select: { id: true, title: true, submittedById: true } } },
  });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status !== 'VERIFICATION') {
    return NextResponse.json(
      { error: `Change must be in VERIFICATION state (current: ${existing.status})` },
      { status: 409 },
    );
  }

  const now = new Date();

  // Update the change to CLOSED.
  const updated = await db.change.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: now, catalogUpdatedAt: now },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  // If this change originated from a demand, mark the demand FULFILLED and notify the customer.
  if (existing.originDemandId && existing.originDemand) {
    const demand = existing.originDemand;
    await db.demand.update({
      where: { id: demand.id },
      data: { status: 'FULFILLED', fulfilledAt: now },
    });
    await db.demandEvent.create({
      data: {
        demandId: demand.id,
        eventType: 'FULFILLED',
        actorId: session.id,
        actorName: session.name,
        notes: 'Change closed by CE.',
        createdAt: now,
      },
    });
    if (demand.submittedById) {
      await db.notification.create({
        data: {
          userId: demand.submittedById,
          type: 'ChangeClosed',
          title: 'Change completed — demand fulfilled',
          message: `Change "${updated.title}" has been closed. Your demand "${demand.title}" is now fulfilled — please review and close.`,
          entityRef: `change:${updated.id}`,
          createdAt: now,
        },
      });
    }
  }

  return NextResponse.json(serializeChange(updated));
}
