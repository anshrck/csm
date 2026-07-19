// Enterprise Workflow Review — Entity-level access control helper.
// Verifies that the caller can access a specific entity before returning/creating
// conversations, comments, attachments, surveys, audit views, or search results.

import { db } from './db';
import type { ActorContext, SessionUser, Role } from './types';
import { hasPermission } from './permissions';

export type EntityType =
  | 'TICKET'
  | 'DEMAND'
  | 'CHANGE'
  | 'PROBLEM'
  | 'SLA_EVENT'
  | 'KNOWLEDGE_ARTICLE'
  | 'SLA_REPORT'
  | 'GOVERNANCE_DECISION'
  | 'COMMUNICATION'
  | 'SERVICE'
  | 'SERVICE_OFFERING'
  | 'AUDIT_LOG'
  | 'CUSTOMER_ASSIGNMENT';

export type AccessAction = 'read' | 'write' | 'create';

/**
 * Check whether the session user can access a specific entity.
 * Returns true if access is granted, false otherwise.
 */
export async function canAccessEntity(
  sessionOrContext: (SessionUser & { actorContext?: ActorContext }) | ActorContext,
  entityType: EntityType,
  entityId: string,
  action: AccessAction = 'read',
): Promise<boolean> {
  if (!sessionOrContext) return false;
  const actor = 'actorContext' in sessionOrContext && sessionOrContext.actorContext
    ? sessionOrContext.actorContext
    : sessionOrContext as ActorContext;

  // CM_LEADER: Scoped access based on managed scope or tenant permission
  if (actor.roles && actor.roles.includes('CM_LEADER' as Role)) {
    if (entityType === 'DEMAND') {
      const hasTenant = await hasPermission(actor, 'demand.read.tenant');
      if (hasTenant) return true;
    } else if (entityType === 'TICKET') {
      const hasTenant = await hasPermission(actor, 'ticket.read.tenant');
      if (hasTenant) return true;
    }

    // Check if there is a managed scope record for the leader
    const hasAnyScope = actor.managedScopes && actor.managedScopes.length > 0;
    if (!hasAnyScope) return false; // Default-deny on leaders without scope!

    // Fetch the customer org id of the entity (if any) and check if it's in scope
    let orgNodeId: string | null = null;
    if (entityType === 'TICKET') {
      const t = await db.ticket.findUnique({ where: { id: entityId }, select: { serviceCustomerId: true } });
      orgNodeId = t?.serviceCustomerId ?? null;
    } else if (entityType === 'DEMAND') {
      const d = await db.demand.findUnique({ where: { id: entityId }, select: { serviceCustomerId: true } });
      orgNodeId = d?.serviceCustomerId ?? null;
    } else if (entityType === 'SLA_REPORT') {
      const managedOrgIds = await getLeaderManagedOrgIds(actor);
      const reportCustCount = await db.slaReportCustomer.count({
        where: {
          slaReportId: entityId,
          orgNodeId: { in: managedOrgIds },
        },
      });
      return reportCustCount > 0;
    }

    if (orgNodeId) {
      return actor.managedScopes.some((ms) => ms.orgNodeId === orgNodeId);
    }
    return false; // Default-deny on unmapped scope
  }

  const roles = actor.roles || [];
  const isCustomer = roles.includes('SERVICE_CUSTOMER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SERVICE_CUSTOMER');
  const isWorker = roles.includes('SCM_WORKER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SCM_WORKER');
  const isOwner = roles.includes('SERVICE_OWNER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SERVICE_OWNER');

  const userId = actor.user ? actor.user.id : (sessionOrContext as SessionUser).id;
  const orgNodeId = actor.user ? actor.user.orgNodeId : (sessionOrContext as SessionUser).orgNodeId;

  switch (entityType) {
    case 'TICKET': {
      const ticket = await db.ticket.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true, assignedUserId: true, requesterId: true, serviceId: true },
      });
      if (!ticket) return false;
      if (isCustomer) {
        return ticket.serviceCustomerId === orgNodeId;
      }
      if (isWorker) {
        if (ticket.assignedUserId === userId) return true;
        return await isAssignedCustomer(actor, ticket.serviceCustomerId);
      }
      if (isOwner) {
        return await isOwnedService(actor, ticket.serviceId);
      }
      return false;
    }

    case 'DEMAND': {
      const demand = await db.demand.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true, assignedScmWorkerId: true, submittedById: true, relatedServiceIds: true },
      });
      if (!demand) return false;
      if (isCustomer) {
        return demand.serviceCustomerId === orgNodeId;
      }
      if (isWorker) {
        if (demand.assignedScmWorkerId === userId) return true;
        return await isAssignedCustomer(actor, demand.serviceCustomerId);
      }
      if (isOwner) {
        // Owner can see demands that touch their services
        let svcIds: string[] = [];
        try { svcIds = JSON.parse(demand.relatedServiceIds || '[]'); } catch { /* empty */ }
        for (const sid of svcIds) {
          if (await isOwnedService(actor, sid)) return true;
        }
        return false;
      }
      return false;
    }

    case 'CHANGE': {
      const change = await db.change.findUnique({
        where: { id: entityId },
        select: { affectedServiceIds: true, assignedCeWorkerId: true, originDemandId: true },
      });
      if (!change) return false;
      if (isWorker) {
        if (change.assignedCeWorkerId === userId) return true;
        // SCM can see changes originating from demands they handle
        if (change.originDemandId) {
          const demand = await db.demand.findUnique({
            where: { id: change.originDemandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand?.assignedScmWorkerId === userId) return true;
          if (demand && await isAssignedCustomer(actor, demand.serviceCustomerId)) return true;
        }
        return false;
      }
      if (isOwner) {
        let svcIds: string[] = [];
        try { svcIds = JSON.parse(change.affectedServiceIds || '[]'); } catch { /* empty */ }
        for (const sid of svcIds) {
          if (await isOwnedService(actor, sid)) return true;
        }
        return false;
      }
      if (isCustomer) {
        // Customers see changes via their demands
        if (change.originDemandId) {
          const demand = await db.demand.findUnique({
            where: { id: change.originDemandId },
            select: { serviceCustomerId: true },
          });
          return demand?.serviceCustomerId === orgNodeId;
        }
        return false;
      }
      return false;
    }

    case 'PROBLEM': {
      const problem = await db.problem.findUnique({
        where: { id: entityId },
        select: { serviceId: true },
      });
      if (!problem) return false;
      if (isOwner) {
        return await isOwnedService(actor, problem.serviceId);
      }
      if (isWorker) {
        const hasLinkedTicket = await db.ticket.count({
          where: { assignedUserId: userId, serviceId: problem.serviceId },
        }) > 0;
        if (hasLinkedTicket) return true;

        const hasLinkedDemand = await db.demand.count({
          where: {
            assignedScmWorkerId: userId,
            relatedServiceIds: { contains: problem.serviceId },
          },
        }) > 0;
        if (hasLinkedDemand) return true;

        const customerOrgIds = await getAssignedCustomerOrgIds(actor);
        const hasEntitledCustomer = await db.entitlement.count({
          where: {
            orgNodeId: { in: customerOrgIds },
            offering: { serviceId: problem.serviceId },
          },
        }) > 0;
        if (hasEntitledCustomer) return true;

        return false;
      }
      if (isCustomer) return false; // problems are internal
      return false;
    }

    case 'SLA_EVENT': {
      const evt = await db.slaEvent.findUnique({
        where: { id: entityId },
        select: { serviceId: true, serviceCustomerId: true },
      });
      if (!evt) return false;
      if (isCustomer) {
        return evt.serviceCustomerId === orgNodeId;
      }
      if (isOwner) {
        return await isOwnedService(actor, evt.serviceId);
      }
      if (isWorker) {
        if (evt.serviceCustomerId && await isAssignedCustomer(actor, evt.serviceCustomerId)) return true;
        const hasTicket = await db.ticket.count({
          where: { assignedUserId: userId, serviceId: evt.serviceId },
        }) > 0;
        if (hasTicket) return true;

        const hasDemand = await db.demand.count({
          where: {
            assignedScmWorkerId: userId,
            relatedServiceIds: { contains: evt.serviceId },
          },
        }) > 0;
        if (hasDemand) return true;

        return false;
      }
      return false;
    }

    case 'KNOWLEDGE_ARTICLE': {
      const article = await db.knowledgeArticle.findUnique({
        where: { id: entityId },
        select: { status: true, serviceId: true, authorId: true },
      });
      if (!article) return false;
      if (isCustomer) {
        return article.status === 'PUBLISHED';
      }
      if (isOwner) {
        return await isOwnedService(actor, article.serviceId);
      }
      return true; // SCM, CM can see all article statuses
    }

    case 'SLA_REPORT': {
      const report = await db.slaReport.findUnique({
        where: { id: entityId },
        select: { status: true, preparedById: true },
      });
      if (!report) return false;
      if (isCustomer) {
        return report.status === 'ISSUED';
      }
      if (isWorker) {
        return report.preparedById === userId;
      }
      if (isOwner) {
        const reportSvcCount = await db.slaReportService.count({
          where: {
            slaReportId: entityId,
            service: { serviceOwnerId: userId },
          },
        });
        return reportSvcCount > 0;
      }
      return true; // CM
    }

    case 'GOVERNANCE_DECISION': {
      const decision = await db.governanceDecision.findUnique({
        where: { id: entityId },
        select: { serviceId: true, demandId: true },
      });
      if (!decision) return false;
      if (isOwner) {
        return await isOwnedService(actor, decision.serviceId);
      }
      if (isWorker) {
        if (decision.demandId) {
          const demand = await db.demand.findUnique({
            where: { id: decision.demandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand) {
            if (demand.assignedScmWorkerId === userId) return true;
            if (await isAssignedCustomer(actor, demand.serviceCustomerId)) return true;
          }
        }
        const customerOrgIds = await getAssignedCustomerOrgIds(actor);
        const hasEntitledCustomer = await db.entitlement.count({
          where: {
            orgNodeId: { in: customerOrgIds },
            offering: { serviceId: decision.serviceId },
          },
        }) > 0;
        if (hasEntitledCustomer) return true;

        return false;
      }
      if (isCustomer) {
        return false;
      }
      return false;
    }

    case 'COMMUNICATION': {
      const comm = await db.communication.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true, demandId: true, authorId: true, direction: true, serviceId: true },
      });
      if (!comm) return false;
      if (isCustomer) {
        if (comm.direction === 'INTERNAL_NOTE') return false;
        return comm.serviceCustomerId === orgNodeId;
      }
      if (isWorker) {
        if (comm.authorId === userId) return true;
        if (comm.serviceCustomerId && await isAssignedCustomer(actor, comm.serviceCustomerId)) return true;
        if (comm.demandId) {
          const demand = await db.demand.findUnique({
            where: { id: comm.demandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand) {
            if (demand.assignedScmWorkerId === userId) return true;
            if (await isAssignedCustomer(actor, demand.serviceCustomerId)) return true;
          }
        }
        return false;
      }
      if (isOwner) {
        return await isOwnedService(actor, comm.serviceId);
      }
      return true;
    }

    case 'SERVICE': {
      const service = await db.service.findUnique({
        where: { id: entityId },
      });
      if (!service) return false;
      if (isCustomer) {
        return service.status === 'ACTIVE' || service.status === 'PLANNED';
      }
      if (isOwner) {
        return await isOwnedService(actor, entityId);
      }
      return true; // SCM_WORKER can read all services
    }

    case 'SERVICE_OFFERING': {
      const offering = await db.serviceOffering.findUnique({
        where: { id: entityId },
        select: { serviceId: true },
      });
      if (!offering) return false;
      return await canAccessEntity(actor, 'SERVICE', offering.serviceId, action);
    }

    case 'AUDIT_LOG': {
      const log = await db.auditLog.findUnique({
        where: { id: entityId },
      });
      if (!log) return false;
      const underlyingType = log.entityType.toUpperCase() as EntityType;
      try {
        return await canAccessEntity(actor, underlyingType, log.entityId, 'read');
      } catch {
        return false;
      }
    }

    case 'CUSTOMER_ASSIGNMENT': {
      const assignment = await db.customerAssignment.findUnique({
        where: { id: entityId },
      });
      if (!assignment) return false;
      if (isCustomer) {
        return assignment.orgNodeId === orgNodeId;
      }
      if (isWorker) {
        return assignment.userId === userId;
      }
      return true; // CM_LEADER, SERVICE_OWNER
    }

    default:
      return false;
  }
}

/** Helper: check if a user is assigned to a customer org (SCM scoping). */
export async function isAssignedCustomer(
  sessionOrContextOrId: (SessionUser & { actorContext?: ActorContext }) | ActorContext | string,
  orgNodeId: string | null
): Promise<boolean> {
  if (!orgNodeId) return false;

  if (typeof sessionOrContextOrId === 'string') {
    const count = await db.customerAssignment.count({
      where: { userId: sessionOrContextOrId, orgNodeId, active: true },
    });
    return count > 0;
  }

  const actor = 'actorContext' in sessionOrContextOrId && sessionOrContextOrId.actorContext
    ? sessionOrContextOrId.actorContext
    : sessionOrContextOrId as ActorContext;

  if (actor.customerAssignments) {
    return actor.customerAssignments.some((ca) => ca.orgNodeId === orgNodeId && ca.active);
  }

  const userId = actor.user ? actor.user.id : (sessionOrContextOrId as SessionUser).id;
  const count = await db.customerAssignment.count({
    where: { userId, orgNodeId, active: true },
  });
  return count > 0;
}

/** Helper: check if a user owns a service. */
export async function isOwnedService(
  sessionOrContextOrId: (SessionUser & { actorContext?: ActorContext }) | ActorContext | string,
  serviceId: string | null
): Promise<boolean> {
  if (!serviceId) return false;

  if (typeof sessionOrContextOrId === 'string') {
    const service = await db.service.findUnique({
      where: { id: serviceId },
      select: { serviceOwnerId: true },
    });
    if (service?.serviceOwnerId === sessionOrContextOrId) return true;

    const now = new Date();
    const count = await db.serviceOwnershipAssignment.count({
      where: {
        serviceId,
        userId: sessionOrContextOrId,
        status: 'ACCEPTED',
        validFrom: { lte: now },
        OR: [
          { validUntil: null },
          { validUntil: { gte: now } },
        ],
      },
    });
    return count > 0;
  }

  const actor = 'actorContext' in sessionOrContextOrId && sessionOrContextOrId.actorContext
    ? sessionOrContextOrId.actorContext
    : sessionOrContextOrId as ActorContext;

  const userId = actor.user ? actor.user.id : (sessionOrContextOrId as SessionUser).id;

  // 1. Direct Service Owner Check
  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: { serviceOwnerId: true },
  });
  if (service?.serviceOwnerId === userId) return true;

  // 2. Active ServiceOwnershipAssignment check (PRIMARY | DELEGATE | BACKUP)
  if (actor.serviceOwnerships) {
    return actor.serviceOwnerships.some((oa) => oa.serviceId === serviceId && oa.status === 'ACCEPTED');
  }

  const now = new Date();
  const count = await db.serviceOwnershipAssignment.count({
    where: {
      serviceId,
      userId,
      status: 'ACCEPTED',
      validFrom: { lte: now },
      OR: [
        { validUntil: null },
        { validUntil: { gte: now } },
      ],
    },
  });
  return count > 0;
}

