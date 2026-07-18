import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  CONVERSATION_INCLUDE,
  asEntityType,
  errorResponse,
  serializeConversation,
} from './_serialize';

export const runtime = 'nodejs';

// GET /api/conversations?entityType=DEMAND&entityId=...&createIfMissing=1
// Returns the conversation (with comments) for the given entity, optionally
// creating one if it does not yet exist. SERVICE_CUSTOMER callers may only
// read conversations tied to their own orgNode; we resolve the customer id
// from the underlying entity (DEMAND / TICKET) when possible.
//
// Query params:
//   entityType (required) — TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT
//   entityId   (required) — entity id
//   createIfMissing (optional, default 0) — if '1', upsert a conversation
//
// Role scoping (visibility is enforced on the comments array):
//   SERVICE_CUSTOMER → CUSTOMER_VISIBLE comments only, and only for entities
//                       in their orgNode.
//   SCM_WORKER       → all comments for entities they're assigned to
//                       (or any entity if no assignment mapping exists).
//   CM_LEADER        → all comments.
//   SERVICE_OWNER    → all comments for entities tied to services they own.
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

    // Resolve the owning serviceCustomerId for the entity so we can scope
    // SERVICE_CUSTOMER reads. Returns null if not applicable.
    const serviceCustomerId = await resolveServiceCustomerId(entityType, entityId);

    // SERVICE_CUSTOMER scope check: must own the underlying entity.
    if (session.role === 'SERVICE_CUSTOMER') {
      if (!session.orgNodeId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!serviceCustomerId || serviceCustomerId !== session.orgNodeId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    let conv = await db.conversation.findFirst({
      where: { entityType, entityId },
      include: CONVERSATION_INCLUDE,
    });

    if (!conv && createIfMissing) {
      // Only internal roles + the owning customer can seed a conversation.
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
      // Return an empty-shell shape so the frontend can render the input box.
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
// Body: { entityType, entityId }
// Useful when the caller wants to guarantee the shell exists before posting
// the first comment (the comments POST route also auto-creates the shell).
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

    const serviceCustomerId = await resolveServiceCustomerId(entityType, entityId);

    if (session.role === 'SERVICE_CUSTOMER') {
      if (!session.orgNodeId || !serviceCustomerId || serviceCustomerId !== session.orgNodeId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

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

// Resolve the serviceCustomerId (OrgNode id) for an entity, when applicable.
// Returns null for entity types that aren't customer-owned (CHANGE, PROBLEM,
// SLA_EVENT are internal — we still attempt to derive from originDemand).
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
      // Derive customer through origin demand, if any.
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
    // PROBLEM has no direct customer link in the schema — return null.
    return null;
  } catch {
    return null;
  }
}
