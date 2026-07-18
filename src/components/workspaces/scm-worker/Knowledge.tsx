'use client';

/**
 * SCM Worker Knowledge Base view.
 *
 * Thin wrapper around the shared KnowledgeManager. SCM Workers can author
 * drafts, edit their own DRAFT/REVIEW articles, and submit them for review.
 * Publish/retire are gated to CM Leader + Service Owner.
 */

import { KnowledgeManager } from '@/components/workspaces/shared/KnowledgeManager';

export default function Knowledge() {
  return <KnowledgeManager role="SCM_WORKER" />;
}
