import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/changes/[id]/approve — PLANNING → APPROVED
// Body: { approvalNotes? }
// Per the simplified 4-role model, CM_LEADER is the approval authority but
// any authenticated SCM_WORKER or CM_LEADER can progress the change.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body is optional for approve
  }

  const existing = await db.change.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status !== 'PLANNING') {
    return NextResponse.json(
      { error: `Change must be in PLANNING state (current: ${existing.status})` },
      { status: 409 },
    );
  }

  const data: any = { status: 'APPROVED' };
  if (typeof body?.approvalNotes === 'string' && body.approvalNotes.trim()) {
    data.approvalNotes = body.approvalNotes;
  }

  const updated = await db.change.update({
    where: { id },
    data,
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
