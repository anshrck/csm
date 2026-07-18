// Enterprise Workflow Review — Entity-level access control helper.
// Verifies that the caller can access a specific entity before returning/creating
// conversations, comments, attachments, surveys, audit views, or search results.

import { db } from './db';
import type { SessionUser } from './types';

export type EntityType =
  | 'TICKET'
  | 'DEMAND'
  | 'CHANGE'
  | 'PROBLEM'
  | 'SLA_EVENT'
  | 'KNOWLEDGE_ARTICLE'
  | 'SLA_REPORT'
  | 'GOVERNANCE_DECISION'
  | 'COMMUNICATION';

export type AccessAction = 'read' | 'write' | 'create';

/**
 * Check whether the session user can access a specific entity.
 * Returns true if access is granted, false otherwise.
 *
 * Rules:
 * - SERVICE_CUSTOMER: can access entities belonging to their own OrgNode (serviceCustomerId).
 * - SCM_WORKER: can access entities for their assigned customer orgs (CustomerAssignment) + assigned to them.
 * - CM_LEADER: can access all entities in the tenant.
 * - SERVICE_OWNER: can access entities on services they own.
 */
export async function canAccessEntity(
  session: SessionUser,
  entityType: EntityType,
  entityId: string,
  action: AccessAction = 'read',
): Promise<boolean> {
  if (!session) return false;
  if (session.role === 'CM_LEADER') return true;

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
      // SCM and customers: problems are internal; SCM sees if service is in their scope
      if (session.role === 'SCM_WORKER') return true; // SCM can see problems for awareness
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
      // SCM: see SLA events for their assigned customers
      if (session.role === 'SCM_WORKER') {
        if (evt.serviceCustomerId) return await isAssignedCustomer(session.id, evt.serviceCustomerId);
        return true; // tenant-wide SLA events for awareness
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
      return true; // CM, Owner
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
        // SCM sees decisions affecting their demands
        if (decision.demandId) {
          const demand = await db.demand.findUnique({
            where: { id: decision.demandId },
            select: { assignedScmWorkerId: true, serviceCustomerId: true },
          });
          if (demand?.assignedScmWorkerId === session.id) return true;
          if (demand && await isAssignedCustomer(session.id, demand.serviceCustomerId)) return true;
        }
        return true; // SCM can see governance decisions for awareness
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
        select: { serviceCustomerId: true, demandId: true, authorId: true },
      });
      if (!comm) return false;
      if (session.role === 'SERVICE_CUSTOMER') {
        return comm.serviceCustomerId === session.orgNodeId;
      }
      if (session.role === 'SCM_WORKER') {
        if (comm.authorId === session.id) return true;
        if (comm.serviceCustomerId) return await isAssignedCustomer(session.id, comm.serviceCustomerId);
        return true;
      }
      return true;
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
