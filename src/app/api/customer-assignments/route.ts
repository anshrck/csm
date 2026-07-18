import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import {
  ASSIGNMENT_INCLUDE,
  serializeAssignment,
  errorResponse,
  type AssignmentRow,
} from './_serialize';

export const runtime = 'nodejs';

/**
 * GET /api/customer-assignments
 *
 * List CustomerAssignment rows — the SCM Worker → customer org mapping used to
 * scope ticket visibility and demand routing.
 *
 * Query params:
 *   userId=<id>      restrict to assignments for a specific SCM Worker
 *   orgNodeId=<id>   restrict to assignments for a specific customer org
 *   active=1         only active assignments (default: all)
 *
 * Role scoping:
 *   CM_LEADER → all assignments (the leadership layer owns scoping decisions).
 *   SCM_WORKER → only their own assignments (so they can see which customers
 *                they're accountable for).
 *   SERVICE_OWNER / SERVICE_CUSTOMER → not allowed (403).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (session.role !== 'CM_LEADER' && session.role !== 'SCM_WORKER') {
      return NextResponse.json(
        { error: 'Forbidden — only CM Leaders and SCM Workers may view customer assignments' },
        { status: 403 },
      );
    }

    const sp = req.nextUrl.searchParams;
    const userId = sp.get('userId');
    const orgNodeId = sp.get('orgNodeId');
    const active = sp.get('active');

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (userId) and.push({ userId });
    if (orgNodeId) and.push({ orgNodeId });
    if (active === '1') and.push({ active: true });

    if (session.role === 'SCM_WORKER') {
      and.push({ userId: session.id });
    }

    if (and.length === 0) delete where.AND;

    const rows = await db.customerAssignment.findMany({
      where,
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });

    return NextResponse.json(rows.map((r) => serializeAssignment(r as AssignmentRow)));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/customer-assignments
 *
 * Create a new CustomerAssignment (assign a customer org to an SCM Worker).
 * CM_LEADER only.
 *
 * Body:
 *   orgNodeId  required — customer org node id
 *   userId     required — SCM Worker user id
 *   role       optional — SCM_OWNER (default) | BACKUP | ESCALATION_MANAGER
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole('CM_LEADER' as Role);

    const body = await req.json().catch(() => ({}));
    const orgNodeId = typeof body.orgNodeId === 'string' ? body.orgNodeId.trim() : '';
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const role =
      typeof body.role === 'string' &&
      ['SCM_OWNER', 'BACKUP', 'ESCALATION_MANAGER'].includes(body.role)
        ? body.role
        : 'SCM_OWNER';

    if (!orgNodeId) {
      return NextResponse.json({ error: 'INVALID_ORG_NODE_ID — orgNodeId is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'INVALID_USER_ID — userId is required' }, { status: 400 });
    }

    // Verify the org node exists.
    const org = await db.orgNode.findUnique({
      where: { id: orgNodeId },
      select: { id: true, name: true, type: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'INVALID_ORG_NODE_ID — not found' }, { status: 404 });
    }

    // Verify the user exists and is an SCM Worker.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'INVALID_USER_ID — not found' }, { status: 404 });
    }
    if (user.role !== 'SCM_WORKER') {
      return NextResponse.json(
        { error: 'INVALID_USER_ID — assignee must be an SCM Worker' },
        { status: 400 },
      );
    }

    // Unique constraint guard — [orgNodeId, userId, role].
    const existing = await db.customerAssignment.findUnique({
      where: {
        orgNodeId_userId_role: { orgNodeId, userId, role },
      },
    });
    if (existing) {
      // If the assignment exists but was deactivated, reactivate it instead of 409.
      if (!existing.active) {
        const reactivated = await db.customerAssignment.update({
          where: { id: existing.id },
          data: { active: true },
          include: ASSIGNMENT_INCLUDE,
        });
        await auditLog({
          actor: session,
          action: 'CUSTOMER_ASSIGNMENT_REACTIVATED',
          entityType: 'CustomerAssignment',
          entityId: existing.id,
          after: { orgNodeId, orgNodeName: org.name, userId, userName: user.name, role },
        });
        return NextResponse.json(serializeAssignment(reactivated as AssignmentRow), { status: 200 });
      }
      return NextResponse.json(
        { error: 'CONFLICT — this assignment already exists' },
        { status: 409 },
      );
    }

    const created = await db.customerAssignment.create({
      data: { orgNodeId, userId, role, active: true },
      include: ASSIGNMENT_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'CUSTOMER_ASSIGNMENT_CREATED',
      entityType: 'CustomerAssignment',
      entityId: created.id,
      after: { orgNodeId, orgNodeName: org.name, userId, userName: user.name, role },
    });

    return NextResponse.json(serializeAssignment(created as AssignmentRow), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
