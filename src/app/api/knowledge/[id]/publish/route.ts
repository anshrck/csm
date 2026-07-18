import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import {
  KNOWLEDGE_INCLUDE,
  serializeKnowledgeArticle,
  errorResponse,
  type KnowledgeArticleWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/knowledge/[id]/publish — move a REVIEW article into PUBLISHED.
// Role: CM_LEADER or SERVICE_OWNER only (they hold the editorial gate).
// Sets publishedAt (now, on first publish — preserved on re-publish after
// retirement) and reviewerId (the caller). Status must currently be REVIEW.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const allowed = await authorize(session, { resource: 'knowledge', action: 'publish', recordId: id });
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const article = await db.knowledgeArticle.findUnique({
      where: { id },
      include: KNOWLEDGE_INCLUDE,
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    if (article.status !== 'REVIEW') {
      return NextResponse.json(
        { error: `CONFLICT: cannot publish an article in status ${article.status} (must be REVIEW)` },
        { status: 409 },
      );
    }

    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        reviewerId: session.id,
        // Preserve the original publishedAt when re-publishing after retirement;
        // otherwise stamp it now.
        publishedAt: article.publishedAt ?? new Date(),
      },
      include: KNOWLEDGE_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_PUBLISHED',
      entityType: 'KnowledgeArticle',
      entityId: id,
      before: { status: 'REVIEW' },
      after: { status: 'PUBLISHED', reviewerId: session.id },
    });

    return NextResponse.json(
      serializeKnowledgeArticle(updated as KnowledgeArticleWithRelations),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
