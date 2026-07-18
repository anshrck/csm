import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

const TERMINAL = new Set(['CLOSED', 'REJECTED']);

// POST /api/changes/[id]/reject — → REJECTED (terminal)
// Body: { reason }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }

  const existing = await db.change.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (TERMINAL.has(existing.status)) {
    return NextResponse.json(
      { error: `Change is already in terminal state (${existing.status})` },
      { status: 409 },
    );
  }

  const updated = await db.change.update({
    where: { id },
    data: { status: 'REJECTED', rejectionReason: reason },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
