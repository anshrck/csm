import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import type { Role, SessionUser } from './types';

const SESSION_SECRET = process.env.SESSION_SECRET || 'cerebree-usms-dev-secret-change-in-prod';
const COOKIE_NAME = 'usms_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const user = await db.user.findUnique({
      where: { id: payload.uid },
      include: { orgNode: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      orgNodeId: user.orgNodeId,
      orgNodeName: user.orgNode?.name ?? null,
      avatarColor: user.avatarColor,
      title: user.title ?? null,
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
