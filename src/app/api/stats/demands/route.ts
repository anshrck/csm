import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeDemands } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/demands
 *
 * Demand-domain operational stats for the caller's role scope:
 *   - byStatus:         Record<DemandStatus, count>
 *   - pipeline:         array of { status, count }
 *   - pendingApprovals: UNDER_REVIEW demands with quote fields filled but
 *                       quoteApprovedByCmLeader=false
 *   - awaitingCustomer: QUOTED count
 *   - inChange:         IN_CHANGE count
 *   - fulfilled:        FULFILLED count
 *   - avgCycleDays:     average days from createdAt → closedAt for CLOSED demands
 *
 * Role scoping:
 *   SERVICE_CUSTOMER → own orgNode demands
 *   SCM_WORKER       → assigned-to-me + unassigned + assigned customer orgs
 *   CM_LEADER        → all tenant demands
 *   SERVICE_OWNER    → demands touching owned services
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeDemands(scope);
  return NextResponse.json(result);
}
