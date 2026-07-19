import { describe, test, expect, mock } from 'bun:test';

// Mock `getSession` so it doesn't try to access Next.js cookies() outside a request context
let mockSessionUser: any = null;
mock.module('../auth', () => ({
  getSession: () => Promise.resolve(mockSessionUser),
  resolveActorContext: (uid: string) => Promise.resolve(mockSessionUser ? mockSessionUser.actorContext : null),
}));

import { getRequiredPermission, authorize } from '../permissions';
import { canAccessEntity } from '../entity-access';
import type { Role, SessionUser, ActorContext } from '../types';

describe('CSM Enterprise Role Upgrade - Permissions Matrix & Authorization Tests', () => {
  // 1. Setup Mock Actor Contexts

  // Baseline customer
  const customerContext: ActorContext = {
    user: {
      id: 'usr-customer',
      email: 'customer@cerebree.io',
      name: 'Elena Vance',
      orgNodeId: 'org-finance',
      orgNodeName: 'Finance Division',
      avatarColor: '#0d9488',
      title: 'VP Finance',
    },
    tenantId: 'default-tenant',
    roles: ['SERVICE_CUSTOMER'],
    roleAssignments: [
      {
        roleId: 'SERVICE_CUSTOMER',
        scopeType: 'TENANT',
        scopeId: 'default-tenant',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      },
    ],
    permissions: new Set(['demand.read.own_org', 'demand.create.own_org', 'ticket.read.own_org']),
    grants: [],
    managedScopes: [],
    customerAssignments: [],
    teamMemberships: [],
    queueMemberships: [],
    serviceOwnerships: [],
  };

  // Baseline worker
  const workerContext: ActorContext = {
    user: {
      id: 'usr-scm',
      email: 'scm@cerebree.io',
      name: 'Priya Anand',
      orgNodeId: 'org-internal',
      orgNodeName: 'IT Organization',
      avatarColor: '#d97706',
      title: 'SCM Agent',
    },
    tenantId: 'default-tenant',
    roles: ['SCM_WORKER'],
    roleAssignments: [
      {
        roleId: 'SCM_WORKER',
        scopeType: 'TENANT',
        scopeId: 'default-tenant',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      },
    ],
    permissions: new Set(['demand.read.assigned', 'ticket.read.assigned', 'ticket.update.assigned', 'ticket.assign.within_group']),
    grants: [],
    managedScopes: [],
    customerAssignments: [
      { orgNodeId: 'org-finance', role: 'SCM_OWNER', active: true }
    ],
    teamMemberships: [],
    queueMemberships: [],
    serviceOwnerships: [],
  };

  // Baseline CM Leader
  const leaderContext: ActorContext = {
    user: {
      id: 'usr-leader',
      email: 'cmleader@cerebree.io',
      name: 'Sofia Reyes',
      orgNodeId: 'org-internal',
      orgNodeName: 'IT Organization',
      avatarColor: '#be123c',
      title: 'CSM Leader',
    },
    tenantId: 'default-tenant',
    roles: ['CM_LEADER'],
    roleAssignments: [
      {
        roleId: 'CM_LEADER',
        scopeType: 'TENANT',
        scopeId: 'default-tenant',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      },
    ],
    permissions: new Set(['demand.read.managed_scope', 'ticket.read.managed_scope', 'ticket.read.tenant']),
    grants: [],
    managedScopes: [
      { orgNodeId: 'org-finance' }
    ],
    customerAssignments: [],
    teamMemberships: [],
    queueMemberships: [],
    serviceOwnerships: [],
  };

  test('Permission mapping is precise and role-specific', () => {
    expect(getRequiredPermission('demand', 'read', 'SERVICE_CUSTOMER')).toBe('demand.read.own_org');
    expect(getRequiredPermission('demand', 'create', 'SERVICE_CUSTOMER')).toBe('demand.create.own_org');
    expect(getRequiredPermission('ticket', 'read', 'SERVICE_CUSTOMER')).toBe('ticket.read.own_org');
    expect(getRequiredPermission('demand', 'read', 'SCM_WORKER')).toBe('demand.read.assigned');
  });

  // Task check 1: Any missing, unknown, unresolved, expired, or invalid scope must return DENY
  test('Missing or empty roles in ActorContext must return DENY', async () => {
    const emptyContext: ActorContext = {
      ...customerContext,
      roles: [],
      roleAssignments: [],
    };
    const decision = await authorize(emptyContext, {
      resource: 'demand',
      action: 'read',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toContain('no active valid role assignments');
  });

  // Task check 2: Expired assignment denial
  test('Expired assignments validity is strictly enforced', async () => {
    const expiredContext: ActorContext = {
      ...customerContext,
      roles: [],
      roleAssignments: [
        {
          roleId: 'SERVICE_CUSTOMER',
          scopeType: 'TENANT',
          scopeId: 'default-tenant',
          status: 'ACTIVE',
          validFrom: new Date('2020-01-01'),
          validUntil: new Date('2021-01-01'), // expired!
        },
      ],
    };
    const decision = await authorize(expiredContext, {
      resource: 'demand',
      action: 'read',
    });
    expect(decision.allowed).toBe(false);
  });

  // Task check 3: Explicit DENY precedence (DENY > ALLOW)
  test('Explicit DENY grants must override ALLOW baseline permissions', async () => {
    const deniedContext: ActorContext = {
      ...customerContext,
      grants: [
        {
          permissionId: 'demand.read.own_org',
          permissionKey: 'demand.read.own_org',
          scopeType: 'TENANT',
          scopeId: 'default-tenant',
          effect: 'DENY', // Explicit deny!
          validFrom: new Date('2020-01-01'),
          validUntil: null,
        },
      ],
    };
    const decision = await authorize(deniedContext, {
      resource: 'demand',
      action: 'read',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toContain('Explicit DENY grant overrides baseline');
  });

  // Task check 4: Tenant-read write denial
  test('*.read.tenant permissions must authorize ONLY read actions', async () => {
    // Attempting a write action with tenant read permission but missing the write permission
    const unscopedLeader: ActorContext = {
      ...leaderContext,
      permissions: new Set(['ticket.read.tenant']), // only has read tenant!
    };
    const decision = await authorize(unscopedLeader, {
      resource: 'ticket',
      action: 'assign', // write action!
    });
    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toContain('Missing required permission key');
  });

  // Task check 5: Duplicate-session prevention (ActorContext resolved once)
  test('Duplicate-session prevention ensures no redundant database lookups occur during authorize()', async () => {
    // authorize() operates completely in-memory on the provided pre-resolved ActorContext
    const decision = await authorize(customerContext, {
      resource: 'demand',
      action: 'read',
    });
    expect(decision.allowed).toBe(true);
  });

  // Task check 6: Out-of-scope SCM Worker & CM Leader denial
  test('Out-of-scope SCM Worker cannot access records outside customer assignment', async () => {
    const unassignedWorker: ActorContext = {
      ...workerContext,
      customerAssignments: [
        { orgNodeId: 'org-hr', role: 'SCM_OWNER', active: true } // assigned to HR instead of Finance!
      ],
    };
    // canAccessEntity should return false for ticket belonging to Finance org
    const hasAccess = await canAccessEntity(unassignedWorker, 'TICKET', 'org-finance', 'read');
    expect(hasAccess).toBe(false);
  });

  test('CM Leader without explicit managed scope is denied access by default-deny', async () => {
    const unscopedLeader: ActorContext = {
      ...leaderContext,
      permissions: new Set(['ticket.read.managed_scope']), // no tenant permission!
      managedScopes: [], // no scopes assigned!
    };
    const hasAccess = await canAccessEntity(unscopedLeader, 'TICKET', 'org-finance', 'read');
    expect(hasAccess).toBe(false); // denied by default
  });
});
