import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  canAccessEntity,
  type EntityType,
} from '@/lib/entity-access';
import type { SessionUser } from '@/lib/types';
import {
  ATTACHMENT_INCLUDE,
  asAttachmentEntityType,
  buildStorageKey,
  errorResponse,
  isAllowedMime,
  MAX_FILE_BYTES,
  serializeAttachment,
  type AttachmentEntityType,
} from './_serialize';

export const runtime = 'nodejs';

// GET /api/attachments?entityType=DEMAND&entityId=...
// Lists attachments for an entity. All authenticated roles can list, but the
// caller must pass the entity-access gate (read) on the underlying entity.
// For COMMENT entity type we resolve the underlying conversation entity first.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const entityType = asAttachmentEntityType(sp.get('entityType'));
    const entityId = sp.get('entityId') ?? '';

    if (!entityType) {
      return NextResponse.json(
        { error: 'INVALID_ENTITY_TYPE — entityType must be TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT | COMMENT' },
        { status: 400 },
      );
    }
    if (!entityId) {
      return NextResponse.json({ error: 'INVALID_ENTITY_ID — entityId is required' }, { status: 400 });
    }

    // Entity-access gate (read) — verify the caller can read the underlying entity.
    const ok = await canAccessAttachmentEntity(session, entityType, entityId, 'read');
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const rows = await db.attachment.findMany({
      where: { entityType, entityId, tenantId },
      include: ATTACHMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(rows.map(serializeAttachment));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/attachments — multipart/form-data upload.
// Form fields:
//   entityType — TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT | COMMENT
//   entityId   — string
//   file       — the File (Blob) part
//
// Validation:
//   - max size: 10 MB
//   - allowed MIME types: image/*, application/pdf, text/*,
//     application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.*
//
// Side effects:
//   - file written to public/uploads/yyyy-mm/<random>-<name>
//   - Attachment row created with storageKey = relative path (no leading /)
//   - audit log entry ATTACHMENT_UPLOADED
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const entityType = asAttachmentEntityType(form.get('entityType'));
    const entityId = (typeof form.get('entityId') === 'string' ? String(form.get('entityId')) : '').trim();
    const file = form.get('file');

    if (!entityType) {
      return NextResponse.json(
        { error: 'INVALID_ENTITY_TYPE — entityType must be TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT | COMMENT' },
        { status: 400 },
      );
    }
    if (!entityId) {
      return NextResponse.json({ error: 'INVALID_ENTITY_ID — entityId is required' }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'INVALID_FILE — file is required' }, { status: 400 });
    }

    // We don't have a guaranteed filename from Blob — try the File subinterface.
    const fileName = (file as File).name || 'upload';
    const mimeType = file.type || 'application/octet-stream';
    const size = file.size;

    if (size === 0) {
      return NextResponse.json({ error: 'INVALID_FILE — file is empty' }, { status: 400 });
    }
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `INVALID_FILE — file exceeds ${MAX_FILE_BYTES} bytes (10 MB)` },
        { status: 413 },
      );
    }
    if (!isAllowedMime(mimeType)) {
      return NextResponse.json(
        { error: `INVALID_FILE — mime type ${mimeType} is not allowed` },
        { status: 400 },
      );
    }

    // Entity-access gate (write) — caller must be allowed to write the
    // underlying entity before we attach a file to it.
    try {
      await requireAttachmentEntityAccess(session, entityType, entityId, 'write');
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const storageKey = buildStorageKey(fileName);
    const absPath = path.join(process.cwd(), 'public', storageKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absPath, buffer);

    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const created = await db.attachment.create({
      data: {
        entityType,
        entityId,
        fileName,
        mimeType,
        sizeBytes: size,
        storageKey,
        uploadedById: session.id,
        tenantId,
      },
      include: ATTACHMENT_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'ATTACHMENT_UPLOADED',
      entityType,
      entityId,
      after: {
        attachmentId: created.id,
        fileName,
        mimeType,
        sizeBytes: size,
        storageKey,
      },
    });

    return NextResponse.json(serializeAttachment(created), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

// ---- Attachment-scoped entity-access helpers -------------------------------
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

async function requireAttachmentEntityAccess(
  session: SessionUser,
  entityType: AttachmentEntityType,
  entityId: string,
  action: 'read' | 'write',
): Promise<void> {
  const ok = await canAccessAttachmentEntity(session, entityType, entityId, action);
  if (!ok) throw new Error('FORBIDDEN');
}
