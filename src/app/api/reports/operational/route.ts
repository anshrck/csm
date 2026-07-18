import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  computeOperationalReport,
  parseRange,
  type OperationalReport,
} from '../_compute';

export const runtime = 'nodejs';

/**
 * GET /api/reports/operational
 *
 * Operational analytics for the CSM platform. Combines data from Ticket,
 * SlaClock, SlaEvent, Demand, User, and SatisfactionSurvey tables into a
 * single response (Phase 3 item 10 + Phase 10 item 23).
 *
 * Query params:
 *   from  — ISO date (inclusive) applied to createdAt / startedAt / metAt
 *   to    — ISO date (inclusive) applied to createdAt / startedAt / metAt
 *
 * Sections (all returned in one response):
 *   - ticketVolume       : by customer / service / priority (groupby counts)
 *   - slaCompliance      : per-service MET / (MET + BREACHED) * 100
 *   - avgResponseTimeMins: avg minutes startedAt → metAt for RESPONSE clocks (MET)
 *   - avgResolutionTimeMins: avg minutes startedAt → metAt for RESOLUTION clocks (MET)
 *   - backlogAging       : active tickets grouped by age buckets
 *                          (0-1d, 1-3d, 3-7d, 7-14d, 14d+)
 *   - reopenRate         : reopened tickets / total closed * 100
 *   - csatTrend          : avg rating from SatisfactionSurvey by ISO week
 *   - workerWorkload     : active ticket + demand counts per SCM worker
 *   - demandConversion   : demands that reached IN_CHANGE / total demands
 *
 * Role scoping (per the P3-SLA task contract):
 *   - CM_LEADER, SERVICE_OWNER → all tenant data
 *   - SCM_WORKER              → tickets assigned to them, demands assigned to them
 *   - SERVICE_CUSTOMER        → tickets/demands for their orgNode only
 *
 * Response: OperationalReport (see `_compute.ts` for the exact shape).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const range = parseRange(req.nextUrl.searchParams);
  const report: OperationalReport = await computeOperationalReport(session, range);
  return NextResponse.json(report);
}
