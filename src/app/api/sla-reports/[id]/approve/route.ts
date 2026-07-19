import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';

export const runtime = 'nodejs';

// POST /api/sla-reports/[id]/approve
// CM_LEADER approves a PENDING_REVIEW report → APPROVED
// Body: { reviewNotes? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const report = await db.slaReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const allowed = await authorize(session, { resource: 'sla_report', action: 'approve', recordId: id });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (report.status !== 'PENDING_REVIEW') {
      return NextResponse.json(
        { error: `Report is in ${report.status} status; only PENDING_REVIEW reports can be approved` },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const reviewNotes =
      typeof body.reviewNotes === 'string' ? body.reviewNotes.trim() : null;

    const updated = await db.slaReport.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedByCmLeaderId: session.id,
        approvedAt: new Date(),
        reviewNotes,
      },
    });

    // Notify the SCM Worker who prepared the report
    await db.notification.create({
      data: {
        userId: report.preparedById,
        type: 'SlaReportApproved',
        title: `SLA report approved: ${report.title}`,
        message: `${session.name} approved the SLA report "${report.title}". You can now issue it to the customer.`,
        entityRef: `sla-report:${id}`,
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      reviewedByCmLeaderId: updated.reviewedByCmLeaderId,
      approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
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
