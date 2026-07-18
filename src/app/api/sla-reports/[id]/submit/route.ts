import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

// POST /api/sla-reports/[id]/submit
// SCM_WORKER submits a DRAFT report for CM Leader review → PENDING_REVIEW
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const report = await db.slaReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (report.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `Report is in ${report.status} status; only DRAFT reports can be submitted` },
        { status: 409 },
      );
    }

    // SCM worker can only submit their own reports (CM Leader can submit any)
    if (session.role === 'SCM_WORKER' as Role && report.preparedById !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await db.slaReport.update({
      where: { id },
      data: { status: 'PENDING_REVIEW' },
    });

    // Notify all CM_LEADER users
    const cmLeaders = await db.user.findMany({
      where: { role: 'CM_LEADER' },
      select: { id: true },
    });
    if (cmLeaders.length > 0) {
      await db.notification.createMany({
        data: cmLeaders.map((u) => ({
          userId: u.id,
          type: 'QuoteApprovalRequested', // reuse generic approval type
          title: `SLA report submitted for review: ${report.title}`,
          message: `${session.name} submitted the SLA report "${report.title}" for your review and approval.`,
          entityRef: `sla-report:${id}`,
        })),
      });
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
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
