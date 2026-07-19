import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { canAccessEntity, type EntityType } from '@/lib/entity-access';
import type { SessionUser } from '@/lib/types';
import {
  ATTACHMENT_INCLUDE,
  errorResponse,
  serializeAttachment,
  type AttachmentEntityType,
} from '../_serialize';

export const runtime = 'nodejs';

// GET /api/attachments/[id] — metadata for a single attachment.
// Caller must pass the entity-access gate (read) on the underlying entity.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const row = await db.attachment.findFirst({
      where: { id, tenantId },
      include: ATTACHMENT_INCLUDE,
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ok = await canAccessAttachmentEntity(
      session,
      row.entityType as AttachmentEntityType,
      row.entityId,
      'read',
    );
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(serializeAttachment(row));
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/attachments/[id]
// Allowed: the uploader OR a CM_LEADER (governance override).
// Removes the file from disk + the DB row. Writes an audit log entry.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const row = await db.attachment.findFirst({
      where: { id, tenantId },
      include: ATTACHMENT_INCLUDE,
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isUploader = row.uploadedById === session.id;
    const isCmLeader = session.role === 'CM_LEADER';
    if (!isUploader && !isCmLeader) {
      return NextResponse.json(
        { error: 'Forbidden — only the uploader or a CM Leader may delete an attachment' },
        { status: 403 },
      );
    }

    // Best-effort file removal — never block the DB delete on disk errors.
    try {
      const abs = path.join(process.cwd(), 'public', row.storageKey);
      await fs.unlink(abs);
    } catch {
      /* file may already be gone — ignore */
    }

    await db.attachment.delete({ where: { id } });

    await auditLog({
      actor: session,
      action: 'ATTACHMENT_DELETED',
      entityType: row.entityType,
      entityId: row.entityId,
      before: {
        attachmentId: row.id,
        fileName: row.fileName,
        storageKey: row.storageKey,
        sizeBytes: row.sizeBytes,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

// ---- Attachment-scoped entity-access helper --------------------------------
//
// Attachments can attach to COMMENT as well as the canonical entity types in
// `EntityType`. For COMMENT, we resolve the underlying conversation (and its
// owning entity) before delegating to the entity-access helper.

async function resolveCommentUnderlyingEntity(
  commentId: string,
): Promise<{ entityType: EntityType; entityId: string } | null> {
  const c = await db.comment.findUnique({
    where: { id: commentId },
    include: { conversation: { select: { entityType: true, entityId: true } } },
  });
  if (!c) return null;
  return {
    entityType: c.conversation.entityType as EntityType,
    entityId: c.conversation.entityId,
  };
}

async function canAccessAttachmentEntity(
  session: SessionUser,
  entityType: AttachmentEntityType,
  entityId: string,
  action: 'read' | 'write',
): Promise<boolean> {
  if (entityType === 'COMMENT') {
    const underlying = await resolveCommentUnderlyingEntity(entityId);
    if (!underlying) return false;
    return canAccessEntity(session, underlying.entityType, underlying.entityId, action);
  }
  return canAccessEntity(session, entityType as EntityType, entityId, action);
}
