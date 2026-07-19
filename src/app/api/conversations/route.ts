import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { authorize } from '@/lib/permissions';
import {
  canAccessEntity,
  type EntityType,
} from '@/lib/entity-access';
import {
  CONVERSATION_INCLUDE,
  asEntityType,
  errorResponse,
  serializeConversation,
} from './_serialize';

export const runtime = 'nodejs';

// GET /api/conversations?entityType=DEMAND&entityId=...&createIfMissing=1
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const entityType = asEntityType(sp.get('entityType'));
    const entityId = sp.get('entityId') ?? '';
    const createIfMissing = sp.get('createIfMissing') === '1';

    if (!entityType) {
      return NextResponse.json(
        { error: 'INVALID_ENTITY_TYPE — entityType must be TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT' },
        { status: 400 },
      );
    }
    if (!entityId) {
      return NextResponse.json({ error: 'INVALID_ENTITY_ID — entityId is required' }, { status: 400 });
    }

    // Entity-access gate via central authorize layer
    const allowed = await authorize(session, { resource: entityType.toLowerCase() as any, action: 'read', recordId: entityId });
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const serviceCustomerId = await resolveServiceCustomerId(entityType, entityId);

    let conv = await db.conversation.findFirst({
      where: { entityType, entityId },
      include: CONVERSATION_INCLUDE,
    });

    if (!conv && createIfMissing) {
      const allowedWrite = await authorize(session, { resource: entityType.toLowerCase() as any, action: 'update', recordId: entityId });
      if (!allowedWrite) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      conv = await db.conversation.create({
        data: {
          entityType,
          entityId,
          serviceCustomerId,
        },
        include: CONVERSATION_INCLUDE,
      });
      await auditLog({
        actor: session,
        action: 'CONVERSATION_CREATED',
        entityType,
        entityId,
        after: { conversationId: conv.id },
      });
    }

    if (!conv) {
      return NextResponse.json({
        id: null,
        entityType,
        entityId,
        serviceCustomerId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      });
    }

    // Filter comments for SERVICE_CUSTOMER visibility.
    const serialized = serializeConversation(conv);
    if (session.role === 'SERVICE_CUSTOMER') {
      serialized.comments = serialized.comments.filter(
        (c) => c.visibility === 'CUSTOMER_VISIBLE',
      );
    }
    return NextResponse.json(serialized);
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/conversations — create a new conversation explicitly.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const entityType = asEntityType(body.entityType);
    const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';

    if (!entityType) {
      return NextResponse.json(
        { error: 'INVALID_ENTITY_TYPE — entityType must be TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT' },
        { status: 400 },
      );
    }
    if (!entityId) {
      return NextResponse.json({ error: 'INVALID_ENTITY_ID — entityId is required' }, { status: 400 });
    }

    // Entity-access gate via central authorize layer
    const allowed = await authorize(session, { resource: entityType.toLowerCase() as any, action: 'update', recordId: entityId });
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const serviceCustomerId = await resolveServiceCustomerId(entityType, entityId);

    // Upsert — if a conversation already exists for this entity, return it.
    const existing = await db.conversation.findFirst({
      where: { entityType, entityId },
      include: CONVERSATION_INCLUDE,
    });
    if (existing) {
      const serialized = serializeConversation(existing);
      if (session.role === 'SERVICE_CUSTOMER') {
        serialized.comments = serialized.comments.filter(
          (c) => c.visibility === 'CUSTOMER_VISIBLE',
        );
      }
      return NextResponse.json(serialized);
    }

    const conv = await db.conversation.create({
      data: { entityType, entityId, serviceCustomerId },
      include: CONVERSATION_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'CONVERSATION_CREATED',
      entityType,
      entityId,
      after: { conversationId: conv.id },
    });

    return NextResponse.json(serializeConversation(conv), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

async function resolveServiceCustomerId(
  entityType: 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT',
  entityId: string,
): Promise<string | null> {
  try {
    if (entityType === 'TICKET') {
      const t = await db.ticket.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return t?.serviceCustomerId ?? null;
    }
    if (entityType === 'DEMAND') {
      const d = await db.demand.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return d?.serviceCustomerId ?? null;
    }
    if (entityType === 'CHANGE') {
      const c = await db.change.findUnique({
        where: { id: entityId },
        select: { originDemandId: true },
      });
      if (c?.originDemandId) {
        const d = await db.demand.findUnique({
          where: { id: c.originDemandId },
          select: { serviceCustomerId: true },
        });
        return d?.serviceCustomerId ?? null;
      }
      return null;
    }
    if (entityType === 'SLA_EVENT') {
      const e = await db.slaEvent.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return e?.serviceCustomerId ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
