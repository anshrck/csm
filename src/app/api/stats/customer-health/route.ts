import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeCustomerHealth } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/customer-health
 *
 * Per-customer health scorecard (CM_LEADER, SERVICE_OWNER primarily):
 *   - byCustomer: array of {
 *       orgNodeId, orgNodeName, openTickets, activeDemands, slaBreaches,
 *       avgCsat, healthScore, health  // 'green' | 'amber' | 'red'
 *     }
 *
 * healthScore = slaScore * 0.6 + csatScore * 0.4
 *   slaScore  = 100 - min(100, breaches * 10)        (each breach -10)
 *   csatScore = avgCsat == null ? 75 : avgCsat/5*100 (null → neutral 75)
 *   Green >=80, Amber 60-80, Red <60.
 *
 * Role scoping:
 *   CM_LEADER        → all customer orgs
 *   SERVICE_OWNER    → only customers consuming their services
 *   SCM_WORKER       → assigned customer orgs
 *   SERVICE_CUSTOMER → their own orgNode (single entry)
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeCustomerHealth(scope);
  return NextResponse.json(result);
}
