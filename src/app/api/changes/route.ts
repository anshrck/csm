import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from './_serialize';
import type { Change } from '@/lib/types';

export const runtime = 'nodejs';

const VALID_TYPES = new Set(['STANDARD', 'NORMAL', 'EMERGENCY']);
const VALID_ORIGINS = new Set(['DEMAND', 'PROBLEM', 'STANDARD']);
const VALID_COMPLEXITY = new Set(['SIMPLE', 'MEDIUM', 'COMPLEX']);

// GET /api/changes — list changes with filters.
// Query: status (comma multi), type, originDemandId, ceWorker=me
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole('SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER');
  } catch (e) {
    return authError(e);
  }

  const sp = req.nextUrl.searchParams;
  const where: any = {};

  const statusCsv = sp.get('status');
  if (statusCsv) {
    const statuses = statusCsv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (statuses.length) where.status = { in: statuses };
  }

  const typeParam = sp.get('type');
  if (typeParam) where.type = typeParam.toUpperCase();

  const originDemandId = sp.get('originDemandId');
  if (originDemandId) where.originDemandId = originDemandId;

  if (sp.get('ceWorker') === 'me') {
    where.assignedCeWorkerId = session.id;
  }

  const items = await db.change.findMany({
    where,
    include: { ceWorker: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json(items.map(serializeChange) as Change[]);
}

// POST /api/changes — create a new change request.
// Body: { title, type?, originType?, originDemandId?, affectedServiceIds, implementationPlan?, complexity? }
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const type = typeof body?.type === 'string' ? body.type.toUpperCase() : 'NORMAL';
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }

  const originType = typeof body?.originType === 'string' ? body.originType.toUpperCase() : 'DEMAND';
  if (!VALID_ORIGINS.has(originType)) {
    return NextResponse.json({ error: 'invalid originType' }, { status: 400 });
  }

  const affectedServiceIds = Array.isArray(body?.affectedServiceIds)
    ? body.affectedServiceIds.filter((s: any) => typeof s === 'string')
    : [];

  const implementationPlan =
    typeof body?.implementationPlan === 'string' && body.implementationPlan.trim()
      ? body.implementationPlan
      : null;

  let complexity: string | null = null;
  if (typeof body?.complexity === 'string' && body.complexity) {
    const cpx = body.complexity.toUpperCase();
    if (!VALID_COMPLEXITY.has(cpx)) {
      return NextResponse.json({ error: 'invalid complexity' }, { status: 400 });
    }
    complexity = cpx;
  }

  // originDemandId uniqueness + existence check.
  let originDemandId: string | null = null;
  if (typeof body?.originDemandId === 'string' && body.originDemandId) {
    const odid: string = body.originDemandId;
    const [existing, demand] = await Promise.all([
      db.change.findUnique({ where: { originDemandId: odid } }),
      db.demand.findUnique({ where: { id: odid }, select: { id: true } }),
    ]);
    if (existing) {
      return NextResponse.json(
        { error: 'A change already exists for this demand' },
        { status: 409 },
      );
    }
    if (!demand) {
      return NextResponse.json({ error: 'originDemandId not found' }, { status: 400 });
    }
    originDemandId = odid;
  }

  const created = await db.change.create({
    data: {
      title,
      type,
      status: 'REQUESTED',
      complexity,
      originType,
      originDemandId,
      affectedServiceIds: JSON.stringify(affectedServiceIds),
      implementationPlan,
      technicalOwnerTasksJson: JSON.stringify([]),
      assignedCeWorkerId: session.role === 'SCM_WORKER' ? session.id : null,
      assignedCeLeaderId: session.role === 'CM_LEADER' ? session.id : null,
    },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  // Formal CM→CE handover record when this change originated from a demand.
  if (originDemandId) {
    await db.processHandover.create({
      data: { type: 'CM_TO_CE', sourceDemandId: originDemandId, targetChangeId: created.id },
    });
  }

  return NextResponse.json(serializeChange(created), { status: 201 });
}
