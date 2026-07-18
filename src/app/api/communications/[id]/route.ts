import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeCommunication, errorResponse } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/communications/[id] — single communication record.
// Role scoping: same as list.
//   SERVICE_CUSTOMER → only TO_CUSTOMER comms for their orgNode.
//   SCM_WORKER       → only comms they authored OR on their assigned demands
//                      / their assigned customers.
//   CM_LEADER / SERVICE_OWNER → all.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const row = await db.communication.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (session.role === 'SERVICE_CUSTOMER') {
      if (
        row.direction !== 'TO_CUSTOMER' ||
        !session.orgNodeId ||
        row.serviceCustomerId !== session.orgNodeId
      ) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    } else if (session.role === 'SCM_WORKER') {
      const isAuthor = row.authorId === session.id;
      let canSee = isAuthor;
      if (!canSee && row.demandId) {
        const d = await db.demand.findUnique({
          where: { id: row.demandId },
          select: { assignedScmWorkerId: true, serviceCustomerId: true },
        });
        if (d && d.assignedScmWorkerId === session.id) canSee = true;
      }
      if (!canSee && row.serviceCustomerId) {
        const count = await db.demand.count({
          where: {
            assignedScmWorkerId: session.id,
            serviceCustomerId: row.serviceCustomerId,
          },
        });
        if (count > 0) canSee = true;
      }
      if (!canSee) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    return NextResponse.json(serializeCommunication(row));
  } catch (err) {
    return errorResponse(err);
  }
}
