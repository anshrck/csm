// Centralized permission + audit helpers for CereBree uSMS
import { db } from './db';
import { getSession } from './auth';
import type { Role, SessionUser } from './types';

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

/** Default permission set per role (used by seed to populate the Permission/RolePermission tables). */
export const DEFAULT_PERMISSIONS: { key: string; description: string; roles: Role[] }[] = [
  // Demand
  { key: 'demand.read.own', description: 'View own demands', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.read.all', description: 'View all demands', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'demand.create', description: 'Create demand', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER'] },
  { key: 'demand.assess', description: 'Assess demand (catalog check, feasibility)', roles: ['SCM_WORKER', 'CM_LEADER'] },
  { key: 'demand.quote.create', description: 'Prepare/submit quote for approval', roles: ['SCM_WORKER'] },
  { key: 'demand.quote.approve', description: 'Approve quote (CM Leader gate)', roles: ['CM_LEADER'] },
  { key: 'demand.reject', description: 'Recommend/authorize rejection', roles: ['SCM_WORKER', 'CM_LEADER'] },
  { key: 'demand.accept', description: 'Accept quote (customer)', roles: ['SERVICE_CUSTOMER'] },
  { key: 'demand.close', description: 'Close demand', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER'] },
  { key: 'demand.assign', description: 'Assign/reassign demands', roles: ['CM_LEADER'] },
  // Ticket
  { key: 'ticket.read.own', description: 'View own org tickets', roles: ['SERVICE_CUSTOMER'] },
  { key: 'ticket.read.all', description: 'View all tickets', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'ticket.create', description: 'Create ticket', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER'] },
  { key: 'ticket.assign', description: 'Assign ticket', roles: ['SCM_WORKER', 'CM_LEADER'] },
  { key: 'ticket.resolve', description: 'Resolve ticket', roles: ['SCM_WORKER', 'CM_LEADER'] },
  { key: 'ticket.close', description: 'Close ticket', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_CUSTOMER'] },
  { key: 'ticket.reopen', description: 'Reopen ticket', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER'] },
  // SLA
  { key: 'sla.report.create', description: 'Create/prepare SLA report', roles: ['SCM_WORKER'] },
  { key: 'sla.report.approve', description: 'Approve/review SLA report', roles: ['CM_LEADER'] },
  { key: 'sla.report.issue', description: 'Issue SLA report to customer', roles: ['SCM_WORKER'] },
  // Service catalog
  { key: 'catalog.read', description: 'View service catalog', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'service.manage', description: 'Manage service ownership', roles: ['SERVICE_OWNER'] },
  // Knowledge
  { key: 'knowledge.read', description: 'Read published knowledge articles', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'knowledge.create', description: 'Create knowledge article', roles: ['SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'knowledge.publish', description: 'Publish/retire knowledge article', roles: ['CM_LEADER', 'SERVICE_OWNER'] },
  // Communication
  { key: 'communication.create', description: 'Create customer communication', roles: ['SCM_WORKER', 'CM_LEADER'] },
  { key: 'communication.read.own', description: 'View own communications', roles: ['SERVICE_CUSTOMER'] },
  { key: 'communication.read.all', description: 'View all communications', roles: ['SCM_WORKER', 'CM_LEADER'] },
  // Governance
  { key: 'governance.decide', description: 'Make governance decisions (commitment, breach response)', roles: ['SERVICE_OWNER'] },
  { key: 'governance.read', description: 'View governance decisions', roles: ['CM_LEADER', 'SERVICE_OWNER', 'SCM_WORKER'] },
  // Attachments
  { key: 'attachment.upload', description: 'Upload attachments', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
  { key: 'attachment.read', description: 'View attachments', roles: ['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] },
];
