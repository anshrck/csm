import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import type { Role, SessionUser, ActorContext } from './types';

// ---- Session secret ----
//
// In production we require a non-default SESSION_SECRET env var to be set.
// Throwing at module load time (the first request that imports this module)
// is intentional — the platform must NOT silently fall back to the dev secret
// when real users are authenticating. In dev, the fallback keeps the demo
// accounts working out of the box.
const SESSION_SECRET_FALLBACK = 'cerebree-usms-dev-secret-change-in-prod';
const SESSION_SECRET = (() => {
  const env = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!env || env.length < 16) {
      throw new Error(
        'SESSION_SECRET environment variable must be set to a strong (>= 16 char) value in production.',
      );
    }
    return env;
  }
  return env || SESSION_SECRET_FALLBACK;
})();

const COOKIE_NAME = 'usms_session';
// 7 days in seconds (cookie max-age) and in milliseconds (session-expiry check).
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ---- Login rate limiting (in-memory) ----
//
// Tracks failed-login attempts per email address. After MAX_FAILED_ATTEMPTS
// failures inside the WINDOW, the email is blocked for BLOCK_DURATION. A
// successful login clears the counter. The map is process-local — sufficient
// for a single-instance deployment; a multi-instance deployment would need a
// shared store (Redis etc.).
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000; // 15 min

interface FailedAttempt {
  count: number;
  firstAttemptAt: number;
  blockedUntil: number | null;
}
const loginAttempts = new Map<string, FailedAttempt>();

/**
 * Returns true if the supplied email is currently rate-limited (i.e. has hit
 * the failed-attempt threshold and is still inside the block window).
 */
export function isLoginRateLimited(email: string): boolean {
  const key = email.toLowerCase();
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.blockedUntil && Date.now() < entry.blockedUntil) return true;
  // Block has expired — clear stale state so the user can try again.
  if (entry.blockedUntil && Date.now() >= entry.blockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

/**
 * Record a failed login attempt for the given email. Once MAX_FAILED_ATTEMPTS
 * is reached within RATE_LIMIT_WINDOW_MS, the email is blocked for
 * RATE_LIMIT_BLOCK_MS.
 */
export function recordFailedLogin(email: string): void {
  const key = email.toLowerCase();
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || (existing.firstAttemptAt && now - existing.firstAttemptAt > RATE_LIMIT_WINDOW_MS)) {
    // First attempt, or previous window expired — start a fresh window.
    loginAttempts.set(key, {
      count: 1,
      firstAttemptAt: now,
      blockedUntil: null,
    });
    return;
  }
  existing.count += 1;
  if (existing.count >= MAX_FAILED_ATTEMPTS) {
    existing.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
  }
}

/**
 * Clear the failed-login counter for an email. Called after a successful login.
 */
export function clearLoginAttempts(email: string): void {
  loginAttempts.delete(email.toLowerCase());
}

// ---- Password hashing (scrypt) ----
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf);
}

