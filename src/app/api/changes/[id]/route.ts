import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { serializeChange, authError } from '../_serialize';
import type { Change, ProcessHandover, Service } from '@/lib/types';

export const runtime = 'nodejs';

const VALID_COMPLEXITY = new Set(['SIMPLE', 'MEDIUM', 'COMPLEX']);

// GET /api/changes/[id] — single change with originDemand, services, handovers.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  const c = await db.change.findFirst({
    where: { id, tenantId },
    include: {
      ceWorker: { select: { id: true, name: true } },
      originDemand: { include: { customer: true } },
      handovers: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!c) return NextResponse.json({ error: 'Change not found' }, { status: 404 });

  const allowed = await authorize(session, { resource: 'change', action: 'read', recordId: id });
  if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Lookup affected services from the JSON-stored id list.
  let svcIds: string[] = [];
  try {
    svcIds = JSON.parse(c.affectedServiceIds || '[]');
  } catch {
    svcIds = [];
  }
  let services: Service[] = [];
  if (svcIds.length) {
    const found = await db.service.findMany({ where: { id: { in: svcIds } } });
    services = found.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      domain: s.domain as Service['domain'],
      chapter: s.chapter,
      layer: s.layer as Service['layer'],
      slaClass: s.slaClass as Service['slaClass'],
      status: s.status as Service['status'],
      customerValue: s.customerValue,
      commodityType: s.commodityType,
      supportLevels: s.supportLevels,
      serviceOwnerId: s.serviceOwnerId,
      technicalOwnerId: s.technicalOwnerId,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  const base = serializeChange(c);

  const handovers: ProcessHandover[] = c.handovers.map((h) => ({
    id: h.id,
    type: h.type as ProcessHandover['type'],
    sourceDemandId: h.sourceDemandId,
    sourceProblemId: h.sourceProblemId,
    targetChangeId: h.targetChangeId,
    acknowledgedById: h.acknowledgedById,
    acknowledgedAt: h.acknowledgedAt ? h.acknowledgedAt.toISOString() : null,
    createdAt: h.createdAt.toISOString(),
  }));

  const originDemand = c.originDemand
    ? {
        id: c.originDemand.id,
        title: c.originDemand.title,
        status: c.originDemand.status,
        serviceCustomerId: c.originDemand.serviceCustomerId,
        serviceCustomerName: c.originDemand.customer?.name ?? null,
      }
    : null;

  return NextResponse.json({ ...base, services, handovers, originDemand });
}

// PATCH /api/changes/[id] — update editable fields on a non-terminal change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const allowed = await authorize(session, { resource: 'change', action: 'update', recordId: id });
  if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: any = {};

  if (typeof body?.complexity === 'string' && body.complexity) {
    const v = body.complexity.toUpperCase();
    if (!VALID_COMPLEXITY.has(v)) {
      return NextResponse.json({ error: 'invalid complexity' }, { status: 400 });
    }
    data.complexity = v;
  }
  if (typeof body?.implementationPlan === 'string') {
    data.implementationPlan = body.implementationPlan;
  }
  if (body?.technicalOwnerTasksJson !== undefined) {
    data.technicalOwnerTasksJson = JSON.stringify(
      Array.isArray(body.technicalOwnerTasksJson) ? body.technicalOwnerTasksJson : [],
    );
  }
  if (typeof body?.verificationNotes === 'string') {
    data.verificationNotes = body.verificationNotes;
  }
  if (typeof body?.approvalNotes === 'string') {
    data.approvalNotes = body.approvalNotes;
  }
  if (typeof body?.assignedCeWorkerId === 'string') {
    data.assignedCeWorkerId = body.assignedCeWorkerId || null;
  }

  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  const existing = await db.change.findFirst({ where: { id, tenantId } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status === 'CLOSED' || existing.status === 'REJECTED') {
    return NextResponse.json(
      { error: `Cannot edit a ${existing.status} change` },
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
