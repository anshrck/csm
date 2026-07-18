import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/entitlements
 *
 * Returns the calling user's orgNode entitlements, joined with the entitled
 * offering and its parent service for display. Authentication required; users
 * without an orgNode get an empty array.
 *
 * Response shape: Array<{
 *   id: string;
 *   serviceOfferingId: string;
 *   offeringName: string | null;
 *   serviceName: string | null;
 *   scope: 'DIRECT' | 'INHERITED';
 *   validUntil: string | null;     // ISO date
 * }>
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.orgNodeId) {
    return NextResponse.json([]);
  }

  const entitlements = await db.entitlement.findMany({
    where: { orgNodeId: session.orgNodeId },
    include: {
      offering: {
        include: { service: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = entitlements.map((e) => ({
    id: e.id,
    serviceOfferingId: e.serviceOfferingId,
    offeringName: e.offering?.name ?? null,
    serviceName: e.offering?.service?.name ?? null,
    scope: e.scope,
    validUntil: e.validUntil ? e.validUntil.toISOString() : null,
  }));

  return NextResponse.json(result);
}
