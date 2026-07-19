import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeSlaReport, buildUserMap, errorResponse } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/sla-reports/[id] — single report with parsed JSON fields.
// Role scoping: same as list. SERVICE_CUSTOMER may only read ISSUED reports
// whose serviceCustomerIds includes their orgNode. SCM_WORKER may read their
// own drafts/returned or any submitted report. CM_LEADER / SERVICE_OWNER see all.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const row = await db.slaReport.findFirst({ where: { id, tenantId } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const userMap = await buildUserMap(
      [row.preparedById, row.reviewedByCmLeaderId].filter(Boolean) as string[],
    );
    const serialized = serializeSlaReport(row, userMap);

    // Role scoping.
    if (session.role === 'SERVICE_CUSTOMER') {
      const orgId = session.orgNodeId;
      if (!orgId || serialized.status !== 'ISSUED' || !serialized.serviceCustomerIds.includes(orgId)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    } else if (session.role === 'SCM_WORKER') {
      const canSee =
        serialized.preparedById === session.id ||
        ['PENDING_REVIEW', 'APPROVED', 'RETURNED', 'ISSUED'].includes(serialized.status);
      if (!canSee) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    return NextResponse.json(serialized);
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/sla-reports/[id] — update DRAFT (or RETURNED) report fields.
// Role: SCM_WORKER who prepared the report. Status must be DRAFT or RETURNED
// (RETURNED allows the SCM to edit + resubmit after a CM Leader return).
// Body fields (all optional): title, periodStart, periodEnd, serviceIds,
//   serviceCustomerIds, summary, metricsJson.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role !== 'SCM_WORKER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const existing = await db.slaReport.findFirst({ where: { id, tenantId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (existing.preparedById !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (existing.status !== 'DRAFT' && existing.status !== 'RETURNED') {
      return NextResponse.json(
        { error: `Cannot edit a ${existing.status} report` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (typeof body.title === 'string' && body.title.trim()) {
      data.title = body.title.trim();
    }

    if (body.periodStart !== undefined) {
      const d = new Date(body.periodStart);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'periodStart must be a valid ISO date' }, { status: 400 });
      }
      data.periodStart = d;
    }
    if (body.periodEnd !== undefined) {
      const d = new Date(body.periodEnd);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'periodEnd must be a valid ISO date' }, { status: 400 });
      }
      data.periodEnd = d;
    }
    if (data.periodStart && data.periodEnd && (data.periodEnd as Date) < (data.periodStart as Date)) {
      return NextResponse.json(
        { error: 'periodEnd must be on or after periodStart' },
        { status: 400 },
      );
    }

    if (Array.isArray(body.serviceIds)) {
      data.serviceIds = JSON.stringify(
        body.serviceIds.filter((s: unknown) => typeof s === 'string').map(String),
      );
    }
    if (Array.isArray(body.serviceCustomerIds)) {
      data.serviceCustomerIds = JSON.stringify(
        body.serviceCustomerIds.filter((s: unknown) => typeof s === 'string').map(String),
      );
    }
    if (typeof body.summary === 'string') {
      data.summary = body.summary;
    }
    if (body.metricsJson !== undefined) {
      data.metricsJson = JSON.stringify(body.metricsJson ?? {});
    }
    // Allow editing a RETURNED report to also clear the previous reviewer's notes
    // so the next submit starts fresh.
    if (existing.status === 'RETURNED') {
      data.reviewNotes = null;
    }

    const updated = await db.slaReport.update({ where: { id }, data });

    const userMap = await buildUserMap(
      [updated.preparedById, updated.reviewedByCmLeaderId].filter(Boolean) as string[],
    );
    return NextResponse.json(serializeSlaReport(updated, userMap));
  } catch (err) {
    return errorResponse(err);
  }
}
