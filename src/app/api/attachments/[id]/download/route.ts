import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessEntity, type EntityType } from '@/lib/entity-access';
import type { SessionUser } from '@/lib/types';
import { errorResponse, type AttachmentEntityType } from '../../_serialize';

export const runtime = 'nodejs';

// GET /api/attachments/[id]/download
//
// Streams the file to the client with the proper Content-Type and
// Content-Disposition headers. Access-controlled — the caller must pass the
// entity-access gate (read) on the underlying entity before the file is sent.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const row = await db.attachment.findUnique({
      where: { id },
      include: { uploader: { select: { id: true, name: true } } },
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Entity-access gate (read).
    const ok = await canAccessAttachmentEntity(
      session,
      row.entityType as AttachmentEntityType,
      row.entityId,
      'read',
    );
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const abs = path.join(process.cwd(), 'public', row.storageKey);
    let data: Buffer;
    try {
      data = await fs.readFile(abs);
    } catch {
      return NextResponse.json(
        { error: 'File is no longer available on disk' },
        { status: 410 },
      );
    }

    // Encode filename for Content-Disposition (RFC 5987). Falls back to a
    // sanitized ASCII-only filename for the `filename=` parameter.
    const safeAscii = row.fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '');
    const encoded = encodeURIComponent(row.fileName);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': row.mimeType || 'application/octet-stream',
        'Content-Length': String(data.length),
        'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
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
