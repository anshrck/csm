import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeSla } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/sla
 *
 * SLA-domain operational stats for the caller's role scope:
 *   - compliancePct:    (MET / (MET + BREACHED)) * 100 across all SlaClocks
 *   - activeBreaches:   count of BREACHED SlaClocks
 *   - activeWarnings:   count of unresolved SlaEvent WARNING entries
 *   - byService:        per-service compliance + breach/warning breakdown
 *   - avgResponseMins:  average RESPONSE clock metAt - startedAt
 *   - avgResolutionMins: average RESOLUTION clock metAt - startedAt
 *
 * Role scoping:
 *   SERVICE_CUSTOMER → tickets on their own orgNode
 *   SCM_WORKER       → assigned-to-me + unassigned + assigned customer orgs
 *   CM_LEADER        → all tenant clocks/events
 *   SERVICE_OWNER    → tickets on owned services
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeSla(scope);
  return NextResponse.json(result);
}
