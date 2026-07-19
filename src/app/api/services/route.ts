import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeService, buildOwnerMap } from './_serialize';
import { buildEntityQueryScope } from '@/lib/entity-access';

export const runtime = 'nodejs';

/**
 * GET /api/services
 *
 * Read-only catalog list. Query params:
 *   - domain       INTERACTION | SUPPORT | DELIVERY | MANAGEMENT
 *   - slaClass     A | B | C | D
 *   - status       ACTIVE (default) | RETIRED | PLANNED | ALL
 *   - owner=me     restrict to services where serviceOwnerId = caller (SERVICE_OWNER)
 *   - q            free-text search on name/description (case-insensitive, JS filter)
 *   - entitled=1   restrict to services that have offerings entitled to caller.orgNodeId
 *
 * Always includes offerings[] + the primary slaProfile (first by createdAt).
 * serviceOwnerName / technicalOwnerName are joined manually via User lookup.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const domain = sp.get('domain');
  const slaClass = sp.get('slaClass');
  const status = sp.get('status');
  const owner = sp.get('owner');
  const q = sp.get('q');
  const entitled = sp.get('entitled') === '1';

  const scope = await buildEntityQueryScope(session, 'SERVICE');
  if (scope.id === '__none__') return NextResponse.json([]);

  // ---- Build the Prisma where clause ----
  const where: any = { AND: [scope] };

  // status: default ACTIVE, "ALL" disables the filter
  if (status && status.toUpperCase() === 'ALL') {
    // no status filter
  } else if (status) {
    where.AND.push({ status: status.toUpperCase() });
  } else {
    where.AND.push({ status: 'ACTIVE' });
  }

  if (domain) where.AND.push({ domain: domain.toUpperCase() });
  if (slaClass) where.AND.push({ slaClass: slaClass.toUpperCase() });

  // owner=me — Service Owner looking at their own portfolio
  if (owner === 'me') {
    where.AND.push({ serviceOwnerId: session.id });
  }

  // entitled=1 — caller sees only services that have offerings entitled to their orgNode
  if (entitled) {
    if (!session.orgNodeId) {
      // Customer without an orgNode has no entitlements
      return NextResponse.json([]);
    }
    const ents = await db.entitlement.findMany({
      where: { orgNodeId: session.orgNodeId },
      select: { serviceOfferingId: true },
    });
    const offeringIds = ents.map((e) => e.serviceOfferingId);
    if (offeringIds.length === 0) {
      return NextResponse.json([]);
    }
    const ownedOfferings = await db.serviceOffering.findMany({
      where: { id: { in: offeringIds } },
      select: { serviceId: true },
    });
    const serviceIds = Array.from(new Set(ownedOfferings.map((o) => o.serviceId)));
    if (serviceIds.length === 0) {
      return NextResponse.json([]);
    }
    where.AND.push({ id: { in: serviceIds } });
  }

  // ---- Fetch services with offerings + first slaProfile ----
  let services = await db.service.findMany({
    where,
    include: {
      offerings: { orderBy: { name: 'asc' } },
      slaProfiles: { take: 1, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { name: 'asc' },
  });

  // ---- q: case-insensitive name/description search (SQLite has no insensitive mode) ----
  if (q && q.trim()) {
    const ql = q.trim().toLowerCase();
    services = services.filter(
      (s) =>
        s.name.toLowerCase().includes(ql) ||
        s.description.toLowerCase().includes(ql),
    );
  }

  // ---- Hydrate owner names (no Prisma relation on Service.ownerId fields) ----
  const ownerIds = services.flatMap((s) =>
    [s.serviceOwnerId, s.technicalOwnerId].filter(Boolean) as string[],
  );
  const ownerMap = await buildOwnerMap(ownerIds);

  return NextResponse.json(services.map((s) => serializeService(s, ownerMap)));
}
