import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorResponse } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/surveys/stats
// Returns aggregate CSAT statistics for the caller's scope.
//
// Response shape:
//   {
//     count: number,
//     average: number | null,
//     distribution: { 1: n, 2: n, 3: n, 4: n, 5: n },
//     trend: [{ weekStart: ISO, count: n, average: number, sum: n }],
//     byEntityType: { TICKET: {...}, DEMAND: {...} },
//     lowRatingCount: number,        // ratings <= 2
//     detractorCount: number,        // ratings <= 2
//     promoterCount: number,         // ratings >= 4
//     nps: number | null             // (promoters - detractors) / count * 100
//   }
//
// Role scoping:
//   CM_LEADER     → all surveys in tenant.
//   SERVICE_OWNER → surveys for entities tied to owned services.
//   (others)      → 403.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (session.role !== 'CM_LEADER' && session.role !== 'SERVICE_OWNER') {
      return NextResponse.json(
        { error: 'Forbidden — only CM Leader and Service Owner can view CSAT stats' },
        { status: 403 },
      );
    }

    const sp = req.nextUrl.searchParams;
    const entityTypeFilter = sp.get('entityType'); // optional

    // Build the survey scope (mirrors GET /api/surveys).
    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;
    if (entityTypeFilter === 'TICKET' || entityTypeFilter === 'DEMAND') {
      and.push({ entityType: entityTypeFilter });
    }

    if (session.role === 'SERVICE_OWNER') {
      const ownedServices = await db.service.findMany({
        where: { serviceOwnerId: session.id },
        select: { id: true },
      });
      const ownedServiceIds = ownedServices.map((s) => s.id);

      if (ownedServiceIds.length === 0) {
        return NextResponse.json(emptyStats());
      }

      // Find demands related to owned services via JSON column.
      const candidateDemands = await db.demand.findMany({
        select: { id: true, relatedServiceIds: true },
      });
      const demandIds = candidateDemands
        .filter((d) => {
          try {
            const ids: string[] = JSON.parse(d.relatedServiceIds || '[]');
            return ids.some((sid) => ownedServiceIds.includes(sid));
          } catch {
            return false;
          }
        })
        .map((d) => d.id);

      const tickets = await db.ticket.findMany({
        where: { serviceId: { in: ownedServiceIds } },
        select: { id: true },
      });
      const ticketIds = tickets.map((t) => t.id);

      const orClauses: Array<Record<string, unknown>> = [];
      if (demandIds.length) {
        orClauses.push({ entityType: 'DEMAND', entityId: { in: demandIds } });
      }
      if (ticketIds.length) {
        orClauses.push({ entityType: 'TICKET', entityId: { in: ticketIds } });
      }
      if (orClauses.length === 0) {
        return NextResponse.json(emptyStats());
      }
      and.push({ OR: orClauses });
    }
    // CM_LEADER → no extra scoping.

    if (and.length === 0) delete where.AND;

    const rows = await db.satisfactionSurvey.findMany({
      where,
      select: {
        rating: true,
        entityType: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });

    if (rows.length === 0) {
      return NextResponse.json(emptyStats());
    }

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byEntityType: Record<string, { count: number; sum: number; average: number }> = {
      TICKET: { count: 0, sum: 0, average: 0 },
      DEMAND: { count: 0, sum: 0, average: 0 },
    };
    const trendMap = new Map<string, { count: number; sum: number }>();

    let sum = 0;
    let lowRatingCount = 0;
    let promoterCount = 0;
    let detractorCount = 0;

    for (const r of rows) {
      const rating = r.rating;
      distribution[rating] = (distribution[rating] ?? 0) + 1;
      sum += rating;
      if (rating <= 2) {
        lowRatingCount++;
        detractorCount++;
      }
      if (rating >= 4) promoterCount++;

      const bucket = byEntityType[r.entityType];
      if (bucket) {
        bucket.count++;
        bucket.sum += rating;
      }

      // ISO week start (Monday) — computed in UTC.
      const weekStart = isoWeekStart(r.createdAt);
      const prev = trendMap.get(weekStart) ?? { count: 0, sum: 0 };
      prev.count++;
      prev.sum += rating;
      trendMap.set(weekStart, prev);
    }

    const count = rows.length;
    const average = count > 0 ? Number((sum / count).toFixed(2)) : null;
    for (const bucket of Object.values(byEntityType)) {
      bucket.average = bucket.count > 0 ? Number((bucket.sum / bucket.count).toFixed(2)) : 0;
    }

    const trend = Array.from(trendMap.entries())
      .map(([weekStart, v]) => ({
        weekStart,
        count: v.count,
        sum: v.sum,
        average: Number((v.sum / v.count).toFixed(2)),
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    const nps = count > 0 ? Number((((promoterCount - detractorCount) / count) * 100).toFixed(0)) : null;

    return NextResponse.json({
      count,
      average,
      distribution,
      trend,
      byEntityType,
      lowRatingCount,
      detractorCount,
      promoterCount,
      nps,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// --- helpers ---

function emptyStats() {
  return {
    count: 0,
    average: null,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    trend: [],
    byEntityType: {
      TICKET: { count: 0, sum: 0, average: 0 },
      DEMAND: { count: 0, sum: 0, average: 0 },
    },
    lowRatingCount: 0,
    detractorCount: 0,
    promoterCount: 0,
    nps: null,
  };
}

// Returns the ISO-8601 week-start date (Monday) in `YYYY-MM-DD` form.
function isoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}
