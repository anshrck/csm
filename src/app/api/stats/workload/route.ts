import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeWorkload } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/workload
 *
 * Workload distribution stats — primarily for CM_LEADER oversight:
 *   - byWorker:        array of { workerId, workerName, activeTickets,
 *                                   activeDemands, slaRisk, openP1 }
 *   - byGroup:         array of { groupId, groupName, activeTickets }
 *   - unassignedCount: count of open tickets with no assignee
 *   - overdueCount:    count of tickets with at least one BREACHED SlaClock
 *
 * Returns empty arrays for non-CM_LEADER roles — workload oversight requires
 * tenant-wide visibility.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeWorkload(scope);
  return NextResponse.json(result);
}
