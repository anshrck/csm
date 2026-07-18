import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

const VALID_COMPLEXITY = new Set(['SIMPLE', 'MEDIUM', 'COMPLEX']);

// POST /api/changes/[id]/plan — ASSESSMENT → PLANNING
// Body: { implementationPlan, technicalOwnerTasksJson?, complexity? }
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

  const implementationPlan =
    typeof body?.implementationPlan === 'string' ? body.implementationPlan.trim() : '';
  if (!implementationPlan) {
    return NextResponse.json({ error: 'implementationPlan is required' }, { status: 400 });
  }

  const data: any = {
    status: 'PLANNING',
    implementationPlan,
  };

  if (body?.technicalOwnerTasksJson !== undefined) {
    data.technicalOwnerTasksJson = JSON.stringify(
      Array.isArray(body.technicalOwnerTasksJson) ? body.technicalOwnerTasksJson : [],
    );
  }

  if (typeof body?.complexity === 'string' && body.complexity) {
    const v = body.complexity.toUpperCase();
    if (!VALID_COMPLEXITY.has(v)) {
      return NextResponse.json({ error: 'invalid complexity' }, { status: 400 });
    }
    data.complexity = v;
  }

  const existing = await db.change.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status !== 'ASSESSMENT') {
    return NextResponse.json(
      { error: `Change must be in ASSESSMENT state (current: ${existing.status})` },
      { status: 409 },
    );
  }

  const updated = await db.change.update({
    where: { id },
    data,
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
