/**
 * CereBree uSMS — Notification Delivery Worker (Phase 9 item 21)
 *
 * `processPendingDeliveries()` finds every PENDING NotificationDelivery row
 * and attempts to "send" it:
 *
 *   - PORTAL channel: mark SENT immediately (in-app notification).
 *   - EMAIL channel:  console.log the would-be email payload, then mark SENT.
 *   - TEAMS channel:  console.log the would-be Teams message, then mark SENT.
 *   - SLACK channel:  console.log the would-be Slack message, then mark SENT.
 *
 * A 5% simulated failure rate (per delivery, not per batch) is applied to
 * EMAIL/TEAMS/SLACK for demo realism — PORTAL never fails (it is just a DB
 * flag flip). Failed deliveries are marked FAILED with an error message and
 * left for the operator to inspect via the /api/notification-deliveries API.
 *
 * This function is:
 *   - Called by the in-process watchdog tick (every 60s) — see watchdog.ts.
 *   - Exposed via POST /api/notifications/process and
 *     POST /api/notification-deliveries/process for manual / cron triggers.
 *
 * It is fully idempotent — running it twice is safe (SENT/FAILED deliveries
 * are skipped).
 */
import { db } from './db';

export interface DeliveryProcessingResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

const FAILURE_RATE = 0.05; // 5% simulated failure on EMAIL/TEAMS/SLACK
const MAX_BATCH = 100; // cap per tick so the watchdog never blocks for too long

interface PendingDeliveryRow {
  id: string;
  channel: string;
  notificationId: string;
  notification: {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    entityRef: string | null;
    user: { email: string; name: string } | null;
  };
}

/**
 * Process all PENDING NotificationDelivery rows.
 *
 * Returns a summary object — useful for logging and for the API endpoints
 * that surface the result to the caller.
 */
export async function processPendingDeliveries(): Promise<DeliveryProcessingResult> {
  const startedAt = Date.now();

  const pending = await db.notificationDelivery.findMany({
    where: { status: 'PENDING' },
    take: MAX_BATCH,
    orderBy: { createdAt: 'asc' },
    include: {
      notification: {
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          message: true,
          entityRef: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const d of pending as unknown as PendingDeliveryRow[]) {
    try {
      const result = await deliverOne(d);
      if (result === 'SENT') sent++;
      else if (result === 'FAILED') failed++;
      else skipped++;
    } catch (err) {
      // Defensive — should never throw because deliverOne catches internally,
      // but if it ever does, mark the delivery FAILED and continue.
      const errorMsg = err instanceof Error ? err.message : 'Unknown delivery error';
      try {
        await db.notificationDelivery.update({
          where: { id: d.id },
          data: { status: 'FAILED', error: errorMsg },
        });
      } catch {
        /* ignore — best effort */
      }
      failed++;
    }
  }

  return {
    processed: pending.length,
    sent,
    failed,
    skipped,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Process a single PENDING delivery. Returns 'SENT' | 'FAILED' | 'SKIPPED'.
 *
 * The function is defensive: any unexpected error is caught and converted to
 * a FAILED status with an error message rather than throwing.
 */
async function deliverOne(d: PendingDeliveryRow): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
  const n = d.notification;
  const user = n.user;

  // PORTAL — always succeeds (it's just an in-app flag flip).
  if (d.channel === 'PORTAL') {
    await db.notificationDelivery.update({
      where: { id: d.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
    return 'SENT';
  }

  // EMAIL / TEAMS / SLACK — simulate sending with a 5% random failure rate.
  // The simulation logs the would-be payload to the server console so the
  // operator can see what would have been sent.
  const channel = d.channel as 'EMAIL' | 'TEAMS' | 'SLACK';

  // Simulate a transient delivery failure for demo realism.
  if (Math.random() < FAILURE_RATE) {
    const error = simulateChannelError(channel);
    console.error(`[notification-delivery] ${channel} send FAILED for notification ${d.notificationId} → ${n.type}: ${error}`);
    await db.notificationDelivery.update({
      where: { id: d.id },
      data: { status: 'FAILED', error },
    });
    return 'FAILED';
  }

  // Log the would-be payload (this is the "simulate sending" step).
  logChannelSend(channel, n, user);

  await db.notificationDelivery.update({
    where: { id: d.id },
    data: { status: 'SENT', sentAt: new Date() },
  });
  return 'SENT';
}

function logChannelSend(
  channel: 'EMAIL' | 'TEAMS' | 'SLACK',
  n: PendingDeliveryRow['notification'],
  user: { email: string; name: string } | null,
): void {
  const to = user?.email ?? '(unknown user)';
  const name = user?.name ?? 'User';
  const subject = n.title;
  const body = n.message;
  const ref = n.entityRef ? ` [ref: ${n.entityRef}]` : '';

  if (channel === 'EMAIL') {
    console.log(
      `[EMAIL] To: ${to} | Subject: ${subject} | Body: ${body}${ref}`,
    );
  } else if (channel === 'TEAMS') {
    console.log(
      `[TEAMS] To: ${name} <${to}> | Title: ${subject} | Message: ${body}${ref}`,
    );
  } else if (channel === 'SLACK') {
    console.log(
      `[SLACK] To: ${name} | ${subject} — ${body}${ref}`,
    );
  }
}

function simulateChannelError(channel: 'EMAIL' | 'TEAMS' | 'SLACK'): string {
  const errors = {
    EMAIL: [
      'SMTP 421 service not available (simulated)',
      'Recipient mailbox full (simulated)',
      'Connection timed out to mail relay (simulated)',
    ],
    TEAMS: [
      'Microsoft Graph 503 service unavailable (simulated)',
      'Webhook URL expired (simulated)',
      'Bot rate limit exceeded (simulated)',
    ],
    SLACK: [
      'Slack API 429 too many requests (simulated)',
      'Channel not found (simulated)',
      'Webhook returned 400 invalid payload (simulated)',
    ],
  } as const;
  const list = errors[channel];
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Stats helper for the API oversight view — returns counts by status + channel.
 * Used by GET /api/notification-deliveries.
 */
export async function getDeliveryStats(): Promise<{
  byStatus: Record<string, number>;
  byChannel: Record<string, Record<string, number>>;
  total: number;
  pending: number;
  sent: number;
  failed: number;
}> {
  const rows = await db.notificationDelivery.findMany({
    select: { id: true, channel: true, status: true },
  });
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (!byChannel[r.channel]) byChannel[r.channel] = {};
    byChannel[r.channel][r.status] = (byChannel[r.channel][r.status] ?? 0) + 1;
  }
  return {
    byStatus,
    byChannel,
    total: rows.length,
    pending: byStatus['PENDING'] ?? 0,
    sent: byStatus['SENT'] ?? 0,
    failed: byStatus['FAILED'] ?? 0,
  };
}

export {};
