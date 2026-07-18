import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { Problem } from '@/lib/types';

export const runtime = 'nodejs';

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Internal error';
  if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

function serializeProblem(
  p: any,
): Problem {
  return {
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
  };
}

// GET /api/problems — list problems.
// Query: serviceId, status, owner=me (problems on services owned by the caller — SERVICE_OWNER)
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole('SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER');
  } catch (e) {
    return authError(e);
  }

  const sp = req.nextUrl.searchParams;
  const where: any = {};

  const serviceId = sp.get('serviceId');
  if (serviceId) where.serviceId = serviceId;

  const status = sp.get('status');
  if (status) where.status = status.toUpperCase();

  if (sp.get('owner') === 'me') {
    const owned = await db.service.findMany({
      where: { serviceOwnerId: session.id },
      select: { id: true },
    });
    where.serviceId = { in: owned.map((s) => s.id) };
  }

  const items = await db.problem.findMany({
    where,
    include: { service: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json(items.map(serializeProblem) as Problem[]);
}
