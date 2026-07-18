'use client';

/**
 * CM Leader Knowledge Base view.
 *
 * Thin wrapper around the shared KnowledgeManager. CM Leaders can edit any
 * DRAFT/REVIEW article (editorial gate), submit for review, publish, and
 * retire. They receive a notification when an author submits a draft for
 * review (handled in the API route).
 */

import { KnowledgeManager } from '@/components/workspaces/shared/KnowledgeManager';

export default function Knowledge() {
  return <KnowledgeManager role="CM_LEADER" />;
}
