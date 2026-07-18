import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeOffering } from '../services/_serialize';

export const runtime = 'nodejs';

/**
 * GET /api/offerings
 *
 * Read-only catalog of service offerings. Query params:
 *   - serviceId    restrict to offerings of one service
 *   - entitled=1   restrict to offerings entitled to the caller's orgNode
 *                  (intended for SERVICE_CUSTOMER / SERVICE_USER self-service)
 *
 * Always joins the parent service name. Returns ServiceOffering[].
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const serviceId = sp.get('serviceId');
  const entitled = sp.get('entitled') === '1';

  const where: any = {};
  if (serviceId) where.serviceId = serviceId;

  if (entitled) {
    if (!session.orgNodeId) {
      // No orgNode → no entitlements
      return NextResponse.json([]);
    }
    const ents = await db.entitlement.findMany({
      where: { orgNodeId: session.orgNodeId },
      select: { serviceOfferingId: true },
    });
    const offeringIds = ents.map((e) => e.serviceOfferingId);
    where.id = { in: offeringIds };
  }

  const offerings = await db.serviceOffering.findMany({
    where,
    include: {
      service: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(offerings.map(serializeOffering));
}
