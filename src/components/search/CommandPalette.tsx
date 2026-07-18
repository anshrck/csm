'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Search,
  FileText,
  Library,
  GitBranch,
  Bug,
  Sparkles,
  PlusCircle,
  LogOut,
  LayoutDashboard,
  Users,
  Briefcase,
  CornerDownLeft,
  Ticket as TicketIcon,
  BookOpen,
  Mail,
  ScrollText,
} from 'lucide-react';
import type { Role, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';
import type { ViewKey } from '@/lib/store';

// ----------------------------------------------------------------------------
// Server-side search hit shape (matches /api/search response).
// ----------------------------------------------------------------------------

interface SearchHit {
  type: 'DEMAND' | 'TICKET' | 'SERVICE' | 'KNOWLEDGE' | 'CHANGE' | 'PROBLEM';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

interface SearchResponse {
  results: SearchHit[];
}

interface SearchResponseAudit {
  // The audit-logs API returns a flat array of rows.
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface CommunicationRow {
  id: string;
  subject: string;
  direction: string;
  channel: string;
  authorName: string;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Demand status tone (kept for the demands group).
// ----------------------------------------------------------------------------

const demandStatusTone: Record<DemandStatus, string> = {
  NEW: 'text-sky-700 dark:text-sky-300',
  UNDER_REVIEW: 'text-amber-700 dark:text-amber-300',
  QUOTED: 'text-violet-700 dark:text-violet-300',
  ACCEPTED: 'text-teal-700 dark:text-teal-300',
  IN_CHANGE: 'text-indigo-700 dark:text-indigo-300',
  FULFILLED: 'text-emerald-700 dark:text-emerald-300',
  CLOSED: 'text-muted-foreground',
  REJECTED: 'text-rose-700 dark:text-rose-300',
  REDIRECTED: 'text-orange-700 dark:text-orange-300',
};

// ----------------------------------------------------------------------------
// Quick actions per role.
// ----------------------------------------------------------------------------

interface QuickAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  run: () => void;
}

// ----------------------------------------------------------------------------
// Palette
// ----------------------------------------------------------------------------

export interface CommandPaletteProps {
  role: Role;
  onNavigate: (view: ViewKey, params?: Record<string, string>) => void;
  onOpenAi: () => void;
  onSignOut: () => void;
}

export function CommandPalette({ role, onNavigate, onOpenAi, onSignOut }: CommandPaletteProps) {
  const [query, setQuery] = React.useState('');

  // ---- Server-side search -------------------------------------------------
  // Debounce the query so we don't fire a request on every keystroke.
  const debouncedQuery = React.useDeferredValue(query.trim());
  const searchEnabled = debouncedQuery.length >= 2;

  const searchQ = useQuery<SearchResponse>({
    queryKey: ['search', debouncedQuery],
    queryFn: () =>
      apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: searchEnabled,
    staleTime: 10_000,
    retry: false,
  });

  // ---- Recent communications (for the Communications group) ---------------
  // We fetch the most recent communications and let cmdk's fuzzy filter handle
  // the query. This avoids adding a free-text endpoint just for the palette.
  const commsQ = useQuery<CommunicationRow[]>({
    queryKey: ['communications', 'palette'],
    queryFn: () => apiGet<CommunicationRow[]>('/api/communications'),
    staleTime: 60_000,
    retry: false,
  });

  // ---- Recent audit logs (CM Leader only) --------------------------------
  const auditQ = useQuery<SearchResponseAudit[]>({
    queryKey: ['audit-logs', 'palette'],
    queryFn: () => apiGet<SearchResponseAudit[]>('/api/audit-logs?limit=50'),
    enabled: role === 'CM_LEADER',
    staleTime: 30_000,
    retry: false,
  });

  const isLoading = searchEnabled && searchQ.isFetching;
  const hits = searchQ.data?.results ?? [];

  // Group hits by type.
  const demands = hits.filter((h) => h.type === 'DEMAND');
  const tickets = hits.filter((h) => h.type === 'TICKET');
  const services = hits.filter((h) => h.type === 'SERVICE');
  const knowledge = hits.filter((h) => h.type === 'KNOWLEDGE');
  const changes = hits.filter((h) => h.type === 'CHANGE');
  const problems = hits.filter((h) => h.type === 'PROBLEM');

  // Communications: client-side filter on subject.
  const commsFiltered = (commsQ.data ?? [])
    .filter((c) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        c.subject.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.direction.toLowerCase().includes(q)
      );
    })
    .slice(0, 12);

  // Audit logs: client-side filter on action/actor/entity.
  const auditFiltered = (auditQ.data ?? [])
    .filter((r) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.action.toLowerCase().includes(q) ||
        r.actorName.toLowerCase().includes(q) ||
        r.entityType.toLowerCase().includes(q)
      );
    })
    .slice(0, 12);

  const serviceView: ViewKey = role === 'SERVICE_OWNER' ? 'portfolio' : 'catalog';

  const quickActions = React.useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [];
    if (role === 'SERVICE_CUSTOMER') {
      actions.push({
        key: 'submit-demand',
        label: 'Submit a Demand',
        icon: PlusCircle,
        run: () => onNavigate('submit-demand'),
      });
    }
    if (role === 'SCM_WORKER') {
      actions.push({
        key: 'submit-demand',
        label: 'New Demand on behalf',
        icon: PlusCircle,
        run: () => onNavigate('submit-demand'),
      });
    }
    if (role === 'CM_LEADER') {
      actions.push(
        {
          key: 'workers',
          label: 'View SCM Workers',
          icon: Users,
          run: () => onNavigate('workers'),
        },
        {
          key: 'audit',
          label: 'Open Audit Log',
          icon: ScrollText,
          run: () => onNavigate('audit'),
        },
        {
          key: 'delivery-failures',
          label: 'Open Delivery Admin',
          icon: Mail,
          run: () => onNavigate('delivery-failures'),
        },
      );
    }
    if (role === 'SERVICE_OWNER') {
      actions.push({
        key: 'portfolio',
        label: 'Open Service Portfolio',
        icon: Briefcase,
        run: () => onNavigate('portfolio'),
      });
    }
    actions.push(
      {
        key: 'dashboard',
        label: 'Go to Dashboard',
        icon: LayoutDashboard,
        run: () => onNavigate('dashboard'),
      },
      {
        key: 'cogni',
        label: 'Open Cogni (AI Assistant)',
        icon: Sparkles,
        run: onOpenAi,
      },
      {
        key: 'signout',
        label: 'Sign out',
        icon: LogOut,
        run: onSignOut,
      },
    );
    return actions;
  }, [role, onNavigate, onOpenAi, onSignOut]);

  // Helper: navigate to the appropriate detail view for a hit.
  const navigateHit = (h: SearchHit) => {
    if (h.type === 'TICKET') onNavigate('ticket-detail', { id: h.id });
    else if (h.type === 'DEMAND') onNavigate('demand-detail', { id: h.id });
    else if (h.type === 'SERVICE') onNavigate(serviceView);
    else if (h.type === 'KNOWLEDGE') onNavigate('knowledge');
    else if (h.type === 'CHANGE') onNavigate('changes');
    else if (h.type === 'PROBLEM') onNavigate('problems');
  };

  return (
    <Command className="rounded-lg" loop shouldFilter={query.trim().length < 2}>
      <CommandInput
        placeholder="Search demands, tickets, services, knowledge, changes, problems…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[min(60vh,440px)]">
        {isLoading && (
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {!isLoading && !searchEnabled && (
          <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
        )}
        {!isLoading && searchEnabled && hits.length === 0 && commsFiltered.length === 0 && (!auditQ.data || auditFiltered.length === 0) && (
          <CommandEmpty>No matches found.</CommandEmpty>
        )}

        {/* Quick actions — always shown first */}
        {!isLoading && quickActions.length > 0 && (
          <CommandGroup heading="Quick actions">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <CommandItem
                  key={a.key}
                  value={`${a.label} quick action`}
                  onSelect={() => a.run()}
                >
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="flex-1">{a.label}</span>
                  {a.hint && <span className="text-xs text-muted-foreground">{a.hint}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Demands */}
        {!isLoading && demands.length > 0 && (
          <CommandGroup heading={`Demands · ${demands.length}`}>
            {demands.slice(0, 10).map((d) => {
              const status = (d.subtitle ?? '') as DemandStatus;
              return (
                <CommandItem
                  key={d.id}
                  value={`demand ${d.title} ${d.subtitle ?? ''}`}
                  onSelect={() => navigateHit(d)}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{d.title}</span>
                  <span
                    className={cn(
                      'text-xs font-medium ml-2',
                      demandStatusTone[status] ?? 'text-muted-foreground',
                    )}
                  >
                    {DEMAND_STATUS_LABELS[status] ?? d.subtitle}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Tickets */}
        {!isLoading && tickets.length > 0 && (
          <CommandGroup heading={`Tickets · ${tickets.length}`}>
            {tickets.slice(0, 10).map((t) => (
              <CommandItem
                key={t.id}
                value={`ticket ${t.title} ${t.subtitle ?? ''}`}
                onSelect={() => navigateHit(t)}
              >
                <TicketIcon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {t.subtitle ?? ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Services */}
        {!isLoading && services.length > 0 && (
          <CommandGroup heading={`Services · ${services.length}`}>
            {services.slice(0, 10).map((s) => (
              <CommandItem
                key={s.id}
                value={`service ${s.title} ${s.subtitle ?? ''}`}
                onSelect={() => navigateHit(s)}
              >
                <Library className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{s.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {s.subtitle ?? ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Knowledge articles */}
        {!isLoading && knowledge.length > 0 && (
          <CommandGroup heading={`Knowledge · ${knowledge.length}`}>
            {knowledge.slice(0, 10).map((k) => (
              <CommandItem
                key={k.id}
                value={`knowledge article ${k.title} ${k.subtitle ?? ''}`}
                onSelect={() => navigateHit(k)}
              >
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{k.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {k.subtitle ?? ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Changes */}
        {!isLoading && changes.length > 0 && (
          <CommandGroup heading={`Changes · ${changes.length}`}>
            {changes.slice(0, 10).map((c) => (
              <CommandItem
                key={c.id}
                value={`change ${c.title} ${c.subtitle ?? ''}`}
                onSelect={() => navigateHit(c)}
              >
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[120px]">
                  {c.subtitle ?? ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Problems */}
        {!isLoading && problems.length > 0 && (
          <CommandGroup heading={`Problems · ${problems.length}`}>
            {problems.slice(0, 10).map((p) => (
              <CommandItem
                key={p.id}
                value={`problem ${p.title} ${p.subtitle ?? ''}`}
                onSelect={() => navigateHit(p)}
              >
                <Bug className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{p.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {p.subtitle ?? ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Communications (recent, client-filtered) */}
        {!isLoading && commsFiltered.length > 0 && (
          <CommandGroup heading={`Communications · ${commsFiltered.length}`}>
            {commsFiltered.slice(0, 8).map((c) => (
              <CommandItem
                key={c.id}
                value={`communication ${c.subject} ${c.authorName} ${c.direction}`}
                onSelect={() => onNavigate('demands')}
              >
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.subject}</span>
                <Badge variant="outline" className="ml-2 h-5 px-1.5 text-[10px] font-medium">
                  {c.direction === 'TO_CUSTOMER' ? '→ Customer' : 'Internal'}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Audit Logs (CM Leader only) */}
        {!isLoading && role === 'CM_LEADER' && auditFiltered.length > 0 && (
          <CommandGroup heading={`Audit Log · ${auditFiltered.length}`}>
            {auditFiltered.slice(0, 8).map((a) => (
              <CommandItem
                key={a.id}
                value={`audit ${a.action} ${a.actorName} ${a.entityType} ${a.entityId}`}
                onSelect={() => onNavigate('audit', { id: a.entityId })}
              >
                <ScrollText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate font-mono text-xs">{a.action}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[120px]">
                  {a.actorName} · {a.entityType}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>

      <CommandSeparator />
      {/* Footer hint */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Search className="h-3 w-3" />
          <span>type to search across the tenant</span>
        </span>
        <span className="flex items-center gap-2">
          <kbd className="rounded border bg-muted px-1 py-0.5 font-sans">↑</kbd>
          <kbd className="rounded border bg-muted px-1 py-0.5 font-sans">↓</kbd>
          <span>navigate</span>
          <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border bg-muted px-1 py-0.5 font-sans">
            <CornerDownLeft className="h-2.5 w-2.5" /> select
          </kbd>
          <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 font-sans">esc</kbd>
          <span>close</span>
        </span>
      </div>
    </Command>
  );
}

export default CommandPalette;
