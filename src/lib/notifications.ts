/**
 * CereBree uSMS — Notification creation helper (Phase 9 item 21)
 *
 * Provides `createNotificationWithDelivery` — the canonical way to create a
 * Notification AND its PORTAL NotificationDelivery in a single atomic call.
 * The watchdog's notification-delivery worker (see `notification-delivery.ts`)
 * picks up the PENDING PORTAL delivery on its next tick and flips it to SENT.
 *
 * Going forward, every API route that creates a Notification should call this
 * helper instead of `db.notification.create(...)`. Existing routes that still
 * use the raw Prisma call are NOT refactored here — they keep working because
 * the in-app drawer reads the Notification row directly, and the delivery
 * worker simply won't have a PORTAL delivery to flip for those older rows
 * (harmless — the row already shows up in the portal). New notifications
 * created via this helper benefit from the full delivery audit trail.
 */
import { db } from './db';

export type NotificationChannel = 'EMAIL' | 'TEAMS' | 'SLACK' | 'PORTAL';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityRef?: string | null;
  /**
   * Optional extra channels to schedule in addition to the always-on PORTAL
   * channel. Defaults to `[]` (PORTAL-only). When the caller passes extra
   * channels (e.g. `['EMAIL']`), the worker will attempt to "send" them on
   * the next tick — see `notification-delivery.ts`.
   */
  extraChannels?: NotificationChannel[];
}

export interface CreatedNotification {
  id: string;
  deliveries: { id: string; channel: string; status: string }[];
}

/**
 * Create a Notification + its PORTAL NotificationDelivery (status=PENDING).
 *
 * The PORTAL channel is ALWAYS created so the in-app notification drawer
 * works. Extra channels (EMAIL/TEAMS/SLACK) are also scheduled as PENDING
 * deliveries when supplied — the watchdog worker will pick them up.
 *
 * This is a single $transaction so a partial failure can never leave a
 * Notification without its PORTAL delivery.
 */
export async function createNotificationWithDelivery(
  input: CreateNotificationInput,
): Promise<CreatedNotification> {
  const channels: NotificationChannel[] = ['PORTAL', ...(input.extraChannels ?? [])];

  const result = await db.$transaction(async (tx) => {
    const notification = await tx.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityRef: input.entityRef ?? null,
      },
    });
    await tx.notificationDelivery.createMany({
      data: channels.map((channel) => ({
        notificationId: notification.id,
        channel,
        status: 'PENDING' as const,
      })),
    });
    return notification;
  });

  const deliveries = await db.notificationDelivery.findMany({
    where: { notificationId: result.id },
    select: { id: true, channel: true, status: true },
  });

  return { id: result.id, deliveries };
}

/**
 * Batch variant — create the same notification for multiple users.
 * Each user gets their own Notification row + their own PORTAL delivery.
 * Useful for fan-out notifications (e.g. notify all CM_LEADER users).
 */
export async function createNotificationsWithDelivery(
  userIds: string[],
  payload: Omit<CreateNotificationInput, 'userId'>,
): Promise<CreatedNotification[]> {
  if (userIds.length === 0) return [];
  const out: CreatedNotification[] = [];
  // Create sequentially to keep transactions small and avoid locking the
  // whole Notification table. Fan-out targets are typically ≤10 users.
  for (const userId of userIds) {
    out.push(await createNotificationWithDelivery({ ...payload, userId }));
  }
  return out;
}

export {};
