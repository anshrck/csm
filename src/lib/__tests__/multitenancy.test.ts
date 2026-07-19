import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { db } from '../db';
import { buildEntityQueryScope } from '../entity-access';
import type { ActorContext } from '../types';

describe('Multitenancy & Portfolio Query Scoping Integration Tests', () => {
  let ticketAId: string;
  let ticketBId: string;

  const orgAId = 'org-node-test-a';
  const orgBId = 'org-node-test-b';

  const userAId = 'usr-customer-a';
  const userBId = 'usr-customer-b';

  beforeAll(async () => {
    // Ensure clean state: delete any leftover test records
    await db.ticket.deleteMany({
      where: {
        tenantId: { in: ['test-tenant-A', 'test-tenant-B'] },
      },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [userAId, userBId] },
      },
    });
    await db.orgNode.deleteMany({
      where: {
        id: { in: [orgAId, orgBId] },
      },
    });

    // Create test OrgNodes
    await db.orgNode.createMany({
      data: [
        { id: orgAId, name: 'Org A', type: 'CUSTOMER_ORG', tenantId: 'test-tenant-A' },
        { id: orgBId, name: 'Org B', type: 'CUSTOMER_ORG', tenantId: 'test-tenant-B' },
      ],
    });

    // Create test Users (requesters)
    await db.user.createMany({
      data: [
        {
          id: userAId,
          email: 'customer-a@tenant-a.com',
          name: 'Customer A',
          passwordHash: 'dummy',
          role: 'SERVICE_CUSTOMER',
          orgNodeId: orgAId,
          tenantId: 'test-tenant-A',
        },
        {
          id: userBId,
          email: 'customer-b@tenant-b.com',
          name: 'Customer B',
          passwordHash: 'dummy',
          role: 'SERVICE_CUSTOMER',
          orgNodeId: orgBId,
          tenantId: 'test-tenant-B',
        },
      ],
    });

    // Create test Tickets in different tenants
    const tA = await db.ticket.create({
      data: {
        number: 'TKT-TEST-A',
        title: 'Ticket for Tenant A',
        description: 'Detail A',
        type: 'INCIDENT',
        priority: 'P3',
        status: 'NEW',
        serviceCustomerId: orgAId,
        requesterId: userAId,
        tenantId: 'test-tenant-A',
      },
    });
    ticketAId = tA.id;

    const tB = await db.ticket.create({
      data: {
        number: 'TKT-TEST-B',
        title: 'Ticket for Tenant B',
        description: 'Detail B',
        type: 'INCIDENT',
        priority: 'P3',
        status: 'NEW',
        serviceCustomerId: orgBId,
        requesterId: userBId,
        tenantId: 'test-tenant-B',
      },
    });
    ticketBId = tB.id;
  });

  afterAll(async () => {
    // Cleanup test data
    await db.ticket.deleteMany({
      where: {
        id: { in: [ticketAId, ticketBId] },
      },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [userAId, userBId] },
      },
    });
    await db.orgNode.deleteMany({
      where: {
        id: { in: [orgAId, orgBId] },
      },
    });
  });

  test('Tenant-isolated query scope strictly filters out other tenants records', async () => {
    // 1. Build Actor Context for Tenant A
    const actorContextA: ActorContext = {
      user: {
        id: userAId,
        email: 'customer-a@tenant-a.com',
        name: 'Elena Tenant A',
        orgNodeId: orgAId,
        orgNodeName: 'Org A',
        avatarColor: '#000',
        title: 'Manager',
      },
      tenantId: 'test-tenant-A',
      roles: ['SERVICE_CUSTOMER'],
      roleAssignments: [],
      permissions: new Set(),
      grants: [],
      managedScopes: [],
      customerAssignments: [],
      teamMemberships: [],
      queueMemberships: [],
      serviceOwnerships: [],
    };

    // 2. Build Query Scope for TICKET under Tenant A
    const queryScopeA = await buildEntityQueryScope(actorContextA, 'TICKET');

    // 3. Query the tickets with the generated scope
    const tickets = await db.ticket.findMany({
      where: queryScopeA,
    });

    // 4. Assertions: Should only find Tenant A ticket, never Tenant B ticket!
    expect(tickets.length).toBe(1);
    expect(tickets[0].id).toBe(ticketAId);
    expect(tickets[0].tenantId).toBe('test-tenant-A');
    expect(tickets[0].title).toBe('Ticket for Tenant A');
  });

  test('Tenant-isolated query scope for Tenant B works independently', async () => {
    const actorContextB: ActorContext = {
      user: {
        id: userBId,
        email: 'customer-b@tenant-b.com',
        name: 'Elena Tenant B',
        orgNodeId: orgBId,
        orgNodeName: 'Org B',
        avatarColor: '#111',
        title: 'Manager',
      },
      tenantId: 'test-tenant-B',
      roles: ['SERVICE_CUSTOMER'],
      roleAssignments: [],
      permissions: new Set(),
      grants: [],
      managedScopes: [],
      customerAssignments: [],
      teamMemberships: [],
      queueMemberships: [],
      serviceOwnerships: [],
    };

    const queryScopeB = await buildEntityQueryScope(actorContextB, 'TICKET');
    const tickets = await db.ticket.findMany({
      where: queryScopeB,
    });

    expect(tickets.length).toBe(1);
    expect(tickets[0].id).toBe(ticketBId);
    expect(tickets[0].tenantId).toBe('test-tenant-B');
    expect(tickets[0].title).toBe('Ticket for Tenant B');
  });
});
