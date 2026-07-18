import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveStatsScope, computeTickets } from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/stats/tickets
 *
 * Ticket-domain operational stats for the caller's role scope:
 *   - byStatus:        Record<TicketStatus, count>
 *   - byPriority:      Record<P1|P2|P3|P4, count>
 *   - byType:          Record<INCIDENT|SERVICE_REQUEST|QUESTION|COMPLAINT, count>
 *   - unassigned:      count
 *   - waitingCustomer: count
 *   - reopened:        count (tickets with a REOPENED TicketEvent)
 *   - avgResolutionMins: average RESOLUTION SlaClock (metAt - startedAt)
 *   - slaBreached:     count of tickets with at least one BREACHED SlaClock
 *   - aging:           { '0-1d', '1-3d', '3-7d', '7-14d', '14d+' }
 *
 * Role scoping:
 *   SERVICE_CUSTOMER → own orgNode tickets
 *   SCM_WORKER       → assigned-to-me + unassigned + assigned customer orgs
 *   CM_LEADER        → all tenant tickets
 *   SERVICE_OWNER    → tickets on owned services
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const scope = await resolveStatsScope(session);
  const result = await computeTickets(scope);
  return NextResponse.json(result);
}