/** Get the list of customer org IDs assigned to an SCM worker. */
export async function getAssignedCustomerOrgIds(
  sessionOrContextOrId: (SessionUser & { actorContext?: ActorContext }) | ActorContext | string
): Promise<string[]> {
  if (typeof sessionOrContextOrId === 'string') {
    const assignments = await db.customerAssignment.findMany({
      where: { userId: sessionOrContextOrId, active: true },
      select: { orgNodeId: true },
    });
    return assignments.map((a) => a.orgNodeId);
  }

  const actor = 'actorContext' in sessionOrContextOrId && sessionOrContextOrId.actorContext
    ? sessionOrContextOrId.actorContext
    : sessionOrContextOrId as ActorContext;

  if (actor.customerAssignments) {
    return actor.customerAssignments.map((a) => a.orgNodeId);
  }

  const userId = actor.user ? actor.user.id : (sessionOrContextOrId as SessionUser).id;
  const assignments = await db.customerAssignment.findMany({
    where: { userId, active: true },
    select: { orgNodeId: true },
  });
  return assignments.map((a) => a.orgNodeId);
}

/** Get the list of customer org IDs managed by a CM leader. */
export async function getLeaderManagedOrgIds(
  sessionOrContextOrId: (SessionUser & { actorContext?: ActorContext }) | ActorContext | string
): Promise<string[]> {
  if (typeof sessionOrContextOrId === 'string') {
    const scopes = await db.leaderManagedScope.findMany({
      where: { leaderId: sessionOrContextOrId },
      select: { orgNodeId: true },
    });
    return scopes.map((s) => s.orgNodeId).filter((id): id is string => id !== null);
  }

  const actor = 'actorContext' in sessionOrContextOrId && sessionOrContextOrId.actorContext
    ? sessionOrContextOrId.actorContext
    : sessionOrContextOrId as ActorContext;

  if (actor.managedScopes) {
    return actor.managedScopes.map((s) => s.orgNodeId).filter((id): id is string => id !== null);
  }

  const leaderId = actor.user ? actor.user.id : (sessionOrContextOrId as SessionUser).id;
  const scopes = await db.leaderManagedScope.findMany({
    where: { leaderId },
    select: { orgNodeId: true },
  });
  return scopes.map((s) => s.orgNodeId).filter((id): id is string => id !== null);
}

