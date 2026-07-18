import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getDeliveryStats } from '@/lib/notification-delivery';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/notification-deliveries
 *
 * Lists NotificationDelivery rows with filters:
 *   notificationId — only deliveries for a specific notification
 *   status         — PENDING | SENT | FAILED (or comma-separated multi)
 *   channel        — PORTAL | EMAIL | TEAMS | SLACK (or comma-separated multi)
 *   scope=mine     — only deliveries for the caller's own notifications
 *
 * Role scoping:
 *   - CM_LEADER  → oversight: sees all deliveries across the tenant.
 *   - Other roles → only deliveries for their own notifications (scope=mine
 *     is implicit for non-CM_LEADER users so they cannot enumerate other
 *     users' delivery records).
 *
 * Response includes the parent notification (title, type, entityRef) so the
 * CM Leader oversight view can render without an extra fetch round-trip.
 *
 * Also supports `?stats=1` to return only aggregate counts (no rows) — used
 * by the delivery-overview panel.
 */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole(
      'CM_LEADER' as Role,
      'SCM_WORKER' as Role,
      'SERVICE_OWNER' as Role,
      'SERVICE_CUSTOMER' as Role,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;

  // Stats-only fast path — returns aggregate counts (no row enumeration).
  if (sp.get('stats') === '1') {
    const stats = await getDeliveryStats();
    return NextResponse.json(stats);
  }

  // Build where clause.
  const where: Record<string, unknown> = { AND: [] as Record<string, unknown>[] };
  const and = where.AND as Array<Record<string, unknown>>;

  const notificationId = sp.get('notificationId');
  if (notificationId) and.push({ notificationId });

  const statusCsv = sp.get('status');
  if (statusCsv) {
    const statuses = statusCsv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (statuses.length) and.push({ status: { in: statuses } });
  }

  const channelCsv = sp.get('channel');
  if (channelCsv) {
    const channels = channelCsv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (channels.length) and.push({ channel: { in: channels } });
  }

  // Role scoping.
  const isCmLeader = session.role === 'CM_LEADER';
  const scopeMine = sp.get('scope') === 'mine';
  if (!isCmLeader || scopeMine) {
    // Non-CM-Leader callers (and CM Leaders who explicitly pass scope=mine)
    // only see deliveries for their own notifications.
    and.push({ notification: { userId: session.id } });
  }

  if (and.length === 0) delete where.AND;

  const limit = Math.min(parseInt(sp.get('limit') ?? '200', 10) || 200, 500);

  const rows = await db.notificationDelivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      notification: {
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          entityRef: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, avatarColor: true } },
        },
      },
    },
  });

  const serialized = rows.map((r) => ({
    id: r.id,
    notificationId: r.notificationId,
    channel: r.channel,
    status: r.status,
    error: r.error,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    notification: {
      id: r.notification.id,
      userId: r.notification.userId,
      type: r.notification.type,
      title: r.notification.title,
      entityRef: r.notification.entityRef,
      createdAt: r.notification.createdAt.toISOString(),
      user: r.notification.user
        ? {
            id: r.notification.user.id,
            name: r.notification.user.name,
            email: r.notification.user.email,
            avatarColor: r.notification.user.avatarColor,
          }
        : null,
    },
  }));

  return NextResponse.json(serialized);
}

/**
 * POST /api/notification-deliveries
 *
 * Manually schedule an extra delivery for an existing notification — used by
 * the CM Leader oversight view to retry or add a channel after the fact.
 *
 * Body: { notificationId, channel: 'EMAIL'|'TEAMS'|'SLACK'|'PORTAL' }
 *
 * CM_LEADER only. Creates a PENDING delivery; the worker picks it up on the
 * next tick.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole('CM_LEADER' as Role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN')
      return NextResponse.json({ error: 'Forbidden — CM Leader only' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const notificationId = typeof body?.notificationId === 'string' ? body.notificationId.trim() : '';
  const channel = typeof body?.channel === 'string' ? body.channel.trim().toUpperCase() : '';

  if (!notificationId)
    return NextResponse.json({ error: 'notificationId is required' }, { status: 400 });
  const validChannels = new Set(['EMAIL', 'TEAMS', 'SLACK', 'PORTAL']);
  if (!validChannels.has(channel)) {
    return NextResponse.json(
      { error: 'channel must be EMAIL | TEAMS | SLACK | PORTAL' },
      { status: 400 },
    );
  }

  // Verify the notification exists.
  const notification = await db.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, title: true },
  });
  if (!notification) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });

  // Idempotent: if a PENDING delivery already exists for the same channel,
  // return it instead of creating a duplicate.
  const existing = await db.notificationDelivery.findFirst({
    where: { notificationId, channel, status: 'PENDING' },
  });
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      notificationId: existing.notificationId,
      channel: existing.channel,
      status: existing.status,
      createdAt: existing.createdAt.toISOString(),
      reused: true,
    });
  }

  const created = await db.notificationDelivery.create({
    data: { notificationId, channel, status: 'PENDING' },
  });

  await auditLog({
    actor: session,
    action: 'NOTIFICATION_DELIVERY_SCHEDULE',
    entityType: 'NotificationDelivery',
    entityId: created.id,
    after: { notificationId, channel, status: 'PENDING' },
  });

  return NextResponse.json(
    {
      id: created.id,
      notificationId: created.notificationId,
      channel: created.channel,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      reused: false,
    },
    { status: 201 },
  );
}

