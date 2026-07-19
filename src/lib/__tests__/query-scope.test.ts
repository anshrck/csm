import { describe, test, expect, mock } from 'bun:test';

// Mock `getSession` so Next.js cookies are not invoked
mock.module('../auth', () => ({
  getSession: () => Promise.resolve(null),
}));

import { buildEntityQueryScope } from '../entity-access';
import type { ActorContext } from '../types';

describe('Centralized Query Scope Builder Tests', () => {
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
    tenantId: 'custom-tenant-123',
    roles: ['SERVICE_CUSTOMER'],
    roleAssignments: [
      {
        roleId: 'SERVICE_CUSTOMER',
        scopeType: 'TENANT',
        scopeId: 'custom-tenant-123',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      },
    ],
    permissions: new Set(['demand.read.own_org', 'ticket.read.own_org']),
    grants: [],
    managedScopes: [],
    customerAssignments: [],
    teamMemberships: [],
    queueMemberships: [],
    serviceOwnerships: [],
  };

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
    tenantId: 'custom-tenant-123',
    roles: ['SCM_WORKER'],
    roleAssignments: [
      {
        roleId: 'SCM_WORKER',
        scopeType: 'TENANT',
        scopeId: 'custom-tenant-123',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01'),
        validUntil: null,
      },
    ],
    permissions: new Set(['demand.read.assigned', 'ticket.read.assigned']),
    grants: [],
    managedScopes: [],
    customerAssignments: [
      { orgNodeId: 'org-finance', role: 'SCM_OWNER', active: true },
    ],
    teamMemberships: [],
    queueMemberships: [],
    serviceOwnerships: [],
  };

  test('SERVICE_CUSTOMER scope restrictions are properly built with tenantId and orgNodeId', async () => {
    const scope = await buildEntityQueryScope(customerContext, 'TICKET');
    expect(scope).toEqual({
      tenantId: 'custom-tenant-123',
      serviceCustomerId: 'org-finance',
    });
  });

  test('SCM_WORKER scope restrictions include tenantId, assignment ID, and assigned org nodes', async () => {
    const scope = await buildEntityQueryScope(workerContext, 'TICKET');
    expect(scope).toEqual({
      tenantId: 'custom-tenant-123',
      OR: [
        { assignedUserId: 'usr-scm' },
        { serviceCustomerId: { in: ['org-finance'] } },
      ],
    });
  });

  test('Invalid role or missing session results in strict default-deny scope', async () => {
    const scope = await buildEntityQueryScope(null as any, 'TICKET');
    expect(scope).toEqual({ id: '__none__' });
  });
});
