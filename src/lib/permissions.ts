// Centralized permission + audit helpers for CereBree uSMS
import { db } from './db';
import { getSession } from './auth';
import type { Role, SessionUser } from './types';
import { canAccessEntity } from './entity-access';

export type Resource =
  | 'demand'
  | 'ticket'
  | 'change'
  | 'problem'
  | 'service'
  | 'service_offering'
  | 'sla'
  | 'sla_report'
  | 'knowledge'
  | 'communication'
  | 'governance_decision'
  | 'audit'
  | 'user_assignment';

export type Action =
  | 'read'
  | 'create'
  | 'update'
  | 'assign'
  | 'approve'
  | 'reject'
  | 'accept'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'publish'
  | 'retire'
  | 'escalate'
  | 'override'
  | 'export'
  | 'manage';

export type Scope =
  | 'SELF'
  | 'OWN_ORG'
  | 'ASSIGNED'
  | 'ASSIGNED_CUSTOMERS'
  | 'MANAGED_TEAM'
  | 'OWNED_SERVICES'
  | 'TENANT';

// Permission cache (in-memory, per server instance)
let permissionCache: Record<string, Set<string>> | null = null;

async function loadPermissions(): Promise<Record<string, Set<string>>> {
  if (permissionCache) return permissionCache;
  const rows = await db.rolePermission.findMany({ include: { permission: true } });
  const map: Record<string, Set<string>> = {};
  for (const rp of rows) {
    if (!map[rp.role]) map[rp.role] = new Set();
    map[rp.role].add(rp.permission.key);
  }
  permissionCache = map;
  return map;
}

/** Invalidate the permission cache (call after permission changes). */
export function invalidatePermissionCache() {
  permissionCache = null;
}

/** Ensure the caller has the given permission key. Returns the session or throws UNAUTHORIZED/FORBIDDEN. */
export async function requirePermission(key: string): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  const perms = await loadPermissions();
  const rolePerms = perms[session.role];
  if (!rolePerms || !rolePerms.has(key)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}

