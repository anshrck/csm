import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import {
  KNOWLEDGE_INCLUDE,
  serializeKnowledgeArticle,
  errorResponse,
  type KnowledgeArticleWithRelations,
} from '../../_serialize';

export const runtime = 'nodejs';

// POST /api/knowledge/[id]/submit-review — move a DRAFT article into REVIEW.
// Role: the author or a CM Leader. Status must currently be DRAFT (or REVIEW
// — idempotent re-submit returns the existing REVIEW row).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const article = await db.knowledgeArticle.findUnique({
      where: { id },
      include: KNOWLEDGE_INCLUDE,
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const isAuthor = article.authorId === session.id;
    const isCmLeader = session.role === 'CM_LEADER' as Role;
    if (!isAuthor && !isCmLeader) {
      return NextResponse.json(
        { error: 'Only the author or a CM Leader can submit an article for review' },
        { status: 403 },
      );
    }

    if (article.status !== 'DRAFT' && article.status !== 'REVIEW') {
      return NextResponse.json(
        { error: `CONFLICT: cannot submit an article in status ${article.status}` },
        { status: 409 },
      );
    }

    if (article.status === 'REVIEW') {
      // Idempotent — already in review.
      return NextResponse.json(
        serializeKnowledgeArticle(article as KnowledgeArticleWithRelations),
      );
    }

    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: { status: 'REVIEW' },
      include: KNOWLEDGE_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_SUBMITTED_REVIEW',
      entityType: 'KnowledgeArticle',
      entityId: id,
      before: { status: 'DRAFT' },
      after: { status: 'REVIEW' },
    });

    // Notify all CM_LEADER users — they hold the publish gate.
    const cmLeaders = await db.user.findMany({
      where: { role: 'CM_LEADER' },
      select: { id: true },
    });
    if (cmLeaders.length) {
      await db.notification.createMany({
        data: cmLeaders.map((u) => ({
          userId: u.id,
          type: 'QuoteApprovalRequested',
          title: 'Knowledge article awaiting review',
          message: `${session.name} submitted "${article.title}" for review.`,
          entityRef: `knowledge:${id}`,
        })),
      });
    }

    return NextResponse.json(
      serializeKnowledgeArticle(updated as KnowledgeArticleWithRelations),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
