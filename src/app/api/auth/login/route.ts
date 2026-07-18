import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  createSession,
  verifyPassword,
  isLoginRateLimited,
  recordFailedLogin,
  clearLoginAttempts,
} from '@/lib/auth';
import { type Role } from '@/lib/types';
import { validateBody, loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));

  // Validate the request body with Zod before touching the database.
  const parsed = validateBody(loginSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // Rate limit: if this email has been blocked after too many failed attempts,
  // refuse the attempt without even checking the password. The 429 status and
  // message are surfaced to the UI so the user knows to wait.
  if (isLoginRateLimited(normalizedEmail)) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429 },
    );
  }

  const user = await db.user.findUnique({
    where: { email: normalizedEmail },
    include: { orgNode: true },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordFailedLogin(normalizedEmail);
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  // Success — clear the failed-attempt counter so the next session starts fresh.
  clearLoginAttempts(normalizedEmail);
  await createSession(user.id);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      orgNodeId: user.orgNodeId,
      orgNodeName: user.orgNode?.name ?? null,
      avatarColor: user.avatarColor,
      title: user.title ?? null,
    },
  });
}
