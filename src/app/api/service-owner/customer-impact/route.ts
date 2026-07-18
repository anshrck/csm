import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/service-owner/customer-impact — customer impact summary per owned service
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SERVICE_OWNER' && session.role !== 'CM_LEADER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const services = await db.service.findMany({
    where: session.role === 'SERVICE_OWNER' ? { serviceOwnerId: session.id } : undefined,
    select: { id: true, name: true },
  });
  const ownedServiceIds = services.map((s) => s.id);

  // Tickets on owned services grouped by customer
  const tickets = await db.ticket.findMany({
    where: { serviceId: { in: ownedServiceIds } },
    select: { id: true, serviceCustomerId: true, priority: true, status: true, createdAt: true },
  });

  // SLA clocks for these tickets
  const ticketIds = tickets.map((t) => t.id);
  const clocks = await db.slaClock.findMany({
    where: { ticketId: { in: ticketIds }, status: 'BREACHED' },
    select: { ticketId: true },
  });
  const breachedTicketIds = new Set(clocks.map((c) => c.ticketId));

  // Demands on owned services
  const demands = await db.demand.findMany({
    where: { status: { notIn: ['CLOSED', 'REJECTED', 'REDIRECTED'] } },
    select: { id: true, serviceCustomerId: true, relatedServiceIds: true },
  });
  const ownedDemandCustomerIds = new Set<string>();
  for (const d of demands) {
    try {
      const svcIds: string[] = JSON.parse(d.relatedServiceIds || '[]');
      if (svcIds.some((sid) => ownedServiceIds.includes(sid))) {
        ownedDemandCustomerIds.add(d.serviceCustomerId);
      }
    } catch { /* ignore */ }
  }

  // Surveys
  const surveys = await db.satisfactionSurvey.findMany({
    where: { entityType: 'TICKET', entityId: { in: ticketIds } },
    select: { entityId: true, rating: true },
  });
  const ticketCsat = new Map<string, number[]>();
  for (const s of surveys) {
    const arr = ticketCsat.get(s.entityId) ?? [];
    arr.push(s.rating);
    ticketCsat.set(s.entityId, arr);
  }

  // Group by customer
  const byCustomer = new Map<string, { tickets: typeof tickets; csat: number[] }>();
  for (const t of tickets) {
    if (!t.serviceCustomerId) continue;
    const entry = byCustomer.get(t.serviceCustomerId) ?? { tickets: [], csat: [] };
    entry.tickets.push(t);
    const csat = ticketCsat.get(t.id);
    if (csat) entry.csat.push(...csat);
    byCustomer.set(t.serviceCustomerId, entry);
  }

  // Communications
  const comms = await db.communication.findMany({
    where: { serviceCustomerId: { in: [...byCustomer.keys()] } },
    select: { serviceCustomerId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const lastCommByCustomer = new Map<string, string>();
  for (const c of comms) {
    if (c.serviceCustomerId && !lastCommByCustomer.has(c.serviceCustomerId)) {
      lastCommByCustomer.set(c.serviceCustomerId, c.createdAt.toISOString());
    }
  }

  // OrgNode names
  const orgNodes = await db.orgNode.findMany({
    where: { id: { in: [...byCustomer.keys()] } },
    select: { id: true, name: true },
  });
  const orgNameMap = new Map(orgNodes.map((o) => [o.id, o.name]));

  const result = [...byCustomer.entries()].map(([customerId, data]) => {
    const activeTickets = data.tickets.filter((t) => !['CLOSED', 'CANCELED', 'RESOLVED'].includes(t.status));
    const p1p2 = data.tickets.filter((t) => t.priority === 'P1' || t.priority === 'P2');
    const breaches = data.tickets.filter((t) => breachedTicketIds.has(t.id));
    const avgCsat = data.csat.length > 0 ? data.csat.reduce((a, b) => a + b, 0) / data.csat.length : null;
    return {
      customerId,
      customerName: orgNameMap.get(customerId) ?? 'Unknown',
      serviceIds: ownedServiceIds,
      activeTickets: activeTickets.length,
      p1p2Tickets: p1p2.length,
      activeBreaches: breaches.length,
      openDemands: ownedDemandCustomerIds.has(customerId) ? 1 : 0,
      averageCsat: avgCsat ? Math.round(avgCsat * 10) / 10 : null,
      lastCommunicationAt: lastCommByCustomer.get(customerId) ?? null,
    };
  });

  return NextResponse.json(result);
}
