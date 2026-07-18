import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const count = req.nextUrl.searchParams.get('count');
  if (count) {
    const unread = await db.notification.count({ where: { userId: session.id, read: false } });
    return NextResponse.json({ unread });
  }
  const items = await db.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json(items);
}
