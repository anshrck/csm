import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import { errorResponse } from '../../_serialize';

export const runtime = 'nodejs';

// ---- Serializer -----------------------------------------------------------

interface VersionRow {
  id: string;
  articleId: string;
  title: string;
  body: string;
  version: number;
  createdById: string;
  createdAt: Date;
  creator?: { id: string; name: string; avatarColor: string } | null;
}

export interface SerializedVersion {
  id: string;
  articleId: string;
  title: string;
  body: string;
  version: number;
  createdById: string;
  createdByName: string;
  creatorAvatarColor: string | null;
  createdAt: string;
  // Convenience flag for the UI: is this the currently-active version (i.e.
  // the article's current state matches this version's title+body)?
  current: boolean;
}

function serializeVersion(
  v: VersionRow,
  isCurrent: boolean,
): SerializedVersion {
  return {
    id: v.id,
    articleId: v.articleId,
    title: v.title,
    body: v.body,
    version: v.version,
    createdById: v.createdById,
    createdByName: v.creator?.name ?? 'Unknown',
    creatorAvatarColor: v.creator?.avatarColor ?? null,
    createdAt: v.createdAt.toISOString(),
    current: isCurrent,
  };
}

// ---- GET /api/knowledge/[id]/versions -------------------------------------
//
// List all versions of a knowledge article, newest first. The article itself
// is the "current" version — its title+body are not duplicated as a
// KnowledgeArticleVersion row unless an edit was made (the PATCH handler
// records a version snapshot BEFORE applying the update). The "current"
// flag is computed by comparing each version's title+body to the article's
// live title+body — if a version matches, it's the live one.
//
// Role scoping mirrors the article-detail GET:
//   SERVICE_CUSTOMER → 404 (they don't see version history).
//   SCM_WORKER / CM_LEADER / SERVICE_OWNER → all versions of any article
//   they can read (i.e. they can see DRAFT/REVIEW articles they authored).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // SERVICE_CUSTOMER cannot see version history (they can only read
    // PUBLISHED articles — and the version endpoint leaks DRAFT content).
    if (session.role === 'SERVICE_CUSTOMER') {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const article = await db.knowledgeArticle.findUnique({
      where: { id },
      select: { id: true, title: true, body: true, authorId: true, status: true },
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // Authors can always see their own article's history. CM_LEADER sees all.
    // SERVICE_OWNER sees articles on services they own (the main GET enforces
    // this — for the version history we accept the same role gate).
    const versions = await db.knowledgeArticleVersion.findMany({
      where: { articleId: id },
      include: { creator: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { version: 'desc' },
    });

    // Compute the "current" flag — does this version match the live article?
    const serialized = versions.map((v) =>
      serializeVersion(
        v as VersionRow,
        v.title === article.title && v.body === article.body,
      ),
    );

    return NextResponse.json(serialized);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---- POST /api/knowledge/[id]/versions ------------------------------------
//
// Restore a previous version. Body: { sourceVersionId: string }.
//
// Restoring DOES NOT modify the article row directly — instead it creates a
// new KnowledgeArticleVersion snapshot of the current live state (so the
// history is preserved), then copies the source version's title+body into the
// live article (via PATCH semantics). The article must currently be in DRAFT
// or REVIEW status (PUBLISHED/RETIRED articles cannot be edited in place —
// the caller must retire first, then restore as a new draft).
//
// Role: the original author OR a CM_LEADER (mirrors the PATCH gate).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const article = await db.knowledgeArticle.findUnique({
      where: { id },
      select: { id: true, title: true, body: true, type: true, status: true, authorId: true, serviceId: true },
    });
    if (!article) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const isAuthor = article.authorId === session.id;
    const isCmLeader = session.role === ('CM_LEADER' as Role);
    if (!isAuthor && !isCmLeader) {
      return NextResponse.json(
        { error: 'Only the author or a CM Leader can restore an article version' },
        { status: 403 },
      );
    }

    if (article.status === 'PUBLISHED' || article.status === 'RETIRED') {
      return NextResponse.json(
        { error: 'CONFLICT: cannot restore a PUBLISHED or RETIRED article in place. Retire first, then restore as a draft.' },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const sourceVersionId = typeof body.sourceVersionId === 'string' ? body.sourceVersionId : '';
    if (!sourceVersionId) {
      return NextResponse.json(
        { error: 'INVALID_SOURCE_VERSION_ID — sourceVersionId is required' },
        { status: 400 },
      );
    }

    const sourceVersion = await db.knowledgeArticleVersion.findUnique({
      where: { id: sourceVersionId },
    });
    if (!sourceVersion || sourceVersion.articleId !== id) {
      return NextResponse.json(
        { error: 'INVALID_SOURCE_VERSION_ID — not found for this article' },
        { status: 404 },
      );
    }

    // Snapshot the current live state as a new version row BEFORE applying the
    // restore. This preserves the history: a future "undo" can return to it.
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

    // Apply the restore: copy the source version's title+body into the live article.
    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: {
        title: sourceVersion.title,
        body: sourceVersion.body,
      },
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_ARTICLE_VERSION_RESTORED',
      entityType: 'KnowledgeArticle',
      entityId: id,
      before: { title: article.title, bodyPreview: article.body.slice(0, 200) },
      after: {
        title: updated.title,
        bodyPreview: updated.body.slice(0, 200),
        restoredFromVersionId: sourceVersionId,
        restoredFromVersionNumber: sourceVersion.version,
      },
    });

    return NextResponse.json({
      ok: true,
      restoredFrom: {
        versionId: sourceVersionId,
        versionNumber: sourceVersion.version,
        title: sourceVersion.title,
      },
      newLiveState: { title: updated.title, body: updated.body },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
