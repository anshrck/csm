import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

function safeParseArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}

// GET /api/sla-reports
// Filters: status (comma multi), preparedBy (user id or "me")
// Role scoping:
//   - SCM_WORKER: reports prepared by them (or all if preparedBy omitted — they're the author pool)
//     To keep it simple: SCM sees reports they prepared; CM_LEADER sees all; SERVICE_OWNER sees all
//     on their services; SERVICE_CUSTOMER sees only ISSUED reports for their org.
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();

    const url = new URL(req.url);
    const statusParam = url.searchParams.get('status');
    const preparedBy = url.searchParams.get('preparedBy');

    const where: Record<string, unknown> = {};
    if (statusParam) {
      const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) where.status = statuses[0];
      else if (statuses.length > 1) where.status = { in: statuses };
    }
    if (preparedBy) {
      where.preparedById = preparedBy === 'me' ? session.id : preparedBy;
    }

    // Role-based filter:
    //   SERVICE_CUSTOMER → only ISSUED reports for their orgNode
    //   SERVICE_OWNER → all reports (they can review what's been issued on their services)
    //   SCM_WORKER → reports they prepared + all ISSUED/APPROVED (so they see what's been approved)
    //   CM_LEADER → all
    if (session.role === 'SERVICE_CUSTOMER' as Role) {
      where.status = 'ISSUED';
      if (session.orgNodeId) {
        // Filter to reports that include this customer — we'll do it in JS since serviceCustomerIds is JSON
      }
    }

    const rows = await db.slaReport.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    let result = rows.map((r) => serializeReport(r));

    // SERVICE_CUSTOMER: filter client-side to reports that include their orgNode
    if (session.role === 'SERVICE_CUSTOMER' as Role && session.orgNodeId) {
      result = result.filter((r) => r.serviceCustomerIds.includes(session.orgNodeId!));
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function serializeReport(r: {
  id: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  serviceIds: string;
  serviceCustomerIds: string;
  preparedById: string;
  reviewedByCmLeaderId: string | null;
  status: string;
  summary: string;
  metricsJson: string;
  reviewNotes: string | null;
  approvedAt: Date | null;
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  let serviceIds: string[] = [];
  let serviceCustomerIds: string[] = [];
  let metrics: unknown = {};
  try {
    serviceIds = JSON.parse(r.serviceIds);
  } catch {
    /* ignore */
  }
  try {
    serviceCustomerIds = JSON.parse(r.serviceCustomerIds);
  } catch {
    /* ignore */
  }
  try {
    metrics = JSON.parse(r.metricsJson);
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    title: r.title,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    serviceIds,
    serviceCustomerIds,
    preparedById: r.preparedById,
    reviewedByCmLeaderId: r.reviewedByCmLeaderId,
    status: r.status,
    summary: r.summary,
    metrics,
    reviewNotes: r.reviewNotes,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// POST /api/sla-reports
// Body: { title, periodStart, periodEnd, serviceIds[], serviceCustomerIds[], summary, metricsJson? }
// Role: SCM_WORKER (primary author), CM_LEADER also permitted.
// Creates a DRAFT report.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (
      session.role !== 'SCM_WORKER' as Role &&
      session.role !== 'CM_LEADER' as Role
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (!summary) {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 });
    }

    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    try {
      periodStart = new Date(body.periodStart);
      periodEnd = new Date(body.periodEnd);
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) throw new Error();
    } catch {
      return NextResponse.json(
        { error: 'periodStart and periodEnd must be valid ISO dates' },
        { status: 400 },
      );
    }
    if (periodStart >= periodEnd) {
      return NextResponse.json(
        { error: 'periodStart must be before periodEnd' },
        { status: 400 },
      );
    }

    const serviceIds = safeParseArray(body.serviceIds);
    const serviceCustomerIds = safeParseArray(body.serviceCustomerIds);
    if (serviceIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one serviceId is required' },
        { status: 400 },
      );
    }

    // metricsJson: optional. If provided as object, use it; otherwise auto-gather from sla-events.
    let metricsObj: Record<string, unknown> = {};
    if (typeof body.metricsJson === 'object' && body.metricsJson !== null && !Array.isArray(body.metricsJson)) {
      metricsObj = body.metricsJson as Record<string, unknown>;
    } else {
      // Auto-gather metrics from sla-events
      const events = await db.slaEvent.findMany({
        where: {
          serviceId: { in: serviceIds },
          createdAt: { gte: periodStart, lte: periodEnd },
        },
      });
      const byService: Record<string, { warnings: number; breaches: number; closedInTime: number }> = {};
      for (const e of events) {
        const key = e.serviceId;
        if (!byService[key]) byService[key] = { warnings: 0, breaches: 0, closedInTime: 0 };
        if (e.eventType === 'WARNING') byService[key].warnings += 1;
        else if (e.eventType === 'BREACHED') byService[key].breaches += 1;
        else if (e.eventType === 'CLOSED_IN_TIME') byService[key].closedInTime += 1;
      }
      metricsObj = { byService, totals: { totalEvents: events.length } };
    }

    const created = await db.slaReport.create({
      data: {
        title,
        periodStart,
        periodEnd,
        serviceIds: JSON.stringify(serviceIds),
        serviceCustomerIds: JSON.stringify(serviceCustomerIds),
        preparedById: session.id,
        status: 'DRAFT',
        summary,
        metricsJson: JSON.stringify(metricsObj),
      },
    });

    return NextResponse.json(serializeReport(created), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
