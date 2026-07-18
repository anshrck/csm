import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { DEMAND_INCLUDE, serializeDemand, errorResponse, type DemandWithRelations } from './_serialize';

export const runtime = 'nodejs';

// GET /api/demands — list with filters + role-based scoping.
// Query params:
//   status        comma-separated multi-status filter
//   assigned=me   only demands assigned to caller
//   unassigned=1  only demands with no SCM worker
//   customer=<id> filter by service customer org node
//   q=<text>      title search (case-insensitive contains)
//   mine=1        serviceCustomerId === caller.orgNodeId (for customers)
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const statusParam = sp.get('status');
    const assignedMe = sp.get('assigned') === 'me';
    const unassigned = sp.get('unassigned') === '1';
    const customer = sp.get('customer') ?? undefined;
    const q = sp.get('q') ?? undefined;
    const mine = sp.get('mine') === '1';

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (statusParam) {
      const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) and.push({ status: { in: statuses } });
    }
    if (assignedMe) and.push({ assignedScmWorkerId: session.id });
    if (unassigned) and.push({ assignedScmWorkerId: null });
    if (customer) and.push({ serviceCustomerId: customer });
    if (q) {
      and.push({ title: { contains: q } });
    }

    // Role-based scoping.
    if (session.role === 'SERVICE_CUSTOMER') {
      // Customers see only their own orgNode's demands.
      if (!session.orgNodeId) {
        return NextResponse.json([]);
      }
      and.push({ serviceCustomerId: session.orgNodeId });
    } else if (session.role === 'SCM_WORKER') {
      // SCM workers see assigned-to-me + unassigned (unless explicitly filtered).
      if (!assignedMe && !unassigned) {
        and.push({
          OR: [{ assignedScmWorkerId: session.id }, { assignedScmWorkerId: null }],
        });
      }
      // If mine=1, also restrict to caller's orgNode (rare for SCM, but supported).
      if (mine && session.orgNodeId) {
        and.push({ serviceCustomerId: session.orgNodeId });
      }
    } else if (session.role === 'CM_LEADER' || session.role === 'SERVICE_OWNER') {
      // See all tenant demands. Optional mine filter still respected.
      if (mine && session.orgNodeId) {
        and.push({ serviceCustomerId: session.orgNodeId });
      }
    }

    if (and.length === 0) delete where.AND;

    const demands = await db.demand.findMany({
      where,
      include: DEMAND_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(demands.map((d) => serializeDemand(d as DemandWithRelations)));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/demands — create a new demand.
// Body: { title, description, businessJustification?, desiredTimeline?, relatedServiceIds?, serviceCustomerId? }
// Role: SERVICE_CUSTOMER or SCM_WORKER.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole('SERVICE_CUSTOMER' as Role, 'SCM_WORKER' as Role);

    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

    const businessJustification =
      typeof body.businessJustification === 'string' ? body.businessJustification.trim() || null : null;
    const desiredTimeline =
      typeof body.desiredTimeline === 'string' ? body.desiredTimeline.trim() || null : null;

    // relatedServiceIds: array of strings → store as JSON string.
    const relatedServiceIds: string[] = Array.isArray(body.relatedServiceIds)
      ? body.relatedServiceIds.filter((s: unknown) => typeof s === 'string').map(String)
      : [];

    // serviceCustomerId: optional override (for SCM creating on behalf), else caller's orgNode.
    let serviceCustomerId: string | undefined =
      typeof body.serviceCustomerId === 'string' && body.serviceCustomerId.trim()
        ? body.serviceCustomerId.trim()
        : session.orgNodeId ?? undefined;

    if (!serviceCustomerId) {
      return NextResponse.json(
        { error: 'serviceCustomerId is required (caller has no orgNode)' },
        { status: 400 },
      );
    }

    // Verify the customer orgNode exists.
    const org = await db.orgNode.findUnique({ where: { id: serviceCustomerId } });
    if (!org) {
      return NextResponse.json({ error: 'Customer org node not found' }, { status: 400 });
    }
    // SERVICE_CUSTOMER can only create demands for their own orgNode.
    if (
      session.role === 'SERVICE_CUSTOMER' &&
      session.orgNodeId &&
      session.orgNodeId !== serviceCustomerId
    ) {
      return NextResponse.json(
        { error: 'Customers can only submit demands for their own organization' },
        { status: 403 },
      );
    }

    const demand = await db.demand.create({
      data: {
        title,
        description,
        businessJustification,
        desiredTimeline,
        relatedServiceIds: JSON.stringify(relatedServiceIds),
        serviceCustomerId,
        submittedById: session.id,
        status: 'NEW',
      },
      include: DEMAND_INCLUDE,
    });

    // CREATED event.
    await db.demandEvent.create({
      data: {
        demandId: demand.id,
        eventType: 'CREATED',
        actorId: session.id,
        actorName: session.name,
        notes: `Demand "${title}" submitted by ${session.name}.`,
      },
    });

    // Notify all CM_LEADER users (DemandCreated).
    const cmLeaders = await db.user.findMany({ where: { role: 'CM_LEADER' } });
    if (cmLeaders.length) {
      await db.notification.createMany({
        data: cmLeaders.map((u) => ({
          userId: u.id,
          type: 'DemandCreated',
          title: 'New demand submitted',
          message: `${session.name} submitted a new demand: "${title}".`,
          entityRef: `demand:${demand.id}`,
        })),
      });
    }

    // Re-fetch with events so the response includes the CREATED event.
    const fresh = await db.demand.findUnique({
      where: { id: demand.id },
      include: DEMAND_INCLUDE,
    });

    return NextResponse.json(serializeDemand(fresh as DemandWithRelations), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
