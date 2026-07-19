import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import { validateBody, knowledgeArticleSchema } from '@/lib/validation';
import {
  KNOWLEDGE_INCLUDE,
  serializeKnowledgeArticle,
  errorResponse,
  type KnowledgeArticleWithRelations,
} from '../_serialize';

export const runtime = 'nodejs';

// GET /api/knowledge/[id] — fetch a single article (with full body).
// Role scoping: SERVICE_CUSTOMER → only PUBLISHED articles (404 otherwise).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const article = await db.knowledgeArticle.findFirst({
      where: { id, tenantId },
      include: KNOWLEDGE_INCLUDE,
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (session.role === 'SERVICE_CUSTOMER' && article.status !== 'PUBLISHED') {
      // Don't leak existence of draft/review/retired articles to customers.
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json(
      serializeKnowledgeArticle(article as KnowledgeArticleWithRelations),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/knowledge/[id] — update a draft or review article.
// Role: the original author OR a CM_LEADER (CM Leader can edit any article
// regardless of authorship — they hold the editorial gate).
// Editable fields: title, body, type, serviceId, status (DRAFT or REVIEW
// only — the publish/retire transitions are dedicated endpoints).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const tenantId = session.actorContext?.tenantId || 'default-tenant';
    const article = await db.knowledgeArticle.findFirst({
      where: { id, tenantId },
      include: KNOWLEDGE_INCLUDE,
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const isAuthor = article.authorId === session.id;
    const isCmLeader = session.role === 'CM_LEADER' as Role;
    if (!isAuthor && !isCmLeader) {
      return NextResponse.json(
        { error: 'Only the author or a CM Leader can edit this article' },
        { status: 403 },
      );
    }

    // Already-published articles can't be edited in place — retire + republish
    // to update them. The only exception: an author can fix a typo on a
    // DRAFT/REVIEW article.
    if (article.status === 'PUBLISHED' || article.status === 'RETIRED') {
      return NextResponse.json(
        { error: 'CONFLICT: published/retired articles cannot be edited in place. Retire and create a new revision.' },
        { status: 409 },
      );
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = validateBody(knowledgeArticleSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { title, body, type, serviceId, status } = parsed.data;

    // Status, if supplied, must remain DRAFT or REVIEW during a PATCH.
    if (status && status !== 'DRAFT' && status !== 'REVIEW') {
      return NextResponse.json(
        { error: 'PATCH cannot transition to ' + status + ' — use the dedicated publish/retire endpoints.' },
        { status: 400 },
      );
    }

    // serviceId, if supplied, must reference an existing service.
    if (serviceId) {
      const svc = await db.service.findUnique({
        where: { id: serviceId },
        select: { id: true },
      });
      if (!svc) {
        return NextResponse.json({ error: 'serviceId not found' }, { status: 400 });
      }
    }

    const before = {
      title: article.title,
      body: article.body,
      type: article.type,
      serviceId: article.serviceId,
      status: article.status,
    };

    // Snapshot the current live state as a KnowledgeArticleVersion row
    // BEFORE applying the update. This powers the version-history UI and the
    // "restore version" workflow. The version number is monotonically
    // increasing per article (1, 2, 3, …).
    const latestVersion = await db.knowledgeArticleVersion.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersionNumber = (latestVersion?.version ?? 0) + 1;
    await db.knowledgeArticleVersion.create({
      data: {
        articleId: id,
        title: article.title,
        body: article.body,
        version: nextVersionNumber,
        createdById: session.id,
      },
    });

    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: {
        title,
        body,
        type,
        serviceId: serviceId === undefined ? article.serviceId : serviceId || null,
        status: status ?? article.status,
      },
      include: KNOWLEDGE_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_ARTICLE_UPDATED',
      entityType: 'KnowledgeArticle',
      entityId: id,
      before,
      after: {
        title: updated.title,
        type: updated.type,
        status: updated.status,
        serviceId: updated.serviceId,
      },
    });

    return NextResponse.json(
      serializeKnowledgeArticle(updated as KnowledgeArticleWithRelations),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
