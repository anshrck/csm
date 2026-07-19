import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { authorize } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';
import type { Role } from '@/lib/types';
import { validateBody, knowledgeArticleSchema } from '@/lib/validation';
import {
  KNOWLEDGE_INCLUDE,
  serializeKnowledgeArticle,
  summarizeKnowledgeArticle,
  errorResponse,
  type KnowledgeArticleWithRelations,
} from './_serialize';
import { buildEntityQueryScope } from '@/lib/entity-access';

export const runtime = 'nodejs';

// GET /api/knowledge — list/search knowledge articles.
// Query params:
//   q=<text>      title+body search (case-insensitive contains)
//   type=HOW_TO|KNOWN_ERROR|FAQ|RUNBOOK   (comma-separated multi-select)
//   status=DRAFT|REVIEW|PUBLISHED|RETIRED (comma-separated multi-select)
//   serviceId=<id> filter by linked service
//   summary=1     return lightweight summary shape (omit body) for search UIs
// Role scoping:
//   SERVICE_CUSTOMER → only PUBLISHED articles (and ignored status filter).
//   SCM_WORKER / CM_LEADER / SERVICE_OWNER → all articles (subject to filters).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const q = sp.get('q') ?? undefined;
    const typeParam = sp.get('type');
    const statusParam = sp.get('status');
    const serviceId = sp.get('serviceId') ?? undefined;
    const summary = sp.get('summary') === '1';

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    const scope = await buildEntityQueryScope(session, 'KNOWLEDGE_ARTICLE');
    if (scope.id === '__none__') return NextResponse.json([]);
    and.push(scope);

    if (statusParam && session.role !== 'SERVICE_CUSTOMER') {
      const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) and.push({ status: { in: statuses } });
    }

    if (typeParam) {
      const types = typeParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (types.length) and.push({ type: { in: types } });
    }

    if (serviceId) and.push({ serviceId });

    if (q) {
      // SQLite's `contains` is case-insensitive by default for ASCII; we still
      // search both title and body.
      and.push({
        OR: [
          { title: { contains: q } },
          { body: { contains: q } },
        ],
      });
    }

    if (and.length === 0) delete where.AND;

    const articles = await db.knowledgeArticle.findMany({
      where,
      include: KNOWLEDGE_INCLUDE,
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (summary) {
      return NextResponse.json(
        articles.map((a) => summarizeKnowledgeArticle(a as KnowledgeArticleWithRelations)),
      );
    }
    return NextResponse.json(
      articles.map((a) => serializeKnowledgeArticle(a as KnowledgeArticleWithRelations)),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/knowledge — create a new DRAFT knowledge article.
// Role: SCM_WORKER | CM_LEADER | SERVICE_OWNER.
// Body (validated with knowledgeArticleSchema):
//   { title, body, type, serviceId?, status? }
// `status` defaults to DRAFT and can only be DRAFT at create time — the
// REVIEW/PUBLISHED/RETIRED transitions are gated behind the dedicated
// endpoints below.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await authorize(session, { resource: 'knowledge', action: 'create' });
    if (!allowed.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const raw = await req.json().catch(() => ({}));
    const parsed = validateBody(knowledgeArticleSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { title, body, type, serviceId } = parsed.data;

    // Optional serviceId: if supplied, validate it exists.
    if (serviceId) {
      const svc = await db.service.findUnique({
        where: { id: serviceId },
        select: { id: true, name: true },
      });
      if (!svc) {
        return NextResponse.json({ error: 'serviceId not found' }, { status: 400 });
      }
    }

    const created = await db.knowledgeArticle.create({
      data: {
        title,
        body,
        type,
        status: 'DRAFT',
        serviceId: serviceId ?? null,
        authorId: session.id,
      },
      include: KNOWLEDGE_INCLUDE,
    });

    await auditLog({
      actor: session,
      action: 'KNOWLEDGE_ARTICLE_CREATED',
      entityType: 'KnowledgeArticle',
      entityId: created.id,
      after: {
        title: created.title,
        type: created.type,
        status: created.status,
        serviceId: created.serviceId,
      },
    });

    return NextResponse.json(
      serializeKnowledgeArticle(created as KnowledgeArticleWithRelations),
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
