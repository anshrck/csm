import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { serializeCommunication, errorResponse } from './_serialize';

export const runtime = 'nodejs';

const VALID_DIRECTIONS = new Set(['TO_CUSTOMER', 'INTERNAL_NOTE']);
const VALID_CHANNELS = new Set(['PORTAL', 'EMAIL', 'MESSAGE']);

// GET /api/communications — list with filters + role-based scoping.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const demandId = sp.get('demandId') ?? undefined;
    const serviceCustomerId = sp.get('serviceCustomerId') ?? undefined;
    const serviceId = sp.get('serviceId') ?? undefined;
    const slaEventId = sp.get('slaEventId') ?? undefined;
    const direction = sp.get('direction') ?? undefined;

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (demandId) and.push({ demandId });
    if (serviceCustomerId) and.push({ serviceCustomerId });
    if (serviceId) and.push({ serviceId });
    if (slaEventId) and.push({ slaEventId });
    if (direction) and.push({ direction });

    if (and.length === 0) delete where.AND;

    const rows = await db.communication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const filtered: any[] = [];
    for (const row of rows) {
      const allowed = await authorize(session, { resource: 'communication', action: 'read', recordId: row.id });
      if (allowed) filtered.push(row);
    }

    return NextResponse.json(filtered.map(serializeCommunication));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/communications — create a communication record.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await authorize(session, { resource: 'communication', action: 'create' });
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    const direction =
      typeof body.direction === 'string' ? body.direction.trim() : '';
    if (!VALID_DIRECTIONS.has(direction)) {
      return NextResponse.json(
        { error: 'direction must be TO_CUSTOMER or INTERNAL_NOTE' },
        { status: 400 },
      );
    }
    const channel =
      typeof body.channel === 'string' ? body.channel.trim() : '';
    if (!VALID_CHANNELS.has(channel)) {
      return NextResponse.json(
        { error: 'channel must be PORTAL, EMAIL, or MESSAGE' },
        { status: 400 },
      );
    }
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (!subject) {
      return NextResponse.json({ error: 'subject is required' }, { status: 400 });
    }
    const bodyText = typeof body.body === 'string' ? body.body.trim() : '';
    if (!bodyText) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    // Optional foreign-key fields.
    const demandId =
      typeof body.demandId === 'string' && body.demandId.trim()
        ? body.demandId.trim()
        : null;
    const serviceId =
      typeof body.serviceId === 'string' && body.serviceId.trim()
        ? body.serviceId.trim()
        : null;
    const serviceCustomerId =
      typeof body.serviceCustomerId === 'string' && body.serviceCustomerId.trim()
        ? body.serviceCustomerId.trim()
        : null;
    const slaEventId =
      typeof body.slaEventId === 'string' && body.slaEventId.trim()
        ? body.slaEventId.trim()
        : null;

    // Validate the foreign keys (return 400 if any references a missing row).
    if (demandId) {
      const d = await db.demand.findUnique({ where: { id: demandId }, select: { id: true } });
      if (!d) return NextResponse.json({ error: 'demandId not found' }, { status: 400 });
    }
    if (serviceId) {
      const s = await db.service.findUnique({ where: { id: serviceId }, select: { id: true } });
      if (!s) return NextResponse.json({ error: 'serviceId not found' }, { status: 400 });
    }
    if (serviceCustomerId) {
      const o = await db.orgNode.findUnique({ where: { id: serviceCustomerId }, select: { id: true, name: true } });
      if (!o) return NextResponse.json({ error: 'serviceCustomerId not found' }, { status: 400 });
    }
    if (slaEventId) {
      const e = await db.slaEvent.findUnique({ where: { id: slaEventId }, select: { id: true, serviceId: true } });
      if (!e) return NextResponse.json({ error: 'slaEventId not found' }, { status: 400 });
    }

    // If a demand is referenced but no serviceCustomerId was supplied, derive
    // it from the demand so customer notifications can be routed correctly.
    let resolvedCustomerId = serviceCustomerId;
    if (!resolvedCustomerId && demandId) {
      const d = await db.demand.findUnique({
        where: { id: demandId },
        select: { serviceCustomerId: true },
      });
      resolvedCustomerId = d?.serviceCustomerId ?? null;
    }

    const created = await db.communication.create({
      data: {
        demandId,
        serviceId,
        serviceCustomerId: resolvedCustomerId,
        slaEventId,
        direction,
        channel,
        subject,
        body: bodyText,
        authorId: session.id,
        authorName: session.name,
      },
    });

    // Notify the customer org's SERVICE_CUSTOMER users when this is a
    // customer-facing communication.
    if (direction === 'TO_CUSTOMER' && resolvedCustomerId) {
      const customerUsers = await db.user.findMany({
        where: {
          role: 'SERVICE_CUSTOMER',
          orgNodeId: resolvedCustomerId,
        },
        select: { id: true },
      });
      if (customerUsers.length) {
        const isBreachComm = Boolean(slaEventId);
        const notifType = isBreachComm ? 'BreachCommunicated' : 'CommunicationReceived';
        const notifTitle = isBreachComm
          ? 'Breach communication received'
          : 'New message from your SCM team';
        await db.notification.createMany({
          data: customerUsers.map((u) => ({
            userId: u.id,
            type: notifType,
            title: notifTitle,
            message: `${session.name}: ${subject}`,
            entityRef: `communication:${created.id}`,
          })),
        });
      }
    }

    return NextResponse.json(serializeCommunication(created), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
