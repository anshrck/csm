import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { errorResponse, serializeComment } from '../../_serialize';

export const runtime = 'nodejs';

// PATCH /api/conversations/comments/[id]
// Body: { body: string }
// Author only — sets body + editedAt = now(). Visibility cannot be changed.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const comment = await db.comment.findUnique({
      where: { id },
      include: { conversation: true, author: true },
    });
    if (!comment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (comment.authorId !== session.id) {
      return NextResponse.json(
        { error: 'Forbidden — only the author may edit a comment' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'INVALID_BODY — body is required' }, { status: 400 });
    }

    const before = {
      body: comment.body,
      editedAt: comment.editedAt,
    };

    const updated = await db.comment.update({
      where: { id },
      data: { body: text, editedAt: new Date() },
      include: { author: true },
    });

    await auditLog({
      actor: session,
      action: 'COMMENT_EDITED',
      entityType: comment.conversation.entityType,
      entityId: comment.conversation.entityId,
      before,
      after: { body: text, editedAt: updated.editedAt },
    });

    return NextResponse.json(serializeComment(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
