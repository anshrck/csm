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

// GET /api/handovers — list process handovers.
// Query: type (CM_TO_CE | PM_TO_CE | PM_TO_SD_KE | SD_TO_CE_STD), unacknowledged=1
export async function GET(req: NextRequest) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER');
  } catch (e) {
    return authError(e);
  }

  const sp = req.nextUrl.searchParams;
  const where: any = {};

  const type = sp.get('type');
  if (type) where.type = type.toUpperCase();

  if (sp.get('unacknowledged') === '1') {
    where.acknowledgedAt = null;
  }

  const items = await db.processHandover.findMany({
    where,
    include: {
      demand: { select: { id: true, title: true, status: true } },
      change: { select: { id: true, title: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const result: (ProcessHandover & {
    sourceDemandTitle: string | null;
    sourceDemandStatus: string | null;
    targetChangeTitle: string | null;
    targetChangeStatus: string | null;
  })[] = items.map((h) => ({
    id: h.id,
    type: h.type as ProcessHandover['type'],
    sourceDemandId: h.sourceDemandId,
    sourceProblemId: h.sourceProblemId,
    targetChangeId: h.targetChangeId,
    acknowledgedById: h.acknowledgedById,
    acknowledgedAt: h.acknowledgedAt ? h.acknowledgedAt.toISOString() : null,
    createdAt: h.createdAt.toISOString(),
    sourceDemandTitle: h.demand?.title ?? null,
    sourceDemandStatus: h.demand?.status ?? null,
    targetChangeTitle: h.change?.title ?? null,
    targetChangeStatus: h.change?.status ?? null,
  }));

  return NextResponse.json(result);
}
