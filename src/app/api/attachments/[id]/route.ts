import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { ATTACHMENT_INCLUDE, errorResponse, serializeAttachment } from '../_serialize';

export const runtime = 'nodejs';

// GET /api/attachments/[id] — metadata for a single attachment.
// SERVICE_CUSTOMER may only fetch metadata for attachments on entities they own.
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
      include: ATTACHMENT_INCLUDE,
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (session.role === 'SERVICE_CUSTOMER') {
      // Verify ownership of the underlying entity.
      const ok = await customerOwnsEntity(session.orgNodeId, row.entityType, row.entityId);
      if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

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
    const row = await db.attachment.findUnique({
      where: { id },
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

async function customerOwnsEntity(
  orgNodeId: string | null,
  entityType: string,
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
    return false;
  } catch {
    return false;
  }
}
