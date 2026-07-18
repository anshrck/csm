import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
  ATTACHMENT_INCLUDE,
  asAttachmentEntityType,
  buildStorageKey,
  errorResponse,
  isAllowedMime,
  MAX_FILE_BYTES,
  serializeAttachment,
} from './_serialize';

export const runtime = 'nodejs';

// GET /api/attachments?entityType=DEMAND&entityId=...
// Lists attachments for an entity. All authenticated roles can list — the
// underlying entity's role scoping is enforced at the workspace layer. We do
// gate SERVICE_CUSTOMER to attachments on their own orgNode's tickets/demands
// for safety, and to their own comments.
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

    // SERVICE_CUSTOMER scope check — confirm they own the underlying entity.
    if (session.role === 'SERVICE_CUSTOMER') {
      const ok = await customerCanAccessEntity(session.id, session.orgNodeId, entityType, entityId);
      if (!ok) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const rows = await db.attachment.findMany({
      where: { entityType, entityId },
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

    // SERVICE_CUSTOMER scope check on the underlying entity.
    if (session.role === 'SERVICE_CUSTOMER') {
      const ok = await customerCanAccessEntity(session.id, session.orgNodeId, entityType, entityId);
      if (!ok) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const storageKey = buildStorageKey(fileName);
    const absPath = path.join(process.cwd(), 'public', storageKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absPath, buffer);

    const created = await db.attachment.create({
      data: {
        entityType,
        entityId,
        fileName,
        mimeType,
        sizeBytes: size,
        storageKey,
        uploadedById: session.id,
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

// SERVICE_CUSTOMER ownership check for the underlying entity.
async function customerCanAccessEntity(
  _userId: string,
  orgNodeId: string | null,
  entityType: 'TICKET' | 'DEMAND' | 'CHANGE' | 'PROBLEM' | 'SLA_EVENT' | 'COMMENT',
  entityId: string,
): Promise<boolean> {
  if (!orgNodeId) return false;
  try {
    if (entityType === 'TICKET') {
      const t = await db.ticket.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return Boolean(t && t.serviceCustomerId === orgNodeId);
    }
    if (entityType === 'DEMAND') {
      const d = await db.demand.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return Boolean(d && d.serviceCustomerId === orgNodeId);
    }
    if (entityType === 'COMMENT') {
      // A customer may upload to a comment if they can see the comment's
      // conversation (which itself is tied to their orgNode).
      const c = await db.comment.findUnique({
        where: { id: entityId },
        include: { conversation: { select: { serviceCustomerId: true } } },
      });
      return Boolean(c && c.conversation.serviceCustomerId === orgNodeId);
    }
    if (entityType === 'SLA_EVENT') {
      const e = await db.slaEvent.findUnique({
        where: { id: entityId },
        select: { serviceCustomerId: true },
      });
      return Boolean(e && e.serviceCustomerId === orgNodeId);
    }
    // CHANGE / PROBLEM are internal — customers can't attach to them directly.
    return false;
  } catch {
    return false;
  }
}
