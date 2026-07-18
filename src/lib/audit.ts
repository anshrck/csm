// Audit log helper for CereBree uSMS — records all important mutations.
import { db } from './db';
import type { SessionUser } from './types';

interface AuditLogInput {
  actor: SessionUser | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/** Write an audit log entry. Safe to call — never throws (failures are swallowed to avoid blocking the main operation). */
export async function auditLog(input: AuditLogInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? 'system',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: input.before ? JSON.stringify(input.before) : null,
        afterJson: input.after ? JSON.stringify(input.after) : null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (e) {
    // Audit logging must never break the main operation.
    console.error('[auditLog] failed to write audit entry:', e);
  }
}

/** Fetch audit history for an entity. */
export async function getAuditHistory(entityType: string, entityId: string, limit = 50) {
  return db.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
