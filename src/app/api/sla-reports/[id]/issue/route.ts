import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

// POST /api/sla-reports/[id]/issue
// SCM_WORKER issues an APPROVED report to Service Customers → ISSUED
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('SCM_WORKER' as Role, 'CM_LEADER' as Role);
    const { id } = await params;

    const report = await db.slaReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (report.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Report is in ${report.status} status; only APPROVED reports can be issued` },
        { status: 409 },
      );
    }

    // Only the preparer (or a CM Leader) may issue
    if (session.role === 'SCM_WORKER' as Role && report.preparedById !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await db.slaReport.update({
      where: { id },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
      },
    });

    // Parse serviceCustomerIds and notify SERVICE_CUSTOMER users in those orgs
    let customerIds: string[] = [];
    try {
      const parsed = JSON.parse(report.serviceCustomerIds);
      if (Array.isArray(parsed)) customerIds = parsed.map(String);
    } catch {
      /* ignore */
    }

    if (customerIds.length > 0) {
      const customers = await db.user.findMany({
        where: { orgNodeId: { in: customerIds }, role: 'SERVICE_CUSTOMER' },
        select: { id: true },
      });
      if (customers.length > 0) {
        await db.notification.createMany({
          data: customers.map((u) => ({
            userId: u.id,
            type: 'SlaReportApproved', // re-use as "report issued/available"
            title: `SLA report issued: ${report.title}`,
            message: `A new SLA report "${report.title}" has been issued to your organization. Review it in your portal.`,
            entityRef: `sla-report:${id}`,
          })),
        });
      }
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      issuedAt: updated.issuedAt ? updated.issuedAt.toISOString() : null,
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
