'use client';

/**
 * Customer Knowledge Base view (read-only browse).
 *
 * Service Customers see only PUBLISHED articles (enforced server-side by the
 * /api/knowledge route's role scoping). They can browse by type via the tab
 * strip, free-text search, and open any article in a Dialog to read the full
 * markdown body.
 */

import * as React from 'react';
import { PageHeader, SectionCard } from '@/components/shared';
import { KnowledgeSearch, KNOWLEDGE_TYPE_META } from '@/components/workspaces/shared/KnowledgeSearch';
import { cn } from '@/lib/utils';
import { BookOpen } from 'lucide-react';

const TYPE_TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'HOW_TO', label: 'How To' },
  { key: 'KNOWN_ERROR', label: 'Known Errors' },
  { key: 'FAQ', label: 'FAQ' },
  { key: 'RUNBOOK', label: 'Runbooks' },
];

export default function Knowledge() {
  const [type, setType] = React.useState('');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Knowledge Base"
        description="Browse published articles — how-to guides, known errors, FAQs, and runbooks curated by the CSM team."
        icon={<BookOpen className="h-5 w-5" />}
      />

      <SectionCard
        title="Search & browse"
        description="Filter by type or search the article title and body. Click any result to read the full article."
      >
        {/* Type filter tabs */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {TYPE_TABS.map((t) => {
            const active = type === t.key;
            const meta = t.key ? KNOWLEDGE_TYPE_META[t.key] : null;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                onClick={() => setType(t.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <KnowledgeSearch
          initialType={type || undefined}
          placeholder="Search knowledge base by keyword…"
          emptyLabel="No published articles match your search."
        />
      </SectionCard>
    </div>
  );
}
