import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { serializeService, buildOwnerMap } from '../_serialize';

export const runtime = 'nodejs';

/**
 * GET /api/services/[id]
 *
 * Single service record with active offerings, primary SLA profile, owner
 * display names, and an SLA-event count summary for governance context.
 *
 * Returns 404 when the id does not resolve to a service.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const service = await db.service.findUnique({
    where: { id },
    include: {
      offerings: {
        where: { active: true },
        orderBy: { name: 'asc' },
      },
      slaProfiles: {
        take: 1,
        orderBy: { createdAt: 'asc' },
      },
      slaEvents: {
        select: { id: true, eventType: true },
      },
    },
  });

  if (!service) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Hydrate owner display names
  const ownerIds = [service.serviceOwnerId, service.technicalOwnerId].filter(
    Boolean,
  ) as string[];
  const ownerMap = await buildOwnerMap(ownerIds);

  const serialized = serializeService(service, ownerMap);

  // SLA event context — breakdown by event type
  const slaEventCount = service.slaEvents.length;
  const slaEventsByType = {
    WARNING: service.slaEvents.filter((e) => e.eventType === 'WARNING').length,
    BREACHED: service.slaEvents.filter((e) => e.eventType === 'BREACHED').length,
    CLOSED_IN_TIME: service.slaEvents.filter(
      (e) => e.eventType === 'CLOSED_IN_TIME',
    ).length,
  };

  return NextResponse.json({
    ...serialized,
    slaEventCount,
    slaEventsByType,
  });
}