// ---- Session (signed cookie) ----
function sign(payload: string): string {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export async function createSession(userId: string): Promise<void> {
  const payload = JSON.stringify({ uid: userId, ts: Date.now() });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = sign(b64);
  const token = `${b64}.${sig}`;
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function resolveActorContext(userId: string): Promise<ActorContext | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      orgNode: true,
      roleAssignments: true,
      accessGrants: { include: { permission: true } },
      teamMemberships: true,
      queueMemberships: true,
      customerAssignments: true,
      ownershipAssignments: true,
    },
  });
  if (!user) return null;

  const now = new Date();

  // 1. Enforce active role assignments validity
  const activeRoleAssignments = user.roleAssignments.filter((ra) => {
    const isActive = ra.status === 'ACTIVE';
    const isValidFrom = ra.validFrom <= now;
    const isValidUntil = ra.validUntil === null || ra.validUntil >= now;
    return isActive && isValidFrom && isValidUntil;
  });

  const roles = Array.from(new Set(activeRoleAssignments.map((ra) => ra.roleId as Role)));

  // Load baseline permissions
  const perms = await db.rolePermission.findMany({
    where: { role: { in: roles } },
    include: { permission: true },
  });
  const permissionsSet = new Set(perms.map((p) => p.permission.key));

  // 2. Enforce active AccessGrants validity
  const activeGrants = user.accessGrants.filter((ag) => {
    const isValidFrom = ag.validFrom <= now;
    const isValidUntil = ag.validUntil === null || ag.validUntil >= now;
    return isValidFrom && isValidUntil;
  }).map((ag) => ({
    permissionId: ag.permissionId,
    permissionKey: ag.permission.key,
    scopeType: ag.scopeType,
    scopeId: ag.scopeId,
    effect: ag.effect,
    validFrom: ag.validFrom,
    validUntil: ag.validUntil,
  }));

  // 3. Enforce active LeaderManagedScopes
  const managedScopes = await db.leaderManagedScope.findMany({
    where: { leaderId: userId },
  });

  // 4. Enforce active CustomerAssignments validity
  const activeCustomerAssignments = user.customerAssignments.filter((ca) => {
    return ca.active;
  }).map((ca) => ({
    orgNodeId: ca.orgNodeId,
    role: ca.role,
    active: ca.active,
  }));

  // 5. Enforce active ServiceOwnershipAssignments validity
  const activeOwnershipAssignments = user.ownershipAssignments.filter((oa) => {
    const isAccepted = oa.status === 'ACCEPTED';
    const isValidFrom = oa.validFrom <= now;
    const isValidUntil = oa.validUntil === null || oa.validUntil >= now;
    return isAccepted && isValidFrom && isValidUntil;
  }).map((oa) => ({
    serviceId: oa.serviceId,
    assignmentType: oa.assignmentType,
    status: oa.status,
    validFrom: oa.validFrom,
    validUntil: oa.validUntil,
  }));

  const teamMemberships = user.teamMemberships.map((tm) => ({
    teamId: tm.teamId,
    role: tm.role,
  }));

  const queueMemberships = user.queueMemberships.map((qm) => ({
    queueId: qm.queueId,
  }));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      orgNodeId: user.orgNodeId,
      orgNodeName: user.orgNode?.name ?? null,
      avatarColor: user.avatarColor,
      title: user.title ?? null,
    },
    tenantId: 'default-tenant',
    roles,
    roleAssignments: activeRoleAssignments.map((ra) => ({
      roleId: ra.roleId,
      scopeType: ra.scopeType,
      scopeId: ra.scopeId,
      status: ra.status,
      validFrom: ra.validFrom,
      validUntil: ra.validUntil,
    })),
    permissions: permissionsSet,
    grants: activeGrants,
    managedScopes,
    customerAssignments: activeCustomerAssignments,
    teamMemberships,
    queueMemberships,
    serviceOwnerships: activeOwnershipAssignments,
  };
}

export async function getSession(): Promise<(SessionUser & { actorContext: ActorContext }) | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString()) as { uid?: string; ts?: number };
    if (!payload || typeof payload.uid !== 'string') return null;
    if (typeof payload.ts !== 'number') return null;
    if (Date.now() - payload.ts > SESSION_MAX_AGE_MS) return null;

    const actorContext = await resolveActorContext(payload.uid);
    if (!actorContext) return null;

    const roles = actorContext.roles;

    return {
      id: actorContext.user.id,
      email: actorContext.user.email,
      name: actorContext.user.name,
      role: (roles[0] ?? 'SERVICE_CUSTOMER') as Role,
      orgNodeId: actorContext.user.orgNodeId,
      orgNodeName: actorContext.user.orgNodeName,
      avatarColor: actorContext.user.avatarColor,
      title: actorContext.user.title,
      roles,
      actorContext,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error('UNAUTHORIZED');
  return s;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const s = await requireAuth();
  if (!roles.includes(s.role)) throw new Error('FORBIDDEN');
  return s;
}
