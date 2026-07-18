import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

// POST /api/sla-reports/[id]/return
// CM_LEADER returns a PENDING_REVIEW report for revision → RETURNED (SCM can re-submit by going back to DRAFT)
// Body: { reviewNotes } (required)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('CM_LEADER' as Role);
    const { id } = await params;

    const report = await db.slaReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (report.status !== 'PENDING_REVIEW') {
      return NextResponse.json(
        { error: `Report is in ${report.status} status; only PENDING_REVIEW reports can be returned` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const reviewNotes =
      typeof body.reviewNotes === 'string' ? body.reviewNotes.trim() : '';

    if (!reviewNotes) {
      return NextResponse.json(
        { error: 'reviewNotes are required when returning a report' },
        { status: 400 },
      );
    }

    const updated = await db.slaReport.update({
      where: { id },
      data: {
        status: 'RETURNED',
        reviewedByCmLeaderId: session.id,
        reviewNotes,
      },
    });

    // Notify the SCM Worker
    await db.notification.create({
      data: {
        userId: report.preparedById,
        type: 'SlaReportReturned',
        title: `SLA report returned for revision: ${report.title}`,
        message: `${session.name} returned the SLA report "${report.title}" for revision. Notes: ${reviewNotes.slice(0, 180)}`,
        entityRef: `sla-report:${id}`,
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      reviewedByCmLeaderId: updated.reviewedByCmLeaderId,
      reviewNotes: updated.reviewNotes,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (msg === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
