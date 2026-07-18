import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Internal error';
  if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

// GET /api/problems/[id] — single problem with service.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  const p = await db.problem.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true, domain: true, slaClass: true, chapter: true, status: true } },
    },
  });
  if (!p) return NextResponse.json({ error: 'Problem not found' }, { status: 404 });

  return NextResponse.json({
    id: p.id,
    title: p.title,
    serviceId: p.serviceId,
    serviceName: p.service?.name ?? null,
    status: p.status,
    decision: p.decision,
    rootCauseDescription: p.rootCauseDescription,
    impactAssessment: p.impactAssessment,
    decisionRationale: p.decisionRationale,
    workaroundDescription: p.workaroundDescription,
    knownErrorId: p.knownErrorId,
    assignedPmWorkerId: p.assignedPmWorkerId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    service: p.service
      ? {
          id: p.service.id,
          name: p.service.name,
          domain: p.service.domain,
          slaClass: p.service.slaClass,
          chapter: p.service.chapter,
          status: p.service.status,
        }
      : null,
  });
}
