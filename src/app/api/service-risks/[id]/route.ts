import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';

export const runtime = 'nodejs';

// PATCH /api/service-risks/[id] — update risk status/mitigation
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SERVICE_OWNER' && session.role !== 'CM_LEADER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const risk = await db.serviceRisk.findUnique({ where: { id } });
  if (!risk) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Verify ownership
  const service = await db.service.findUnique({ where: { id: risk.serviceId } });
  if (session.role === 'SERVICE_OWNER' && service?.serviceOwnerId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await db.serviceRisk.update({
    where: { id },
    data: {
      status: body.status ?? risk.status,
      mitigation: body.mitigation ?? risk.mitigation,
      dueDate: body.dueDate ? new Date(body.dueDate) : risk.dueDate,
      severity: body.severity ?? risk.severity,
    },
  });
  await auditLog({ actor: session, action: 'OWNER_RISK_UPDATED', entityType: 'ServiceRisk', entityId: id, before: risk, after: updated });
  return NextResponse.json(updated);
}
