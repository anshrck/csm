import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { processPendingDeliveries } from '@/lib/notification-delivery';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/notification-deliveries/process
 *
 * Trigger a single pass of the notification-delivery worker. Finds PENDING
 * deliveries (up to 100 per call) and attempts to "send" them:
 *   - PORTAL → SENT immediately
 *   - EMAIL / TEAMS / SLACK → console.log the would-be payload, mark SENT
 *     (with a 5% simulated failure rate for demo realism)
 *
 * CM_LEADER only — this is an operational oversight action. The in-process
 * watchdog also calls this every tick automatically; this endpoint exists so
 * the operator can trigger an immediate flush after a known burst of
 * notifications (e.g. just approved a batch of quotes).
 *
 * Returns the worker summary: { processed, sent, failed, skipped, durationMs }.
 */
export async function POST(_req: NextRequest) {
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

  const result = await processPendingDeliveries();

  await auditLog({
    actor: session,
    action: 'NOTIFICATION_DELIVERY_PROCESS',
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
