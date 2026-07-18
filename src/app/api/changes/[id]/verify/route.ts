import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { serializeChange, authError } from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/changes/[id]/verify — IMPLEMENTATION → VERIFICATION
// Body: { verificationNotes }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SCM_WORKER', 'CM_LEADER');
  } catch (e) {
    return authError(e);
  }

  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const verificationNotes =
    typeof body?.verificationNotes === 'string' ? body.verificationNotes.trim() : '';
  if (!verificationNotes) {
    return NextResponse.json({ error: 'verificationNotes is required' }, { status: 400 });
  }

  const existing = await db.change.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (existing.status !== 'IMPLEMENTATION') {
    return NextResponse.json(
      { error: `Change must be in IMPLEMENTATION state (current: ${existing.status})` },
      { status: 409 },
    );
  }

  const updated = await db.change.update({
    where: { id },
    data: { status: 'VERIFICATION', verificationNotes },
    include: { ceWorker: { select: { id: true, name: true } } },
  });

  return NextResponse.json(serializeChange(updated));
}