/** Require entity access — throws FORBIDDEN if denied. */
export async function requireEntityAccess(
  sessionOrContext: (SessionUser & { actorContext?: ActorContext }) | ActorContext,
  entityType: EntityType,
  entityId: string,
  action: AccessAction = 'read',
): Promise<void> {
  const ok = await canAccessEntity(sessionOrContext, entityType, entityId, action);
  if (!ok) throw new Error('FORBIDDEN');
}

/**
 * Centralized, role-aware query-scope builder for business and access-control entities.
 * Ensures strict tenant isolation (by appending `tenantId`) and filters matching the
 * exact row-level access control rules of `canAccessEntity`.
 *
 * If the user has no permissions or does not fit any access rule, returns `{ id: '__none__' }`
 * (a sentinel that forces an empty result set) to default-deny access.
 */
export async function buildEntityQueryScope(
  sessionOrContext: (SessionUser & { actorContext?: ActorContext }) | ActorContext,
  entityType: EntityType
): Promise<Record<string, any>> {
  if (!sessionOrContext) return { id: '__none__' };

  const actor = 'actorContext' in sessionOrContext && sessionOrContext.actorContext
    ? sessionOrContext.actorContext
    : sessionOrContext as ActorContext;

  const roles = actor.roles || [];
  const isCustomer = roles.includes('SERVICE_CUSTOMER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SERVICE_CUSTOMER');
  const isWorker = roles.includes('SCM_WORKER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SCM_WORKER');
  const isOwner = roles.includes('SERVICE_OWNER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'SERVICE_OWNER');
  const isLeader = roles.includes('CM_LEADER' as Role) || ('role' in sessionOrContext && sessionOrContext.role === 'CM_LEADER');

  const userId = actor.user ? actor.user.id : (sessionOrContext as SessionUser).id;
  const orgNodeId = actor.user ? actor.user.orgNodeId : (sessionOrContext as SessionUser).orgNodeId;
  const tenantId = actor.tenantId || 'default-tenant';

  // Helper to obtain service IDs owned by the user
  const ownedServiceIds = await getOwnedServiceIds(actor, userId, tenantId);

  const roleClauses: Record<string, any>[] = [];

  switch (entityType) {
    case 'TICKET': {
      if (isLeader) {
        const hasTenant = await hasPermission(actor, 'ticket.read.tenant');
        if (hasTenant) {
          roleClauses.push({});
        } else {
          const managedOrgIds = await getLeaderManagedOrgIds(actor);
          roleClauses.push({ serviceCustomerId: { in: managedOrgIds } });
        }
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({ serviceCustomerId: orgNodeId });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        roleClauses.push({
          OR: [
            { assignedUserId: userId },
            { serviceCustomerId: { in: assignedCustomerOrgIds } }
          ]
        });
      }
      if (isOwner) {
        roleClauses.push({ serviceId: { in: ownedServiceIds } });
      }
      break;
    }

    case 'DEMAND': {
      if (isLeader) {
        const hasTenant = await hasPermission(actor, 'demand.read.tenant');
        if (hasTenant) {
          roleClauses.push({});
        } else {
          const managedOrgIds = await getLeaderManagedOrgIds(actor);
          roleClauses.push({ serviceCustomerId: { in: managedOrgIds } });
        }
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({ serviceCustomerId: orgNodeId });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        roleClauses.push({
          OR: [
            { assignedScmWorkerId: userId },
            { serviceCustomerId: { in: assignedCustomerOrgIds } }
          ]
        });
      }
      if (isOwner) {
        if (ownedServiceIds.length > 0) {
          roleClauses.push({
            OR: ownedServiceIds.map((sid) => ({
              relatedServiceIds: { contains: `"${sid}"` }
            }))
          });
        }
      }
      break;
    }

    case 'CHANGE': {
      if (isLeader) {
        roleClauses.push({});
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({
            originDemand: {
              serviceCustomerId: orgNodeId
            }
          });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        roleClauses.push({
          OR: [
            { assignedCeWorkerId: userId },
            {
              originDemand: {
                OR: [
                  { assignedScmWorkerId: userId },
                  { serviceCustomerId: { in: assignedCustomerOrgIds } }
                ]
              }
            }
          ]
        });
      }
      if (isOwner) {
        if (ownedServiceIds.length > 0) {
          roleClauses.push({
            OR: ownedServiceIds.map((sid) => ({
              affectedServiceIds: { contains: `"${sid}"` }
            }))
          });
        }
      }
      break;
    }

    case 'PROBLEM': {
      if (isLeader) {
        roleClauses.push({});
      }
      if (isWorker) {
        const tickets = await db.ticket.findMany({
          where: { tenantId, assignedUserId: userId, NOT: { serviceId: null } },
          select: { serviceId: true }
        });
        const ticketServiceIds = tickets.map((t) => t.serviceId as string);

        const demands = await db.demand.findMany({
          where: { tenantId, assignedScmWorkerId: userId },
          select: { relatedServiceIds: true }
        });
        const demandServiceIds = demands.flatMap((d) => {
          try {
            return JSON.parse(d.relatedServiceIds || '[]');
          } catch {
            return [];
          }
        });

        const customerOrgIds = await getAssignedCustomerOrgIds(actor);
        const entitlements = await db.entitlement.findMany({
          where: {
            tenantId,
            orgNodeId: { in: customerOrgIds }
          },
          select: { offering: { select: { serviceId: true } } }
        });
        const entitledServiceIds = entitlements.map((e) => e.offering.serviceId);

        const allowedServiceIds = Array.from(new Set([
          ...ticketServiceIds,
          ...demandServiceIds,
          ...entitledServiceIds
        ]));

        roleClauses.push({ serviceId: { in: allowedServiceIds } });
      }
      if (isOwner) {
        roleClauses.push({ serviceId: { in: ownedServiceIds } });
      }
      break;
    }

    case 'SLA_EVENT': {
      if (isLeader) {
        roleClauses.push({});
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({ serviceCustomerId: orgNodeId });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        const tickets = await db.ticket.findMany({
          where: { tenantId, assignedUserId: userId, NOT: { serviceId: null } },
          select: { serviceId: true }
        });
        const ticketServiceIds = tickets.map((t) => t.serviceId as string);

        const demands = await db.demand.findMany({
          where: { tenantId, assignedScmWorkerId: userId },
          select: { relatedServiceIds: true }
        });
        const demandServiceIds = demands.flatMap((d) => {
          try {
            return JSON.parse(d.relatedServiceIds || '[]');
          } catch {
            return [];
          }
        });

        const allowedServiceIds = Array.from(new Set([...ticketServiceIds, ...demandServiceIds]));

        roleClauses.push({
          OR: [
            { serviceCustomerId: { in: assignedCustomerOrgIds } },
            { serviceId: { in: allowedServiceIds } }
          ]
        });
      }
      if (isOwner) {
        roleClauses.push({ serviceId: { in: ownedServiceIds } });
      }
      break;
    }

    case 'KNOWLEDGE_ARTICLE': {
      if (isLeader || isWorker) {
        roleClauses.push({});
      }
      if (isCustomer) {
        roleClauses.push({ status: 'PUBLISHED' });
      }
      if (isOwner) {
        roleClauses.push({
          OR: [
            { serviceId: { in: ownedServiceIds } },
            { authorId: userId }
          ]
        });
      }
      break;
    }

    case 'SLA_REPORT': {
      if (isLeader) {
        const managedOrgIds = await getLeaderManagedOrgIds(actor);
        if (managedOrgIds.length > 0) {
          roleClauses.push({
            reportCustomers: { some: { orgNodeId: { in: managedOrgIds } } }
          });
        } else {
          roleClauses.push({});
        }
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({
            status: 'ISSUED',
            reportCustomers: { some: { orgNodeId } }
          });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        roleClauses.push({
          OR: [
            { preparedById: userId },
            { reportCustomers: { some: { orgNodeId: { in: assignedCustomerOrgIds } } } }
          ]
        });
      }
      if (isOwner) {
        roleClauses.push({
          reportServices: { some: { serviceId: { in: ownedServiceIds } } }
        });
      }
      break;
    }

    case 'GOVERNANCE_DECISION': {
      if (isLeader) {
        roleClauses.push({});
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        const workerDemands = await db.demand.findMany({
          where: {
            tenantId,
            OR: [
              { assignedScmWorkerId: userId },
              { serviceCustomerId: { in: assignedCustomerOrgIds } }
            ]
          },
          select: { id: true }
        });
        const workerDemandIds = workerDemands.map((d) => d.id);

        const entitlements = await db.entitlement.findMany({
          where: {
            tenantId,
            orgNodeId: { in: assignedCustomerOrgIds }
          },
          select: { offering: { select: { serviceId: true } } }
        });
        const entitledServiceIds = entitlements.map((e) => e.offering.serviceId);

        roleClauses.push({
          OR: [
            { serviceId: { in: entitledServiceIds } },
            { demandId: { in: workerDemandIds } }
          ]
        });
      }
      if (isOwner) {
        roleClauses.push({ serviceId: { in: ownedServiceIds } });
      }
      break;
    }

    case 'COMMUNICATION': {
      if (isLeader) {
        roleClauses.push({});
      }
      if (isCustomer) {
        if (orgNodeId) {
          roleClauses.push({
            NOT: { direction: 'INTERNAL_NOTE' },
            serviceCustomerId: orgNodeId
          });
        }
      }
      if (isWorker) {
        const assignedCustomerOrgIds = await getAssignedCustomerOrgIds(actor);
        const workerDemands = await db.demand.findMany({
          where: {
            tenantId,
            OR: [
              { assignedScmWorkerId: userId },
              { serviceCustomerId: { in: assignedCustomerOrgIds } }
            ]
          },
          select: { id: true }
        });
        const workerDemandIds = workerDemands.map((d) => d.id);

        roleClauses.push({
          OR: [
            { authorId: userId },
            { serviceCustomerId: { in: assignedCustomerOrgIds } },
            { demandId: { in: workerDemandIds } }
          ]
        });
      }
      if (isOwner) {
        roleClauses.push({ serviceId: { in: ownedServiceIds } });
      }
      break;
    }

    case 'SERVICE': {
      if (isLeader || isWorker) {
        roleClauses.push({});
      }
      if (isCustomer) {
        roleClauses.push({ status: { in: ['ACTIVE', 'PLANNED'] } });
      }
      if (isOwner) {
        roleClauses.push({ id: { in: ownedServiceIds } });
      }
      break;
    }

    default:
      return { id: '__none__' };
  }

  if (roleClauses.length === 0) {
    return { id: '__none__' };
  }

  // Strict tenant isolation and combination of roles
  if (roleClauses.length === 1) {
    return { tenantId, ...roleClauses[0] };
  }

  return {
    tenantId,
    OR: roleClauses
  };
}

/**
 * Get service IDs owned by the user directly or via delegated/backup ownership assignments.
 */
export async function getOwnedServiceIds(
  actor: ActorContext,
  userId: string,
  tenantId: string
): Promise<string[]> {
  const directServices = await db.service.findMany({
    where: { tenantId, serviceOwnerId: userId },
    select: { id: true }
  });
  const ownedServiceIds = new Set(directServices.map((s) => s.id));

  if (actor.serviceOwnerships) {
    for (const oa of actor.serviceOwnerships) {
      if (oa.status === 'ACCEPTED') {
        ownedServiceIds.add(oa.serviceId);
      }
    }
  } else {
    const now = new Date();
    const extra = await db.serviceOwnershipAssignment.findMany({
      where: {
        tenantId,
        userId,
        status: 'ACCEPTED',
        validFrom: { lte: now },
        OR: [
          { validUntil: null },
          { validUntil: { gte: now } }
        ]
      },
      select: { serviceId: true }
    });
    for (const oa of extra) {
      ownedServiceIds.add(oa.serviceId);
    }
  }
  return Array.from(ownedServiceIds);
}
