import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeGovernanceDecision, errorResponse } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/governance-decisions/[id] — single governance decision.
// Role scoping: same as list.
//   CM_LEADER        → all.
//   SERVICE_OWNER    → only decisions on services they own.
//   SCM_WORKER       → only decisions whose demandId is one of their assigned
//                      demands.
//   SERVICE_CUSTOMER → not in scope (403).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (session.role === 'SERVICE_CUSTOMER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const row = await db.governanceDecision.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (session.role === 'SERVICE_OWNER') {
      const service = await db.service.findUnique({
        where: { id: row.serviceId },
        select: { serviceOwnerId: true },
      });
      if (!service || service.serviceOwnerId !== session.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    } else if (session.role === 'SCM_WORKER') {
      if (!row.demandId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const demand = await db.demand.findUnique({
        where: { id: row.demandId },
        select: { assignedScmWorkerId: true },
      });
      if (!demand || demand.assignedScmWorkerId !== session.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
    // CM_LEADER: no extra scoping.

    return NextResponse.json(serializeGovernanceDecision(row));
  } catch (err) {
    return errorResponse(err);
  }
}
