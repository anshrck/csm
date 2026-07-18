import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import {
  KNOWLEDGE_INCLUDE,
  serializeKnowledgeArticle,
  errorResponse,
  type KnowledgeArticleWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/knowledge/[id]/retire — move a PUBLISHED article into RETIRED.
// Role: CM_LEADER or SERVICE_OWNER (the editorial gate). Retiring an article
// removes it from the customer-visible knowledge base but keeps the row
// around for audit history. Already-retired articles are a no-op (idempotent).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole('CM_LEADER' as Role, 'SERVICE_OWNER' as Role);

    const { id } = await params;
    const article = await db.knowledgeArticle.findUnique({
      where: { id },
      include: KNOWLEDGE_INCLUDE,
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    if (article.status === 'RETIRED') {
      // Idempotent.
      return NextResponse.json(
        serializeKnowledgeArticle(article as KnowledgeArticleWithRelations),
      );
    }

    if (article.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: `CONFLICT: cannot retire an article in status ${article.status} (must be PUBLISHED)` },
        { status: 409 },
      );
    }

    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: { status: 'RETIRED' },
      include: KNOWLEDGE_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_RETIRED',
      entityType: 'KnowledgeArticle',
      entityId: id,
      before: { status: 'PUBLISHED' },
      after: { status: 'RETIRED' },
    });

    return NextResponse.json(
      serializeKnowledgeArticle(updated as KnowledgeArticleWithRelations),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
