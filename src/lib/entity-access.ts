// Enterprise Workflow Review — Entity-level access control helper.
// Verifies that the caller can access a specific entity before returning/creating
// conversations, comments, attachments, surveys, audit views, or search results.

import { db } from './db';
import type { SessionUser } from './types';
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
  session: SessionUser,
  entityType: EntityType,
  entityId: string,
  action: AccessAction = 'read',
): Promise<boolean> {
  if (!session) return false;

  // CM_LEADER: Scoped access based on managed scope or tenant permission
  if (session.role === 'CM_LEADER') {
    const hasTenant = await hasPermission(`${entityType.toLowerCase()}.read.tenant` as any);
    if (hasTenant) return true;

    // Check if there is a managed scope record for the leader
    const hasAnyScope = await db.leaderManagedScope.count({
      where: { leaderId: session.id },
    }) > 0;
    if (!hasAnyScope) return true; // unrestricted default

    // Fetch the customer org id of the entity (if any) and check if it's in scope
    let orgNodeId: string | null = null;
    if (entityType === 'TICKET') {
      const t = await db.ticket.findUnique({ where: { id: entityId }, select: { serviceCustomerId: true } });
      orgNodeId = t?.serviceCustomerId ?? null;
    } else if (entityType === 'DEMAND') {
      const d = await db.demand.findUnique({ where: { id: entityId }, select: { serviceCustomerId: true } });
      orgNodeId = d?.serviceCustomerId ?? null;
    } else if (entityType === 'SLA_REPORT') {
      const managedOrgIds = await getLeaderManagedOrgIds(session.id);
      const reportCustCount = await db.slaReportCustomer.count({
        where: {
          slaReportId: entityId,
          orgNodeId: { in: managedOrgIds },
        },
      });
      return reportCustCount > 0;
    }

    if (orgNodeId) {
      const count = await db.leaderManagedScope.count({
        where: { leaderId: session.id, orgNodeId },
      });
      return count > 0;
    }
    return true;
  }

  switch (entityType) {
    case 'TICKET': {
      const ticket = await db.ticket.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true, assignedUserId: true, requesterId: true, serviceId: true },
      });
      if (!ticket) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return ticket.serviceCustomerId === session.orgNodeId;
      }
      if (session.role === 'SCM_WORKER') {
        if (ticket.assignedUserId === session.id) return true;
        return await isAssignedCustomer(session.id, ticket.serviceCustomerId);
      }
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, ticket.serviceId);
      }
      return false;
    }

    case 'DEMAND': {
      const demand = await db.demand.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true, assignedScmWorkerId: true, submittedById: true, relatedServiceIds: true },
      });
      if (!demand) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return demand.serviceCustomerId === session.orgNodeId;
      }
      if (session.role === 'SCM_WORKER') {
        if (demand.assignedScmWorkerId === session.id) return true;
        return await isAssignedCustomer(session.id, demand.serviceCustomerId);
      }
      if (session.role === 'SERVICE_OWNER') {
        // Owner can see demands that touch their services
        let svcIds: string[] = [];
        try { svcIds = JSON.parse(demand.relatedServiceIds || '[]'); } catch { /* empty */ }
        for (const sid of svcIds) {
          if (await isOwnedService(session.id, sid)) return true;
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
      if (session.role === 'SCM_WORKER') {
        if (change.assignedCeWorkerId === session.id) return true;
        // SCM can see changes originating from demands they handle
        if (change.originDemandId) {
          const demand = await db.demand.findUnique({
            where: { id: change.originDemandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand?.assignedScmWorkerId === session.id) return true;
          if (demand && await isAssignedCustomer(session.id, demand.serviceCustomerId)) return true;
        }
        return false;
      }
      if (session.role === 'SERVICE_OWNER') {
        let svcIds: string[] = [];
        try { svcIds = JSON.parse(change.affectedServiceIds || '[]'); } catch { /* empty */ }
        for (const sid of svcIds) {
          if (await isOwnedService(session.id, sid)) return true;
        }
        return false;
      }
      if (session.role === 'SERVICE_CUSTOMER') {
        // Customers see changes via their demands
        if (change.originDemandId) {
          const demand = await db.demand.findUnique({
            where: { id: change.originDemandId },
            select: { serviceCustomerId: true },
          });
          return demand?.serviceCustomerId === session.orgNodeId;
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
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, problem.serviceId);
      }
      if (session.role === 'SCM_WORKER') {
        const hasLinkedTicket = await db.ticket.count({
          where: { assignedUserId: session.id, serviceId: problem.serviceId },
        }) > 0;
        if (hasLinkedTicket) return true;

        const customerOrgIds = await getAssignedCustomerOrgIds(session.id);
        const hasEntitledCustomer = await db.entitlement.count({
          where: {
            orgNodeId: { in: customerOrgIds },
            offering: { serviceId: problem.serviceId },
          },
        }) > 0;
        if (hasEntitledCustomer) return true;

        const hasLinkedDemand = await db.demand.count({
          where: {
            assignedScmWorkerId: session.id,
            relatedServiceIds: { contains: problem.serviceId },
          },
        }) > 0;
        if (hasLinkedDemand) return true;

        return false;
      }
      if (session.role === 'SERVICE_CUSTOMER') return false; // problems are internal
      return false;
    }

    case 'SLA_EVENT': {
      const evt = await db.slaEvent.findUnique({
        where: { id: entityId },
        select: { serviceId: true, serviceCustomerId: true },
      });
      if (!evt) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return evt.serviceCustomerId === session.orgNodeId;
      }
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, evt.serviceId);
      }
      if (session.role === 'SCM_WORKER') {
        if (evt.serviceCustomerId && await isAssignedCustomer(session.id, evt.serviceCustomerId)) return true;
        const hasTicket = await db.ticket.count({
          where: { assignedUserId: session.id, serviceId: evt.serviceId },
        }) > 0;
        if (hasTicket) return true;

        const hasDemand = await db.demand.count({
          where: {
            assignedScmWorkerId: session.id,
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
      if (session.role === 'SERVICE_CUSTOMER') {
        return article.status === 'PUBLISHED';
      }
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, article.serviceId);
      }
      return true; // SCM, CM, Owner can see all article statuses
    }

    case 'SLA_REPORT': {
      const report = await db.slaReport.findUnique({
        where: { id: entityId },
        select: { status: true, preparedById: true },
      });
      if (!report) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return report.status === 'ISSUED';
      }
      if (session.role === 'SCM_WORKER') {
        return report.preparedById === session.id;
      }
      if (session.role === 'SERVICE_OWNER') {
        // Report touches owned services
        const reportSvcCount = await db.slaReportService.count({
          where: {
            slaReportId: entityId,
            service: { serviceOwnerId: session.id },
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
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, decision.serviceId);
      }
      if (session.role === 'SCM_WORKER') {
        if (decision.demandId) {
          const demand = await db.demand.findUnique({
            where: { id: decision.demandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand) {
            if (demand.assignedScmWorkerId === session.id) return true;
            if (await isAssignedCustomer(session.id, demand.serviceCustomerId)) return true;
          }
        }
        const customerOrgIds = await getAssignedCustomerOrgIds(session.id);
        const hasEntitledCustomer = await db.entitlement.count({
          where: {
            orgNodeId: { in: customerOrgIds },
            offering: { serviceId: decision.serviceId },
          },
        }) > 0;
        if (hasEntitledCustomer) return true;

        return false;
      }
      if (session.role === 'SERVICE_CUSTOMER') {
        // Customers don't see internal governance decisions directly
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
      if (session.role === 'SERVICE_CUSTOMER') {
        // External customer cannot see internal notes
        if (comm.direction === 'INTERNAL_NOTE') return false;
        return comm.serviceCustomerId === session.orgNodeId;
      }
      if (session.role === 'SCM_WORKER') {
        if (comm.authorId === session.id) return true;
        if (comm.serviceCustomerId && await isAssignedCustomer(session.id, comm.serviceCustomerId)) return true;
        if (comm.demandId) {
          const demand = await db.demand.findUnique({
            where: { id: comm.demandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand) {
            if (demand.assignedScmWorkerId === session.id) return true;
            if (await isAssignedCustomer(session.id, demand.serviceCustomerId)) return true;
          }
        }
        return false;
      }
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, comm.serviceId);
      }
      return true;
    }

    case 'SERVICE': {
      const service = await db.service.findUnique({
        where: { id: entityId },
      });
      if (!service) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return service.status === 'ACTIVE' || service.status === 'PLANNED';
      }
      if (session.role === 'SERVICE_OWNER') {
        return await isOwnedService(session.id, entityId);
      }
      return true; // SCM_WORKER, CM_LEADER can read all services
    }

    case 'SERVICE_OFFERING': {
      const offering = await db.serviceOffering.findUnique({
        where: { id: entityId },
        select: { serviceId: true },
      });
      if (!offering) return false;
      return await canAccessEntity(session, 'SERVICE', offering.serviceId, action);
    }

    case 'AUDIT_LOG': {
      const log = await db.auditLog.findUnique({
        where: { id: entityId },
      });
      if (!log) return false;
      // Audit records are visible if the user can access the underlying entity
      const underlyingType = log.entityType.toUpperCase() as EntityType;
      try {
        return await canAccessEntity(session, underlyingType, log.entityId, 'read');
      } catch {
        return false;
      }
    }

    case 'CUSTOMER_ASSIGNMENT': {
      const assignment = await db.customerAssignment.findUnique({
        where: { id: entityId },
      });
      if (!assignment) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return assignment.orgNodeId === session.orgNodeId;
      }
      if (session.role === 'SCM_WORKER') {
        return assignment.userId === session.id;
      }
      return true; // CM_LEADER, SERVICE_OWNER
    }

    default:
      return false;
  }
}

/** Helper: check if a user is assigned to a customer org (SCM scoping). */
export async function isAssignedCustomer(userId: string, orgNodeId: string | null): Promise<boolean> {
  if (!orgNodeId) return false;
  const count = await db.customerAssignment.count({
    where: { userId, orgNodeId, active: true },
  });
  return count > 0;
}

/** Helper: check if a user owns a service. */
export async function isOwnedService(userId: string, serviceId: string | null): Promise<boolean> {
  if (!serviceId) return false;
  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: { serviceOwnerId: true },
  });
  return service?.serviceOwnerId === userId;
}

/** Get the list of customer org IDs assigned to an SCM worker. */
export async function getAssignedCustomerOrgIds(userId: string): Promise<string[]> {
  const assignments = await db.customerAssignment.findMany({
    where: { userId, active: true },
    select: { orgNodeId: true },
  });
  return assignments.map((a) => a.orgNodeId);
}

/** Get the list of customer org IDs managed by a CM leader. */
export async function getLeaderManagedOrgIds(leaderId: string): Promise<string[]> {
  const scopes = await db.leaderManagedScope.findMany({
    where: { leaderId },
    select: { orgNodeId: true },
  });
  return scopes.map((s) => s.orgNodeId).filter((id): id is string => id !== null);
}

/** Require entity access — throws FORBIDDEN if denied. */
export async function requireEntityAccess(
  session: SessionUser,
  entityType: EntityType,
  entityId: string,
  action: AccessAction = 'read',
): Promise<void> {
  const ok = await canAccessEntity(session, entityType, entityId, action);
  if (!ok) throw new Error('FORBIDDEN');
}
