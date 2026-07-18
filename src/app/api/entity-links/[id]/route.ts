import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessEntity } from '@/lib/entity-access';
import type { EntityType } from '@/lib/entity-access';
import { auditLog } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * DELETE /api/entity-links/[id]
 *
 * Remove an EntityLink. Caller must have write access to BOTH sides of the
 * link (we resolve them from the row before deleting). Audit log entry is
 * recorded with the link's pre-deletion state.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing link id' }, { status: 400 });

  const link = await db.entityLink.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [fromOk, toOk] = await Promise.all([
    canAccessEntity(session, link.fromType as EntityType, link.fromId, 'write'),
    canAccessEntity(session, link.toType as EntityType, link.toId, 'write'),
  ]);
  if (!fromOk || !toOk) {
    return NextResponse.json({ error: 'Forbidden — cannot access one or both entities' }, { status: 403 });
  }

  const beforeSnapshot = {
    id: link.id,
    fromType: link.fromType,
    fromId: link.fromId,
    toType: link.toType,
    toId: link.toId,
    linkType: link.linkType,
    createdBy: link.createdBy,
  };

  await db.entityLink.delete({ where: { id } });

  await auditLog({
    actor: session,
    action: 'ENTITY_LINK_DELETED',
    entityType: 'EntityLink',
    entityId: link.id,
    before: beforeSnapshot,
  });

  return NextResponse.json({ ok: true });
}
