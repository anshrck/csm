import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { SlaEvent, SlaHealth } from '@/lib/types';

export const runtime = 'nodejs';

// SlaEvent extended with a per-service health hint.
type SlaEventWithHealth = SlaEvent & { health: SlaHealth };

/**
 * GET /api/sla-events
 *
 * Query params:
 *   serviceId   — filter by service
 *   customerId  — filter by orgNode id (customer)
 *   type        — WARNING | BREACHED | CLOSED_IN_TIME
 *   active=1    — only unresolved events (resolvedAt is null)
 *
 * Role scoping:
 *   - SERVICE_CUSTOMER: only events for their own orgNode (serviceCustomerId = caller.orgNodeId)
 *   - SCM_WORKER / CM_LEADER / SERVICE_OWNER: all tenant events (per task contract)
 *
 * Response: SlaEventWithHealth[] ordered by createdAt desc, with `serviceName` joined.
 * A computed `health` hint per service is included on every event row.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const serviceIdParam = sp.get('serviceId');
  const customerIdParam = sp.get('customerId');
  const typeParam = sp.get('type');
  const activeParam = sp.get('active');

  // Build base filter
  const where: Record<string, unknown> = {};
  if (serviceIdParam) where.serviceId = serviceIdParam;
  if (typeParam) where.eventType = typeParam;
  if (activeParam === '1') where.resolvedAt = null;

  // Role scoping — SERVICE_CUSTOMER is restricted to their own orgNode.
  if (session.role === 'SERVICE_CUSTOMER') {
    if (!session.orgNodeId) {
      return NextResponse.json<SlaEventWithHealth[]>([]);
    }
    where.serviceCustomerId = session.orgNodeId;
  } else if (customerIdParam) {
    // Allow explicit customer filter for non-customer roles.
    where.serviceCustomerId = customerIdParam;
  }

  const events = await db.slaEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      service: { select: { id: true, name: true, slaClass: true } },
    },
    take: 200,
  });

  // Compute per-service health hint across the result set.
  // red: any active BREACHED; amber: any active WARNING; green otherwise.
  const serviceHealth = new Map<string, SlaHealth>();
  for (const e of events) {
    const current = serviceHealth.get(e.serviceId) ?? 'green';
    if (e.eventType === 'BREACHED' && !e.resolvedAt) {
      serviceHealth.set(e.serviceId, 'red');
    } else if (e.eventType === 'WARNING' && !e.resolvedAt && current !== 'red') {
      serviceHealth.set(e.serviceId, 'amber');
    }
  }

  const result: SlaEventWithHealth[] = events.map((e) => ({
    id: e.id,
    serviceId: e.serviceId,
    serviceName: e.service?.name,
    serviceCustomerId: e.serviceCustomerId,
    eventType: e.eventType as SlaEvent['eventType'],
    message: e.message,
    createdAt: e.createdAt.toISOString(),
    resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
    health: serviceHealth.get(e.serviceId) ?? 'green',
  }));

  return NextResponse.json(result);
}
