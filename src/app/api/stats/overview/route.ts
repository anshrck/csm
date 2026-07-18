import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeOverview } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/overview
 *
 * Blended operational snapshot for the caller's role scope:
 *   - totalOpenTickets, totalActiveDemands
 *   - slaBreaches, slaWarnings
 *   - avgCsat
 *   - reopenRate
 *   - workloadByWorker (top 5; CM_LEADER only — others get [])
 *
 * Role scoping:
 *   SERVICE_CUSTOMER → own orgNode
 *   SCM_WORKER       → assigned customer orgs
 *   CM_LEADER        → all tenant
 *   SERVICE_OWNER    → services they own (+ customers consuming those services)
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeOverview(scope);
  return NextResponse.json(result);
}
