import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';

export const runtime = 'nodejs';

// GET /api/service-owner/risk-register — derive + persisted risks for owned services
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SERVICE_OWNER' && session.role !== 'CM_LEADER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const serviceIdFilter = url.searchParams.get('serviceId');
  const severityFilter = url.searchParams.get('severity');
  const statusFilter = url.searchParams.get('status');

  // Get owned services
  const ownedServices = await db.service.findMany({
    where: session.role === 'SERVICE_OWNER' ? { serviceOwnerId: session.id } : undefined,
    select: { id: true, name: true, slaClass: true, status: true, updatedAt: true },
  });
  const ownedIds = new Set(ownedServices.map((s) => s.id));

  // Fetch persisted risks
  const where: Record<string, unknown> = {};
  if (serviceIdFilter) where.serviceId = serviceIdFilter;
  else if (session.role === 'SERVICE_OWNER') where.serviceId = { in: [...ownedIds] };
  if (severityFilter) where.severity = severityFilter;
  if (statusFilter) where.status = statusFilter;

  const persisted = await db.serviceRisk.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  // Derive additional risks from live data
  const derived: any[] = [];

  // 1. Active SLA breaches → CRITICAL
  const breachedClocks = await db.slaClock.findMany({
    where: { status: 'BREACHED' },
    include: { ticket: { select: { serviceId: true, serviceCustomerId: true } } },
  });
  for (const clock of breachedClocks) {
    if (clock.ticket?.serviceId && ownedIds.has(clock.ticket.serviceId)) {
      const svc = ownedServices.find((s) => s.id === clock.ticket.serviceId);
      derived.push({
        id: `derived:sla:${clock.id}`,
        serviceId: clock.ticket.serviceId,
        serviceName: svc?.name ?? 'Unknown',
        title: `SLA ${clock.type} breach on ticket ${clock.ticketId}`,
        sourceType: 'SLA',
        sourceId: clock.id,
        severity: clock.type === 'RESPONSE' ? 'HIGH' : 'CRITICAL',
        status: 'OPEN',
        mitigation: null,
        dueDate: null,
        createdAt: clock.breachedAt ?? clock.startedAt,
      });
    }
  }

  // 2. Known errors without workaround → HIGH
  const problems = await db.problem.findMany({
    where: { status: { in: ['KNOWN_ERROR', 'UNDER_INVESTIGATION'] } },
    include: { service: { select: { id: true, name: true } } },
  });
  for (const p of problems) {
    if (ownedIds.has(p.serviceId)) {
      if (!p.workaroundDescription) {
        derived.push({
          id: `derived:problem:${p.id}`,
          serviceId: p.serviceId,
          serviceName: p.service?.name ?? 'Unknown',
          title: `Problem without workaround: ${p.title}`,
          sourceType: 'PROBLEM',
          sourceId: p.id,
          severity: 'HIGH',
          status: 'OPEN',
          mitigation: null,
          dueDate: null,
          createdAt: p.createdAt,
        });
      }
    }
  }

  // 3. Emergency changes → HIGH
  const emergencyChanges = await db.change.findMany({
    where: { type: 'EMERGENCY', status: { notIn: ['CLOSED', 'REJECTED'] } },
  });
  for (const c of emergencyChanges) {
    let svcIds: string[] = [];
    try { svcIds = JSON.parse(c.affectedServiceIds || '[]'); } catch { /* empty */ }
    for (const sid of svcIds) {
      if (ownedIds.has(sid)) {
        const svc = ownedServices.find((s) => s.id === sid);
        derived.push({
          id: `derived:change:${c.id}:${sid}`,
          serviceId: sid,
          serviceName: svc?.name ?? 'Unknown',
          title: `Emergency change in progress: ${c.title}`,
          sourceType: 'CHANGE',
          sourceId: c.id,
          severity: 'HIGH',
          status: 'OPEN',
          mitigation: null,
          dueDate: null,
          createdAt: c.createdAt,
        });
      }
    }
  }

  // 4. Catalog stale > 90 days → MEDIUM
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  for (const svc of ownedServices) {
    const lastReviewed = svc.updatedAt;
    if (lastReviewed < ninetyDaysAgo) {
      derived.push({
        id: `derived:catalog:${svc.id}`,
        serviceId: svc.id,
        serviceName: svc.name,
        title: `Catalog review overdue (>90 days)`,
        sourceType: 'CATALOG',
        sourceId: svc.id,
        severity: 'MEDIUM',
        status: 'OPEN',
        mitigation: null,
        dueDate: null,
        createdAt: lastReviewed,
      });
    }
  }

  // Merge: persisted risks take priority over derived (same sourceId)
  const persistedSourceIds = new Set(persisted.map((p) => `${p.sourceType}:${p.sourceId}`));
  const filteredDerived = derived.filter((d) => !persistedSourceIds.has(`${d.sourceType}:${d.sourceId}`));

  const all = [...persisted.map((p) => ({
    id: p.id,
    serviceId: p.serviceId,
    serviceName: ownedServices.find((s) => s.id === p.serviceId)?.name ?? 'Unknown',
    title: p.title,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    severity: p.severity,
    status: p.status,
    mitigation: p.mitigation,
    dueDate: p.dueDate?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  })), ...filteredDerived];

  return NextResponse.json(all);
}

// POST /api/service-owner/risk-register — create a persisted risk
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SERVICE_OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const service = await db.service.findUnique({ where: { id: body.serviceId } });
  if (!service || service.serviceOwnerId !== session.id) {
    return NextResponse.json({ error: 'Service not owned' }, { status: 403 });
  }
  const risk = await db.serviceRisk.create({
    data: {
      serviceId: body.serviceId,
      title: body.title,
      sourceType: body.sourceType || 'MANUAL',
      sourceId: body.sourceId || null,
      severity: body.severity || 'MEDIUM',
      likelihood: body.likelihood || null,
      impact: body.impact || null,
      ownerId: session.id,
      status: body.status || 'OPEN',
      mitigation: body.mitigation || null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    },
  });
  await auditLog({ actor: session, action: 'OWNER_RISK_CREATED', entityType: 'ServiceRisk', entityId: risk.id, after: risk });
  return NextResponse.json(risk, { status: 201 });
}
