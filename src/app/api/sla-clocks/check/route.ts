import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/sla-clocks/check
 *
 * Trigger SLA breach detection + early-warning generation. This is the
 * engine tick normally invoked by the watchdog or a cron-like scheduler.
 *
 * Auth:
 *   - Any authenticated user (manual trigger from admin UI), OR
 *   - A caller presenting `x-system-token` matching `process.env.SYSTEM_TRIGGER_TOKEN`
 *     (for the watchdog / external scheduler).
 *
 * Idempotent: only RUNNING clocks are considered, so re-running on the same
 * state is a no-op.
 *
 * Two passes:
 *   1. BREACH pass — find every RUNNING clock with dueAt < now; mark it
 *      BREACHED (breachedAt = now) and emit a BREACHED SlaEvent for the
 *      ticket's service + customer.
 *   2. WARNING pass — find every RUNNING clock whose elapsed time has
 *      crossed 70% of its target duration (and is not yet breached); if no
 *      prior WARNING SlaEvent references that clock, emit a WARNING SlaEvent.
 *
 * Response: { breached: N, warned: N, checkedAt: ISO, ranFor: ms }
 */
export async function POST(req: NextRequest) {
  const started = Date.now();

  // ---- Auth: session OR system token ----
  let session = await getSession();
  if (!session) {
    const sysToken =
      req.headers.get('x-system-token') ?? req.nextUrl.searchParams.get('systemToken');
    const expected = process.env.SYSTEM_TRIGGER_TOKEN;
    if (!expected || !sysToken || sysToken !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // System trigger — no session; audit entries will be actor=system.
    session = null;
  }

  const now = new Date();

  // =========================================================================
  // PASS 1 — BREACH DETECTION
  // =========================================================================
  const breachedClocks = await db.slaClock.findMany({
    where: { status: 'RUNNING', dueAt: { lt: now } },
    include: {
      ticket: {
        select: {
          id: true,
          number: true,
          title: true,
          serviceId: true,
          serviceCustomerId: true,
          priority: true,
          type: true,
          service: { select: { name: true } },
        },
      },
      policy: { select: { name: true } },
    },
  });

  let breachedCount = 0;
  for (const clock of breachedClocks) {
    try {
      await db.slaClock.update({
        where: { id: clock.id },
        data: { status: 'BREACHED', breachedAt: now },
      });

      const serviceId = clock.ticket.serviceId;
      if (serviceId) {
        await db.slaEvent.create({
          data: {
            serviceId,
            serviceCustomerId: clock.ticket.serviceCustomerId,
            eventType: 'BREACHED',
            message: `SLA breached [clockId:${clock.id}] — ${clock.type} clock for ${clock.ticket.type} ${clock.ticket.number} "${clock.ticket.title}" (priority ${clock.ticket.priority}) was due at ${clock.dueAt.toISOString()}. Policy: ${clock.policy.name}.`,
          },
        });
      }

      await auditLog({
        actor: session,
        action: 'SLA_CLOCK_BREACHED',
        entityType: 'SlaClock',
        entityId: clock.id,
        after: {
          ticketId: clock.ticketId,
          ticketNumber: clock.ticket.number,
          type: clock.type,
          dueAt: clock.dueAt.toISOString(),
          breachedAt: now.toISOString(),
        },
      });

      breachedCount++;
    } catch (e) {
      // Continue with the remaining clocks even if one fails.
      console.error('[sla-clocks/check] breach failed for clock', clock.id, e);
    }
  }

  // =========================================================================
  // PASS 2 — EARLY WARNING (70% threshold)
  // =========================================================================
  // Pull all currently-RUNNING clocks (those just breached are now BREACHED
  // and excluded). We post-filter by the 70% threshold in JS — the elapsed
  // fraction needs paused-time correction which Prisma cannot express.
  const runningClocks = await db.slaClock.findMany({
    where: { status: 'RUNNING' },
    include: {
      ticket: {
        select: {
          id: true,
          number: true,
          title: true,
          serviceId: true,
          serviceCustomerId: true,
          priority: true,
          type: true,
          service: { select: { name: true } },
        },
      },
      policy: { select: { name: true } },
    },
  });

  // Build the set of clock ids we just breached this tick — they should not
  // also receive a warning.
  const justBreachedIds = new Set(breachedClocks.map((c) => c.id));

  const candidates = runningClocks.filter((c) => {
    if (justBreachedIds.has(c.id)) return false;
    const startedMs = c.startedAt.getTime();
    const dueMs = c.dueAt.getTime();
    const targetMins = (dueMs - startedMs) / 60000;
    if (targetMins <= 0) return false;
    const elapsedMins = (now.getTime() - startedMs) / 60000 - c.totalPausedMins;
    if (elapsedMins <= 0) return false;
    const fraction = elapsedMins / targetMins;
    return fraction >= 0.7 && fraction < 1.0;
  });

  let warnedCount = 0;
  for (const clock of candidates) {
    try {
      const serviceId = clock.ticket.serviceId;
      if (!serviceId) continue; // cannot attach a SlaEvent without a service

      // Idempotency: skip if we already warned for this clock. We embed the
      // clockId token in every WARNING message we emit and search for it.
      const token = `[clockId:${clock.id}]`;
      const existing = await db.slaEvent.findFirst({
        where: {
          serviceId,
          eventType: 'WARNING',
          message: { contains: token },
        },
        select: { id: true },
      });
      if (existing) continue;

      await db.slaEvent.create({
        data: {
          serviceId,
          serviceCustomerId: clock.ticket.serviceCustomerId,
          eventType: 'WARNING',
          message: `SLA warning ${token} — ${clock.type} clock for ${clock.ticket.type} ${clock.ticket.number} "${clock.ticket.title}" (priority ${clock.ticket.priority}) is approaching its dueAt ${clock.dueAt.toISOString()}. Policy: ${clock.policy.name}.`,
        },
      });

      await auditLog({
        actor: session,
        action: 'SLA_CLOCK_WARNING',
        entityType: 'SlaClock',
        entityId: clock.id,
        after: {
          ticketId: clock.ticketId,
          ticketNumber: clock.ticket.number,
          type: clock.type,
          dueAt: clock.dueAt.toISOString(),
          warnedAt: now.toISOString(),
        },
      });

      warnedCount++;
    } catch (e) {
      console.error('[sla-clocks/check] warning failed for clock', clock.id, e);
    }
  }

  const response = {
    breached: breachedCount,
    warned: warnedCount,
    checkedAt: now.toISOString(),
    ranForMs: Date.now() - started,
  };

  return NextResponse.json(response);
}
