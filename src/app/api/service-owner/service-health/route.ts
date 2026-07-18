import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/service-owner/service-health — health summary per owned service
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SERVICE_OWNER' && session.role !== 'CM_LEADER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const serviceIdFilter = url.searchParams.get('serviceId');

  const services = await db.service.findMany({
    where: session.role === 'SERVICE_OWNER'
      ? { serviceOwnerId: session.id, ...(serviceIdFilter ? { id: serviceIdFilter } : {}) }
      : serviceIdFilter ? { id: serviceIdFilter } : undefined,
    include: {
      slaEvents: { where: { resolvedAt: null }, select: { id: true, eventType: true } },
      problems: { where: { status: { notIn: ['CLOSED'] } }, select: { id: true, status: true, workaroundDescription: true } },
      tickets: { where: { status: { notIn: ['CLOSED', 'CANCELED', 'RESOLVED'] } }, select: { id: true, priority: true } },
      risks: { where: { status: { notIn: ['CLOSED'] } }, select: { id: true, severity: true } },
    },
  });

  // Fetch SLA clocks for owned service tickets
  const ownedServiceIds = services.map((s) => s.id);
  const ticketsOnOwned = await db.ticket.findMany({
    where: { serviceId: { in: ownedServiceIds } },
    select: { id: true },
  });
  const ticketIds = ticketsOnOwned.map((t) => t.id);
  const clocks = await db.slaClock.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { id: true, status: true, type: true, ticketId: true },
  });
  const breachedClocks = clocks.filter((c) => c.status === 'BREACHED');
  const warningClocks = clocks.filter((c) => c.status === 'RUNNING'); // simplified

  // Fetch CSAT for owned services
  const surveys = await db.satisfactionSurvey.findMany({
    where: { entityType: 'TICKET', entityId: { in: ticketIds } },
    select: { rating: true },
  });
  const avgCsat = surveys.length > 0 ? surveys.reduce((sum, s) => sum + s.rating, 0) / surveys.length : null;

  const result = services.map((svc) => {
    const p1p2Count = svc.tickets.filter((t) => t.priority === 'P1' || t.priority === 'P2').length;
    const breaches = breachedClocks.length; // simplified — all breaches on owned service tickets
    const knownErrors = svc.problems.filter((p) => p.status === 'KNOWN_ERROR').length;
    const highRiskRisks = svc.risks.filter((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL').length;
    const health = breaches > 0 ? 'red' : (warningClocks.length > 0 || p1p2Count > 0 ? 'amber' : 'green');
    const riskScore = Math.min(100, breaches * 30 + p1p2Count * 15 + highRiskRisks * 10 + (knownErrors * 5));

    return {
      serviceId: svc.id,
      serviceName: svc.name,
      slaClass: svc.slaClass,
      health,
      openIncidents: svc.tickets.length,
      p1p2Count,
      breachedClocks: breaches,
      warnings: warningClocks.length,
      problems: svc.problems.length,
      knownErrors,
      highRiskChanges: 0, // could compute from changes
      csat: avgCsat ? Math.round(avgCsat * 10) / 10 : null,
      riskScore,
      lastReviewedAt: svc.lastReviewedAt?.toISOString() ?? svc.updatedAt.toISOString(),
      lifecycleStage: svc.lifecycleStage ?? 'ACTIVE',
    };
  });

  return NextResponse.json(result);
}