/** Ensure the caller has ANY of the given permission keys. */
export async function requireAnyPermission(...keys: string[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  const perms = await loadPermissions();
  const rolePerms = perms[session.role] ?? new Set<string>();
  if (!keys.some((k) => rolePerms.has(k))) {
    throw new Error('FORBIDDEN');
  }
  return session;
}

/** Check (non-throwing) whether the caller has a permission. */
export async function hasPermission(key: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const perms = await loadPermissions();
  const rolePerms = perms[session.role];
  return !!rolePerms && rolePerms.has(key);
}

/**
 * Maps a (Resource, Action, Role) combination to its required permission key.
 */
export function getRequiredPermission(resource: Resource, action: Action, role: Role): string | null {
  if (role === 'SERVICE_CUSTOMER') {
    if (resource === 'demand') {
      if (action === 'read') return 'demand.read.own_org';
      if (action === 'create') return 'demand.create.own_org';
      if (action === 'update') return 'demand.update.customer_fields';
      if (action === 'accept' || action === 'reject') return 'demand.quote.respond.own_org';
      if (action === 'close') return 'demand.close.own_org';
      if (action === 'reopen') return 'demand.reopen.request.own_org';
    }
    if (resource === 'ticket') {
      if (action === 'read') return 'ticket.read.own_org';
      if (action === 'create') return 'ticket.create.own_org';
      if (action === 'update') return 'ticket.comment.customer';
      if (action === 'close') return 'ticket.close.own_org';
      if (action === 'reopen') return 'ticket.reopen.own_org';
    }
    if (resource === 'service' || resource === 'service_offering') {
      if (action === 'read') return 'catalog.read.entitled';
    }
    if (resource === 'sla') {
      if (action === 'read') return 'sla.read.customer';
    }
    if (resource === 'sla_report') {
      if (action === 'read') return 'sla.report.read.issued';
    }
    if (resource === 'knowledge') {
      if (action === 'read') return 'knowledge.read.published';
    }
    if (resource === 'communication') {
      if (action === 'read') return 'communication.read.customer_visible';
      if (action === 'create') return 'communication.create.customer';
    }
    if (resource === 'audit') {
      if (action === 'read') return 'attachment.read.customer_visible';
    }
  }

  if (role === 'SCM_WORKER') {
    if (resource === 'demand') {
      if (action === 'read') return 'demand.read.assigned';
      if (action === 'create') return 'demand.create.for_assigned_customer';
      if (action === 'update') return 'demand.assess.assigned';
      if (action === 'close') return 'demand.close.propose.assigned';
    }
    if (resource === 'ticket') {
      if (action === 'read') return 'ticket.read.assigned';
      if (action === 'create') return 'ticket.create.for_assigned_customer';
      if (action === 'update') return 'ticket.update.assigned';
      if (action === 'assign') return 'ticket.assign.within_group';
      if (action === 'resolve') return 'ticket.resolve.assigned';
    }
    if (resource === 'change') {
      if (action === 'read') return 'change.read.related';
      if (action === 'create') return 'change.create.related';
      if (action === 'update') return 'change.assess.customer_impact';
    }
    if (resource === 'sla') {
      if (action === 'read') return 'sla.event.read.assigned';
    }
    if (resource === 'sla_report') {
      if (action === 'create' || action === 'update') return 'sla.report.prepare.assigned';
    }
    if (resource === 'knowledge') {
      if (action === 'read') return 'knowledge.read';
      if (action === 'create') return 'knowledge.create';
      if (action === 'update') return 'knowledge.update.own_draft';
    }
    if (resource === 'communication') {
      if (action === 'read') return 'communication.read.scoped';
      if (action === 'create') return 'communication.create.scoped';
    }
  }

  if (role === 'CM_LEADER') {
    if (resource === 'demand') {
      if (action === 'read') return 'demand.read.managed_scope';
      if (action === 'assign') return 'demand.assign.managed_scope';
      if (action === 'approve') return 'demand.quote.approve.managed_scope';
      if (action === 'reject') return 'demand.quote.reject.managed_scope';
      if (action === 'override') return 'demand.transition.override.managed_scope';
    }
    if (resource === 'ticket') {
      if (action === 'read') return 'ticket.read.managed_scope';
      if (action === 'assign') return 'ticket.assign.managed_scope';
      if (action === 'override') return 'ticket.priority.override.managed_scope';
    }
    if (resource === 'sla_report') {
      if (action === 'read') return 'sla.report.review.managed_scope';
      if (action === 'approve') return 'sla.report.approve.managed_scope';
    }
    if (resource === 'knowledge') {
      if (action === 'read') return 'knowledge.read';
      if (action === 'publish') return 'knowledge.publish.authorized_scope';
      if (action === 'retire') return 'knowledge.retire.authorized_scope';
    }
  }

  if (role === 'SERVICE_OWNER') {
    if (resource === 'service') {
      if (action === 'read') return 'service.read.owned';
      if (action === 'update') return 'service.update.owned';
      if (action === 'manage') return 'service.ownership.certify.owned';
    }
    if (resource === 'demand') {
      if (action === 'read') return 'demand.read.owned_services';
      if (action === 'approve') return 'demand.commitment.approve.owned_services';
      if (action === 'reject') return 'demand.commitment.reject.owned_services';
    }
    if (resource === 'ticket') {
      if (action === 'read') return 'ticket.read.owned_services';
    }
    if (resource === 'problem') {
      if (action === 'read') return 'problem.read.owned_services';
      if (action === 'update') return 'problem.review.require.owned_services';
    }
    if (resource === 'change') {
      if (action === 'read') return 'change.read.owned_services';
      if (action === 'approve') return 'change.service_impact.approve.owned_services';
    }
    if (resource === 'sla') {
      if (action === 'read') return 'sla.read.owned_services';
      if (action === 'update') return 'sla.target.manage.owned_services';
    }
    if (resource === 'governance_decision') {
      if (action === 'read') return 'governance.read.owned_services';
      if (action === 'create') return 'governance.decide.owned_services';
    }
  }

  return null;
}

/**
 * Universal server-side authorization entry point.
 * Every protected request MUST pass all five checks:
 *   1. Authenticated
 *   2. Permission granted
 *   3. Record in scope
 *   4. Action allowed in current state
 *   5. Protected fields not modified
 */
export async function authorize(
  session: SessionUser | null,
  params: {
    resource: Resource;
    action: Action;
    recordId?: string;
    requestedChanges?: Record<string, any>;
    workflowState?: string;
    reason?: string;
  }
): Promise<boolean> {
  // 1. Authenticated check
  if (!session) return false;

  // 2. Permission granted check
  const permKey = getRequiredPermission(params.resource, params.action, session.role);
  if (!permKey) return false; // Default result is DENY

  const hasPerm = await hasPermission(permKey);
  // Support tenant-wide override permissions for CM_LEADER and SERVICE_OWNER
  const hasTenantPerm = await hasPermission(`${params.resource}.read.tenant`);
  if (!hasPerm && !hasTenantPerm) return false;

  // 3. Record in scope check (delegated to canAccessEntity)
  if (params.recordId) {
    const entityMap: Record<Resource, any> = {
      demand: 'DEMAND',
      ticket: 'TICKET',
      change: 'CHANGE',
      problem: 'PROBLEM',
      service: 'SERVICE',
      service_offering: 'SERVICE_OFFERING',
      sla: 'SLA_EVENT',
      sla_report: 'SLA_REPORT',
      knowledge: 'KNOWLEDGE_ARTICLE',
      communication: 'COMMUNICATION',
      governance_decision: 'GOVERNANCE_DECISION',
      audit: 'AUDIT_LOG',
      user_assignment: 'CUSTOMER_ASSIGNMENT',
    };
    const entityType = entityMap[params.resource];
    if (entityType) {
      const accessAction =
        params.action === 'create'
          ? 'create'
          : (params.action === 'update' ||
             params.action === 'assign' ||
             params.action === 'resolve' ||
             params.action === 'close' ||
             params.action === 'reopen' ||
             params.action === 'approve' ||
             params.action === 'reject')
          ? 'write'
          : 'read';
      const ok = await canAccessEntity(session, entityType, params.recordId, accessAction);
      if (!ok) return false;
    }
  }

  // Maker-checker controls
  if (params.recordId) {
    if (params.resource === 'demand' && params.action === 'approve') {
      const demand = await db.demand.findUnique({ where: { id: params.recordId } });
      if (demand && demand.assignedScmWorkerId === session.id) {
        // Quote creator cannot approve the same quote
        return false;
      }
    }
    if (params.resource === 'sla_report' && params.action === 'approve') {
      const report = await db.slaReport.findUnique({ where: { id: params.recordId } });
      if (report && report.preparedById === session.id) {
        // SLA report preparer cannot approve the same report
        return false;
      }
    }
    if (params.resource === 'change' && params.action === 'approve') {
      const change = await db.change.findUnique({ where: { id: params.recordId } });
      if (change && change.assignedCeWorkerId === session.id) {
        // Change requester/planner cannot be sole approver
        return false;
      }
    }
  }

  // 4. Action allowed in current state (workflow state powers)
  if (params.workflowState) {
    const state = params.workflowState;
    if (params.resource === 'demand') {
      const targetStatus = params.requestedChanges?.status;
      if (targetStatus && targetStatus !== state) {
        // Enforce state transition checks
        if (session.role === 'SERVICE_CUSTOMER') {
          // Customer transitions
          const allowed =
            (state === 'NEW' && targetStatus === 'CLOSED') ||
            (state === 'QUOTED' && (targetStatus === 'ACCEPTED' || targetStatus === 'REJECTED')) ||
            (state === 'FULFILLED' && (targetStatus === 'CLOSED' || targetStatus === 'UNDER_REVIEW')); // reopening
          if (!allowed) return false;
        } else if (session.role === 'SCM_WORKER') {
          // SCM Worker transitions
          const allowed =
            (state === 'NEW' && targetStatus === 'UNDER_REVIEW') ||
            (state === 'UNDER_REVIEW' && targetStatus === 'QUOTED') ||
            (state === 'ACCEPTED' && targetStatus === 'IN_CHANGE') ||
            (state === 'IN_CHANGE' && targetStatus === 'FULFILLED');
          if (!allowed) return false;
        } else if (session.role === 'CM_LEADER') {
          // CM Leader can override with a reason
          if (!params.reason) return false;
        }
      }
    } else if (params.resource === 'ticket') {
      const targetStatus = params.requestedChanges?.status;
      if (targetStatus && targetStatus !== state) {
        if (session.role === 'SERVICE_CUSTOMER') {
          const allowed =
            (state === 'RESOLVED' && targetStatus === 'CLOSED') ||
            ((state === 'RESOLVED' || state === 'CLOSED') && targetStatus === 'IN_PROGRESS');
          if (!allowed) return false;
        } else if (session.role === 'SCM_WORKER') {
          const allowed =
            (state === 'NEW' && targetStatus === 'TRIAGED') ||
            ((state === 'TRIAGED' || state === 'ASSIGNED' || state === 'WAITING_CUSTOMER') && targetStatus === 'IN_PROGRESS') ||
            (state === 'IN_PROGRESS' && (targetStatus === 'WAITING_CUSTOMER' || targetStatus === 'RESOLVED'));
          if (!allowed) return false;
        }
      }
    }
  }

  // 5. Protected fields check
  if (params.requestedChanges) {
    const changes = Object.keys(params.requestedChanges);
    if (session.role === 'SERVICE_CUSTOMER') {
      const forbidden = [
        'assignedScmWorkerId',
        'assignedUserId',
        'priority',
        'slaBreachStatus',
        'internalNotes',
        'quoteApprovedByCmLeader',
        'quoteApprovedAt',
        'estimatedEffortDays',
        'estimatedCost',
        'governanceDecision',
        'serviceOwner',
        'technicalOwner',
        'lifecycleStage',
        'auditMetadata',
        'resolutionTimestamps',
      ];
      if (changes.some((c) => forbidden.includes(c))) return false;
    }
    if (session.role === 'SCM_WORKER') {
      const forbidden = [
        'serviceOwnerId',
        'technicalOwnerId',
        'lifecycleStage',
        'status', // of service
      ];
      if (changes.some((c) => forbidden.includes(c))) return false;
    }
  }

  return true;
}

/**
 * Shared API helper to authorize an action or throw.
 */
export async function requireAuthorizedAction(
  params: {
    resource: Resource;
    action: Action;
    recordId?: string;
    requestedChanges?: Record<string, any>;
    workflowState?: string;
    reason?: string;
  }
): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');

  const ok = await authorize(session, params);
  if (!ok) throw new Error('FORBIDDEN');

  return session;
}

