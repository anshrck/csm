'use client';

/**
 * Service Owner Knowledge Base view.
 *
 * Thin wrapper around the shared KnowledgeManager with
 * defaultFilterOwnedServices=true. The Service Owner can edit any article on
 * a service they own, plus publish/retire (shared editorial gate with the
 * CM Leader). The "My services only" filter is on by default but can be
 * cleared to see the full tenant corpus.
 */

import { KnowledgeManager } from '@/components/workspaces/shared/KnowledgeManager';

export default function Knowledge() {
  return <KnowledgeManager role="SERVICE_OWNER" defaultFilterOwnedServices />;
}
