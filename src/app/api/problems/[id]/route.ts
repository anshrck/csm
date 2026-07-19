import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';

export const runtime = 'nodejs';

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Internal error';
  if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

// GET /api/problems/[id] — single problem with service.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const roles = session.actorContext?.roles || [];
  if (!roles.includes('SCM_WORKER') && !roles.includes('CM_LEADER') && !roles.includes('SERVICE_OWNER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  const p = await db.problem.findFirst({
    where: { id, tenantId },
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

// PATCH /api/problems/[id] — update problem fields.
//
// Supported body fields (all optional):
//   status                   NEW | UNDER_INVESTIGATION | ROOT_CAUSE_IDENTIFIED | DECISION | KNOWN_ERROR | LINKED_TO_CHANGE | CLOSED
//   decision                 KNOWN_ERROR | CHANGE_REQUIRED | FURTHER_ANALYSIS
//   rootCauseDescription    string
//   impactAssessment         string
//   decisionRationale        string
//   workaroundDescription    string
//   knownErrorId             string
//
// Role scoping:
//   - SCM_WORKER, CM_LEADER, SERVICE_OWNER can all PATCH (the underlying PM
//     worker assignment is enforced at the application level by the caller's
//     UI; this route trusts the role check + existence check).
//   - When the caller is a SERVICE_OWNER, the problem must be on a service
//     they own.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (
      session.role !== 'SCM_WORKER' &&
      session.role !== 'CM_LEADER' &&
      session.role !== 'SERVICE_OWNER'
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const existing = await db.problem.findFirst({
      where: { id, tenantId },
      include: { service: { select: { id: true, name: true, serviceOwnerId: true } } },
    });
    if (!existing) return NextResponse.json({ error: 'Problem not found' }, { status: 404 });

    // Service Owner ownership gate.
    if (
      session.role === 'SERVICE_OWNER' &&
      existing.service?.serviceOwnerId !== session.id
    ) {
      return NextResponse.json(
        { error: 'Forbidden — you can only modify problems on services you own' },
        { status: 403 },
      );
    }

    const allowedFields: Record<string, unknown> = {};
    const stringFields = [
      'status',
      'decision',
      'rootCauseDescription',
      'impactAssessment',
      'decisionRationale',
      'workaroundDescription',
      'knownErrorId',
    ];
    for (const f of stringFields) {
      if (typeof body[f] === 'string') allowedFields[f] = body[f];
      if (body[f] === null && f !== 'status' && f !== 'decision') allowedFields[f] = null;
    }

    const updated = await db.problem.update({
      where: { id },
      data: allowedFields,
      include: { service: { select: { id: true, name: true } } },
    });

    await auditLog({
      actor: session,
      action: 'PROBLEM_UPDATED',
      entityType: 'Problem',
      entityId: id,
      before: {
        status: existing.status,
        decision: existing.decision,
        workaroundDescription: existing.workaroundDescription,
        knownErrorId: existing.knownErrorId,
      },
      after: {
        status: updated.status,
        decision: updated.decision,
        workaroundDescription: updated.workaroundDescription,
        knownErrorId: updated.knownErrorId,
      },
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      serviceId: updated.serviceId,
      serviceName: updated.service?.name ?? null,
      status: updated.status,
      decision: updated.decision,
      rootCauseDescription: updated.rootCauseDescription,
      impactAssessment: updated.impactAssessment,
      decisionRationale: updated.decisionRationale,
      workaroundDescription: updated.workaroundDescription,
      knownErrorId: updated.knownErrorId,
      assignedPmWorkerId: updated.assignedPmWorkerId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    return authError(e);
  }
}
