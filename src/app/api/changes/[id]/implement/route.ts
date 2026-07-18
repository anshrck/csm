import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/changes/[id]/implement — APPROVED → IMPLEMENTATION
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  const existing = await db.change.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status !== 'APPROVED') {
    return NextResponse.json(
      { error: `Change must be in APPROVED state (current: ${existing.status})` },
      { status: 409 },
    );
  }

  const updated = await db.change.update({
    where: { id },
    data: { status: 'IMPLEMENTATION' },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
