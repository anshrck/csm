import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { ProcessHandover } from '@/lib/types';

export const runtime = 'nodejs';

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Internal error';
  if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

// POST /api/handovers/[id]/acknowledge — set acknowledgedById + acknowledgedAt
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  const existing = await db.processHandover.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  if (existing.acknowledgedAt) {
    return NextResponse.json({ error: 'Handover already acknowledged' }, { status: 409 });
  }

  const updated = await db.processHandover.update({
    where: { id },
    data: { acknowledgedById: session.id, acknowledgedAt: new Date() },
  });

  const result: ProcessHandover = {
    id: updated.id,
    type: updated.type as ProcessHandover['type'],
    sourceDemandId: updated.sourceDemandId,
    sourceProblemId: updated.sourceProblemId,
    targetChangeId: updated.targetChangeId,
    acknowledgedById: updated.acknowledgedById,
    acknowledgedAt: updated.acknowledgedAt ? updated.acknowledgedAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  };

  return NextResponse.json(result);
}
