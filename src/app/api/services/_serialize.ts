// Catalog serialization helpers — shared across services/offerings routes.
import type { Service, ServiceOffering, SlaProfile } from '@/lib/types';
import { db } from '@/lib/db';

type OwnerMap = Record<string, string>;

/**
 * Map a raw Prisma ServiceOffering row (optionally with .service.name) to the
 * API response shape declared in @/lib/types.
 */
export function serializeOffering(o: any): ServiceOffering {
  return {
    id: o.id,
    serviceId: o.serviceId,
    name: o.name,
    description: o.description,
    requestType: o.requestType,
    fulfillmentDays: o.fulfillmentDays,
    active: o.active,
    serviceName: o.service?.name,
  };
}

/** Map a raw Prisma SlaProfile row to the API response shape. */
export function serializeSlaProfile(p: any): SlaProfile {
  return {
    id: p.id,
    serviceId: p.serviceId,
    slaClass: p.slaClass,
    availabilityTarget: p.availabilityTarget,
    p1ResponseMins: p.p1ResponseMins,
    p1ResolutionMins: p.p1ResolutionMins,
    p2ResponseMins: p.p2ResponseMins,
    p2ResolutionMins: p.p2ResolutionMins,
  };
}

/**
 * Map a raw Prisma Service row (with offerings[], slaProfiles[], and the owner
 * name lookup map) to the API response shape declared in @/lib/types.
 *
 * The Service table stores serviceOwnerId / technicalOwnerId as plain strings
 * (no Prisma relation), so owner names are resolved by the caller via
 * buildOwnerMap and supplied here.
 */
export function serializeService(s: any, ownerMap: OwnerMap): Service {
  const offerings = Array.isArray(s.offerings) ? s.offerings.map(serializeOffering) : [];
  const slaProfile =
    Array.isArray(s.slaProfiles) && s.slaProfiles.length > 0
      ? serializeSlaProfile(s.slaProfiles[0])
      : null;

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    domain: s.domain,
    chapter: s.chapter,
    layer: s.layer,
    slaClass: s.slaClass,
    status: s.status,
    customerValue: s.customerValue,
    commodityType: s.commodityType,
    supportLevels: s.supportLevels,
    serviceOwnerId: s.serviceOwnerId,
    technicalOwnerId: s.technicalOwnerId,
    serviceOwnerName: ownerMap[s.serviceOwnerId],
    technicalOwnerName: s.technicalOwnerId ? ownerMap[s.technicalOwnerId] : undefined,
    offerings,
    slaProfile,
    createdAt:
      s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
  };
}

/**
 * Bulk-resolve display names for a set of user ids. Used to hydrate
 * serviceOwnerName / technicalOwnerName without a Prisma relation.
 */
export async function buildOwnerMap(ids: string[]): Promise<OwnerMap> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};
  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const map: OwnerMap = {};
  for (const u of users) map[u.id] = u.name;
  return map;
}
