import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/changes/[id]/assess — REQUESTED → ASSESSMENT
// Requires affectedServiceIds to be set.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  const c = await db.change.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (c.status !== 'REQUESTED') {
    return NextResponse.json(
      { error: `Change must be in REQUESTED state (current: ${c.status})` },
      { status: 409 },
    );
  }

  let affectedServiceIds: string[] = [];
  try {
    affectedServiceIds = JSON.parse(c.affectedServiceIds || '[]');
  } catch {
    affectedServiceIds = [];
  }
  if (!affectedServiceIds.length) {
    return NextResponse.json(
      { error: 'Cannot assess — affectedServiceIds must be set' },
      { status: 400 },
    );
  }

  const updated = await db.change.update({
    where: { id },
    data: { status: 'ASSESSMENT' },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
