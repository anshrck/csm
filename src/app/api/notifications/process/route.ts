import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { processPendingDeliveries } from '@/lib/notification-delivery';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/notifications/process
 *
 * Identical semantics to POST /api/notification-deliveries/process — triggers
 * a single pass of the notification-delivery worker. Provided as a
 * convenience alias under the /notifications namespace so the worker can be
 * triggered by callers thinking in terms of notifications rather than
 * deliveries. Also callable by SCM workers (not just CM Leaders) since it is
 * a safe idempotent maintenance action — handy when an SCM Worker just
 * submitted a batch of quote-approval requests and wants the email channel
 * flushed immediately.
 *
 * Returns the worker summary: { processed, sent, failed, skipped, durationMs }.
 */
export async function POST() {
  let session;
  try {
    session = await requireRole('CM_LEADER' as Role, 'SCM_WORKER' as Role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const result = await processPendingDeliveries();

  await auditLog({
    actor: session,
    action: 'NOTIFICATION_PROCESS_TRIGGER',
    entityType: 'NotificationDelivery',
    entityId: 'batch',
    after: result,
  });

  return NextResponse.json({
    ok: true,
    ...result,
    message: `Processed ${result.processed} delivery(ies): ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped in ${result.durationMs}ms.`,
  });
}
