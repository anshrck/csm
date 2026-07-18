import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  CONVERSATION_INCLUDE,
  errorResponse,
  serializeComment,
  serializeConversation,
} from '../../_serialize';

export const runtime = 'nodejs';

const VALID_VISIBILITY = new Set(['CUSTOMER_VISIBLE', 'INTERNAL']);

// GET /api/conversations/[id]/comments
// Returns the comments on a conversation. SERVICE_CUSTOMER only sees
// CUSTOMER_VISIBLE comments; all other roles see the full thread.
//
// Role scoping on the conversation itself mirrors the conversations GET
// route: SERVICE_CUSTOMER may only read conversations tied to their orgNode.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const conv = await db.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (session.role === 'SERVICE_CUSTOMER') {
      if (!session.orgNodeId || !conv.serviceCustomerId || conv.serviceCustomerId !== session.orgNodeId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    let comments = conv.comments;
    if (session.role === 'SERVICE_CUSTOMER') {
      comments = comments.filter((c) => c.visibility === 'CUSTOMER_VISIBLE');
    }
    return NextResponse.json(comments.map(serializeComment));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/conversations/[id]/comments
// Body: { body: string, visibility: 'CUSTOMER_VISIBLE' | 'INTERNAL' }
//
// Visibility rules:
//   SERVICE_CUSTOMER → CUSTOMER_VISIBLE only.
//   SCM_WORKER / CM_LEADER → either visibility.
//   SERVICE_OWNER → either visibility (governance commentary is allowed).
//
// Side effects:
//   - comment row inserted, conversation.updatedAt bumped.
//   - audit log entry COMMENT_CREATED.
//   - if a CUSTOMER_VISIBLE comment is posted by an internal role on a
//     customer-owned conversation, notify the customer org's
//     SERVICE_CUSTOMER users.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const conv = await db.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // SERVICE_CUSTOMER scope check (mirror GET /api/conversations).
    if (session.role === 'SERVICE_CUSTOMER') {
      if (!session.orgNodeId || !conv.serviceCustomerId || conv.serviceCustomerId !== session.orgNodeId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'INVALID_BODY — body is required' }, { status: 400 });
    }
    const visibility = typeof body.visibility === 'string' ? body.visibility : 'CUSTOMER_VISIBLE';
    if (!VALID_VISIBILITY.has(visibility)) {
      return NextResponse.json(
        { error: 'INVALID_VISIBILITY — must be CUSTOMER_VISIBLE or INTERNAL' },
        { status: 400 },
      );
    }

    // SERVICE_CUSTOMER cannot post INTERNAL comments.
    if (session.role === 'SERVICE_CUSTOMER' && visibility === 'INTERNAL') {
      return NextResponse.json(
        { error: 'Forbidden — customers can only post CUSTOMER_VISIBLE comments' },
        { status: 403 },
      );
    }

    const created = await db.comment.create({
      data: {
        conversationId: conv.id,
        authorId: session.id,
        authorName: session.name,
        visibility,
        body: text,
      },
      include: { author: true },
    });

    // Bump conversation.updatedAt so lists can sort by recent activity.
    await db.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    });

    await auditLog({
      actor: session,
      action: 'COMMENT_CREATED',
      entityType: conv.entityType,
      entityId: conv.entityId,
      after: {
        conversationId: conv.id,
        commentId: created.id,
        visibility,
        bodyPreview: text.slice(0, 200),
      },
    });

    // Notify the customer org on internal→customer-visible thread posts.
    if (visibility === 'CUSTOMER_VISIBLE' && conv.serviceCustomerId && session.role !== 'SERVICE_CUSTOMER') {
      const customerUsers = await db.user.findMany({
        where: {
          role: 'SERVICE_CUSTOMER',
          orgNodeId: conv.serviceCustomerId,
        },
        select: { id: true },
      });
      if (customerUsers.length) {
        await db.notification.createMany({
          data: customerUsers.map((u) => ({
            userId: u.id,
            type: 'CommunicationReceived',
            title: 'New comment on your request',
            message: `${session.name}: ${text.slice(0, 140)}`,
            entityRef: `${conv.entityType.toLowerCase()}:${conv.entityId}`,
          })),
        });
      }
    }

    // Re-serialize the full conversation so callers can refresh in one shot.
    const fresh = await db.conversation.findUnique({
      where: { id: conv.id },
      include: CONVERSATION_INCLUDE,
    });
    if (!fresh) {
      // Edge case — return the single comment.
      return NextResponse.json(serializeComment(created), { status: 201 });
    }
    const serialized = serializeConversation(fresh);
    if (session.role === 'SERVICE_CUSTOMER') {
      serialized.comments = serialized.comments.filter(
        (c) => c.visibility === 'CUSTOMER_VISIBLE',
      );
    }
    return NextResponse.json(serialized, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