/** Default permission set per role (used by seed to populate the Permission/RolePermission tables). */
export const DEFAULT_PERMISSIONS: { key: string; description: string; roles: Role[] }[] = [
  // Demand
  { key: 'demand.read.own_org', description: 'View demands from own org', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.read.assigned', description: 'View assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.read.managed_scope', description: 'View demands in managed scope', roles: ['CM_LEADER'] },
  { key: 'demand.read.owned_services', description: 'View demands for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'demand.read.tenant', description: 'View all tenant demands', roles: ['CM_LEADER'] },

  { key: 'demand.create.own_org', description: 'Create demands for own org', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.create.for_assigned_customer', description: 'Create demands for assigned customer', roles: ['SCM_WORKER'] },

  { key: 'demand.update.customer_fields', description: 'Update customer fields on demand', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.assess.assigned', description: 'Assess assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.transition.override.managed_scope', description: 'Override demand transitions in managed scope', roles: ['CM_LEADER'] },

  { key: 'demand.quote.respond.own_org', description: 'Respond to quotes for own org', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.quote.draft.assigned', description: 'Draft quote for assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.quote.submit.assigned', description: 'Submit quote for assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.quote.approve.managed_scope', description: 'Approve quote in managed scope', roles: ['CM_LEADER'] },
  { key: 'demand.quote.reject.managed_scope', description: 'Reject quote in managed scope', roles: ['CM_LEADER'] },

  { key: 'demand.commitment.approve.owned_services', description: 'Approve commitment for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'demand.commitment.reject.owned_services', description: 'Reject commitment for owned services', roles: ['SERVICE_OWNER'] },

  { key: 'demand.reject.recommend.assigned', description: 'Recommend rejection of assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.reject.authorize.managed_scope', description: 'Authorize rejection in managed scope', roles: ['CM_LEADER'] },

  { key: 'demand.redirect.recommend.assigned', description: 'Recommend redirect of assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.redirect.authorize.managed_scope', description: 'Authorize redirect in managed scope', roles: ['CM_LEADER'] },

  { key: 'demand.withdraw.own_org', description: 'Withdraw own org demands', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.close.own_org', description: 'Close own org demands', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.close.propose.assigned', description: 'Propose close of assigned demands', roles: ['SCM_WORKER'] },
  { key: 'demand.reopen.request.own_org', description: 'Request reopening of own org demands', roles: ['SERVICE_CUSTOMER'] },

  { key: 'demand.fulfilment.confirm.own_org', description: 'Confirm fulfilment of own org demands', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.fulfilment.mark.assigned', description: 'Mark assigned demands as fulfilled', roles: ['SCM_WORKER'] },

  { key: 'demand.assign.managed_scope', description: 'Assign demands in managed scope', roles: ['CM_LEADER'] },

  // Ticket
  { key: 'ticket.read.own_org', description: 'View tickets from own org', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.read.assigned', description: 'View assigned tickets', roles: ['SCM_WORKER'] },
  { key: 'ticket.read.managed_scope', description: 'View tickets in managed scope', roles: ['CM_LEADER'] },
  { key: 'ticket.read.owned_services', description: 'View tickets for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'ticket.read.tenant', description: 'View all tenant tickets', roles: ['CM_LEADER'] },

  { key: 'ticket.create.own_org', description: 'Create tickets for own org', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.create.for_assigned_customer', description: 'Create tickets for assigned customer', roles: ['SCM_WORKER'] },

  { key: 'ticket.comment.customer', description: 'Add customer comment on ticket', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.update.assigned', description: 'Update assigned tickets', roles: ['SCM_WORKER'] },
  { key: 'ticket.assign.within_group', description: 'Assign ticket within group', roles: ['SCM_WORKER'] },
  { key: 'ticket.assign.managed_scope', description: 'Assign ticket in managed scope', roles: ['CM_LEADER'] },

  { key: 'ticket.resolve.assigned', description: 'Resolve assigned tickets', roles: ['SCM_WORKER'] },
  { key: 'ticket.resolve.confirm.own_org', description: 'Confirm resolution of own org tickets', roles: ['SERVICE_CUSTOMER'] },

  { key: 'ticket.close.own_org', description: 'Close own org tickets', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.reopen.own_org', description: 'Reopen own org tickets', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.reopen.assigned', description: 'Reopen assigned tickets', roles: ['SCM_WORKER'] },

  { key: 'ticket.priority.override.managed_scope', description: 'Override ticket priority in managed scope', roles: ['CM_LEADER'] },
  { key: 'ticket.close.override.managed_scope', description: 'Override ticket close in managed scope', roles: ['CM_LEADER'] },
  { key: 'ticket.reopen.override.managed_scope', description: 'Override ticket reopen in managed scope', roles: ['CM_LEADER'] },

  // Change
  { key: 'change.read.related', description: 'View related changes', roles: ['SCM_WORKER'] },
  { key: 'change.read.owned_services', description: 'View changes for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'change.create.related', description: 'Create related changes', roles: ['SCM_WORKER'] },
  { key: 'change.assess.customer_impact', description: 'Assess customer impact of changes', roles: ['SCM_WORKER'] },
  { key: 'change.service_impact.approve.owned_services', description: 'Approve service impact of changes on owned services', roles: ['SERVICE_OWNER'] },
  { key: 'change.service_impact.reject.owned_services', description: 'Reject service impact of changes on owned services', roles: ['SERVICE_OWNER'] },
  { key: 'change.residual_risk.accept.owned_services', description: 'Accept residual risk for owned services', roles: ['SERVICE_OWNER'] },

  // Problem
  { key: 'problem.read.owned_services', description: 'View problems on owned services', roles: ['SERVICE_OWNER'] },
  { key: 'problem.review.require.owned_services', description: 'Require problem review on owned services', roles: ['SERVICE_OWNER'] },

  // Service
  { key: 'service.read.owned', description: 'View owned services', roles: ['SERVICE_OWNER'] },
  { key: 'service.update.owned', description: 'Update owned services', roles: ['SERVICE_OWNER'] },
  { key: 'service.lifecycle.submit.owned', description: 'Submit owned service lifecycle transition', roles: ['SERVICE_OWNER'] },
  { key: 'service.lifecycle.approve.owned', description: 'Approve owned service lifecycle transition', roles: ['SERVICE_OWNER'] },
  { key: 'service.lifecycle.restrict.owned', description: 'Restrict owned service lifecycle', roles: ['SERVICE_OWNER'] },
  { key: 'service.lifecycle.retire.owned', description: 'Retire owned service lifecycle', roles: ['SERVICE_OWNER'] },
  { key: 'service.ownership.delegate.owned', description: 'Delegate owned service ownership', roles: ['SERVICE_OWNER'] },
  { key: 'service.ownership.transfer.request', description: 'Request owned service ownership transfer', roles: ['SERVICE_OWNER'] },
  { key: 'service.ownership.certify.owned', description: 'Certify owned service ownership', roles: ['SERVICE_OWNER'] },

  // Service offering
  { key: 'service_offering.create.owned', description: 'Create offering for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'service_offering.update.owned', description: 'Update offering for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'service_offering.activate.owned', description: 'Activate offering for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'service_offering.retire.owned', description: 'Retire offering for owned services', roles: ['SERVICE_OWNER'] },

  // SLA
  { key: 'sla.read.customer', description: 'View customer-facing SLA targets', roles: ['SERVICE_CUSTOMER'] },
  { key: 'sla.event.read.assigned', description: 'View SLA events in assigned scope', roles: ['SCM_WORKER'] },
  { key: 'sla.read.owned_services', description: 'View SLA for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'sla.target.manage.owned_services', description: 'Manage SLA targets for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'sla.exception.approve.owned_services', description: 'Approve SLA exceptions for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'sla.breach_response.decide.owned_services', description: 'Decide SLA breach response for owned services', roles: ['SERVICE_OWNER'] },

  // SLA report
  { key: 'sla.report.read.issued', description: 'View issued SLA reports', roles: ['SERVICE_CUSTOMER'] },
  { key: 'sla.report.read.owned_services', description: 'View SLA reports for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'sla.report.dispute', description: 'Dispute SLA reports', roles: ['SERVICE_CUSTOMER'] },
  { key: 'sla.report.prepare.assigned', description: 'Prepare SLA reports for assigned customers', roles: ['SCM_WORKER'] },
  { key: 'sla.report.submit.assigned', description: 'Submit SLA reports for assigned customers', roles: ['SCM_WORKER'] },
  { key: 'sla.report.issue.approved', description: 'Issue approved SLA reports', roles: ['SCM_WORKER'] },
  { key: 'sla.report.review.managed_scope', description: 'Review SLA reports in managed scope', roles: ['CM_LEADER'] },
  { key: 'sla.report.approve.managed_scope', description: 'Approve SLA reports in managed scope', roles: ['CM_LEADER'] },

  // Service catalog
  { key: 'catalog.read.entitled', description: 'View entitled service catalog', roles: ['SERVICE_CUSTOMER'] },
  { key: 'catalog.request.entitled', description: 'Request entitled catalog offerings', roles: ['SERVICE_CUSTOMER'] },

  // Knowledge
  { key: 'knowledge.read.published', description: 'Read published knowledge articles', roles: ['SERVICE_CUSTOMER'] },
  { key: 'knowledge.read', description: 'Read knowledge articles', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'knowledge.read.owned_services', description: 'Read knowledge articles for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'knowledge.create', description: 'Create knowledge article', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'knowledge.update.own_draft', description: 'Update own draft knowledge article', roles: ['SCM_WORKER'] },
  { key: 'knowledge.submit_review', description: 'Submit knowledge article for review', roles: ['SCM_WORKER'] },
  { key: 'knowledge.review', description: 'Review knowledge articles', roles: ['CM_LEADER'] },
  { key: 'knowledge.publish.authorized_scope', description: 'Publish knowledge articles in managed scope', roles: ['CM_LEADER'] },
  { key: 'knowledge.retire.authorized_scope', description: 'Retire knowledge articles in managed scope', roles: ['CM_LEADER'] },
  { key: 'knowledge.publish.owned_services', description: 'Publish knowledge articles for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'knowledge.retire.owned_services', description: 'Retire knowledge articles for owned services', roles: ['SERVICE_OWNER'] },

  // Attachments
  { key: 'attachment.read.customer_visible', description: 'View customer-visible attachments', roles: ['SERVICE_CUSTOMER'] },
  { key: 'attachment.upload.own_org', description: 'Upload attachments for own org', roles: ['SERVICE_CUSTOMER'] },

  // Communication
  { key: 'communication.read.customer_visible', description: 'View customer-visible communications', roles: ['SERVICE_CUSTOMER'] },
  { key: 'communication.create.customer', description: 'Create customer communication', roles: ['SERVICE_CUSTOMER'] },
  { key: 'communication.read.scoped', description: 'View communication in scoped records', roles: ['SCM_WORKER'] },
  { key: 'communication.create.scoped', description: 'Create communication in scoped records', roles: ['SCM_WORKER'] },
  { key: 'communication.review.sensitive', description: 'Review sensitive communications', roles: ['CM_LEADER'] },

  // Escalation
  { key: 'escalation.create.scoped', description: 'Create escalation in scoped records', roles: ['SCM_WORKER'] },
  { key: 'escalation.manage.managed_scope', description: 'Manage escalations in managed scope', roles: ['CM_LEADER'] },

  // Audit
  { key: 'audit.read.operational_scope', description: 'View audit logs in operational scope', roles: ['CM_LEADER'] },
  { key: 'audit.read.owned_services', description: 'View audit logs for owned services', roles: ['SERVICE_OWNER'] },
  { key: 'audit.read.tenant', description: 'View all tenant audit logs', roles: ['CM_LEADER'] },

  // Analytics
  { key: 'analytics.read.tenant', description: 'View tenant-wide analytics', roles: ['CM_LEADER'] },
  { key: 'analytics.read.owned_services', description: 'View analytics for owned services', roles: ['SERVICE_OWNER'] },
];
