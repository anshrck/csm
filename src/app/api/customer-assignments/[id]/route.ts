import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import {
  ASSIGNMENT_INCLUDE,
  serializeAssignment,
  errorResponse,
  type AssignmentRow,
} from '../_serialize';

export const runtime = 'nodejs';

/**
 * GET /api/customer-assignments/[id]
 *
 * Fetch a single CustomerAssignment by id. CM_LEADER only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole('CM_LEADER' as Role);
    const { id } = await params;

    const row = await db.customerAssignment.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json(serializeAssignment(row as AssignmentRow));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/customer-assignments/[id]
 *
 * Update an assignment's `active` flag or `role`.
 * CM_LEADER only.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('CM_LEADER' as Role);
    const { id } = await params;

    const existing = await db.customerAssignment.findUnique({
      where: { id },
      include: {
        orgNode: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (typeof body.active === 'boolean') data.active = body.active;
    if (
      typeof body.role === 'string' &&
      ['SCM_OWNER', 'BACKUP', 'ESCALATION_MANAGER'].includes(body.role)
    ) {
      data.role = body.role;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields supplied (active, role)' },
        { status: 400 },
      );
    }

    const updated = await db.customerAssignment.update({
      where: { id },
      data,
      include: ASSIGNMENT_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'CUSTOMER_ASSIGNMENT_UPDATED',
      entityType: 'CustomerAssignment',
      entityId: id,
      before: {
        active: existing.active,
        role: existing.role,
        orgNodeName: existing.orgNode.name,
        userName: existing.user.name,
      },
      after: {
        active: updated.active,
        role: updated.role,
        orgNodeName: updated.orgNode.name,
        userName: updated.user.name,
      },
    });

    return NextResponse.json(serializeAssignment(updated as AssignmentRow));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/customer-assignments/[id]
 *
 * Hard-delete the row. CM_LEADER only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('CM_LEADER' as Role);
    const { id } = await params;

    const existing = await db.customerAssignment.findUnique({
      where: { id },
      include: {
        orgNode: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    await db.customerAssignment.delete({ where: { id } });

    await auditLog({
      actor: session,
      action: 'CUSTOMER_ASSIGNMENT_DELETED',
      entityType: 'CustomerAssignment',
      entityId: id,
      before: {
        orgNodeId: existing.orgNodeId,
        orgNodeName: existing.orgNode.name,
        userId: existing.userId,
        userName: existing.user.name,
        role: existing.role,
        active: existing.active,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
