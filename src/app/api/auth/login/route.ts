import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, verifyPassword } from '@/lib/auth';
import { type Role } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  const user = await db.user.findUnique({
    where: { email: String(email).toLowerCase() },
    include: { orgNode: true },
  });
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }
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
