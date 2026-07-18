import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function PATCH() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await db.notification.updateMany({ where: { userId: session.id, read: false }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
