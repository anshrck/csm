'use client';

import * as React from 'react';
import { useQueries } from '@tanstack/react-query';
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
} from 'lucide-react';
import type {
  Role,
  Demand,
  Service,
  Change,
  Problem,
  DemandStatus,
} from '@/lib/types';
import {
  DEMAND_STATUS_LABELS,
  CHANGE_STATUS_LABELS,
  SERVICE_DOMAIN_LABELS,
} from '@/lib/types';
import type { ViewKey } from '@/lib/store';

// ----------------------------------------------------------------------------
// Per-role data source configuration.
// Each entry lists the API endpoints to fetch + combine for that group.
// Endpoints may not exist yet (built by other agents); queries fail gracefully
// to empty arrays.
// ----------------------------------------------------------------------------

interface RoleSearchConfig {
  demands: string[];
  services: string[];
  changes: string[];
  problems: string[];
}

const SEARCH_CONFIG: Record<Role, RoleSearchConfig> = {
  SERVICE_CUSTOMER: {
    demands: ['/api/demands?mine=1'],
    services: ['/api/services?entitled=1'],
    changes: [],
    problems: [],
  },
  SCM_WORKER: {
    demands: ['/api/demands?assigned=me', '/api/demands?unassigned=1'],
    services: ['/api/services'],
    changes: [],
    problems: [],
  },
  CM_LEADER: {
    demands: ['/api/demands'],
    services: ['/api/services'],
    changes: ['/api/changes'],
    problems: [],
  },
  SERVICE_OWNER: {
    demands: [],
    services: ['/api/services?owner=me'],
    changes: ['/api/changes'],
    problems: ['/api/problems?owner=me'],
  },
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
// Helpers
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

function dedupeById<T extends { id: string }>(arrs: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const arr of arrs) {
    for (const item of arr) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
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
  const config = SEARCH_CONFIG[role];

  // Build a flat list of query descriptors so we can fetch every endpoint in
  // a single useQueries call. Each query fails gracefully to [].
  const queryDescs = React.useMemo(() => {
    const descs: { kind: 'demand' | 'service' | 'change' | 'problem'; url: string }[] = [];
    config.demands.forEach((url) => descs.push({ kind: 'demand', url }));
    config.services.forEach((url) => descs.push({ kind: 'service', url }));
    config.changes.forEach((url) => descs.push({ kind: 'change', url }));
    config.problems.forEach((url) => descs.push({ kind: 'problem', url }));
    return descs;
  }, [config]);

  const queries = useQueries({
    queries: queryDescs.map((d) => ({
      queryKey: ['global-search', d.kind, d.url] as const,
      queryFn: () => apiGet<unknown[]>(d.url).catch(() => [] as unknown[]),
      staleTime: 15_000,
      retry: false,
    })),
  });

  const demands = dedupeById<Demand>(
    queryDescs
      .map((d, i) => (d.kind === 'demand' ? ((queries[i]?.data ?? []) as Demand[]) : []))
      .filter((x): x is Demand[] => Array.isArray(x)),
  );
  const services = dedupeById<Service>(
    queryDescs
      .map((d, i) => (d.kind === 'service' ? ((queries[i]?.data ?? []) as Service[]) : []))
      .filter((x): x is Service[] => Array.isArray(x)),
  );
  const changes = dedupeById<Change>(
    queryDescs
      .map((d, i) => (d.kind === 'change' ? ((queries[i]?.data ?? []) as Change[]) : []))
      .filter((x): x is Change[] => Array.isArray(x)),
  );
  const problems = dedupeById<Problem>(
    queryDescs
      .map((d, i) => (d.kind === 'problem' ? ((queries[i]?.data ?? []) as Problem[]) : []))
      .filter((x): x is Problem[] => Array.isArray(x)),
  );

  const isLoading = queries.some((q) => q.isLoading);
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
      actions.push({
        key: 'workers',
        label: 'View SCM Workers',
        icon: Users,
        run: () => onNavigate('workers'),
      });
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

  return (
    <Command
      className="rounded-lg"
      loop
    >
      <CommandInput placeholder="Search demands, services, changes, or actions…" />
      <CommandList className="max-h-[min(50vh,360px)]">
        {isLoading && (
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {!isLoading && (
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
            {demands.slice(0, 30).map((d) => (
              <CommandItem
                key={d.id}
                value={`demand ${d.title} ${d.serviceCustomerName ?? ''} ${DEMAND_STATUS_LABELS[d.status]}`}
                onSelect={() => onNavigate('demand-detail', { id: d.id })}
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{d.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {d.serviceCustomerName ?? '—'}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium ml-2',
                    demandStatusTone[d.status],
                  )}
                >
                  {DEMAND_STATUS_LABELS[d.status]}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Services */}
        {!isLoading && services.length > 0 && (
          <CommandGroup heading={`Services · ${services.length}`}>
            {services.slice(0, 30).map((s) => (
              <CommandItem
                key={s.id}
                value={`service ${s.name} ${s.chapter ?? ''} ${SERVICE_DOMAIN_LABELS[s.domain] ?? ''} class ${s.slaClass}`}
                onSelect={() => onNavigate(serviceView)}
              >
                <Library className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {SERVICE_DOMAIN_LABELS[s.domain] ?? s.domain}
                </span>
                <Badge variant="outline" className="ml-2 h-5 px-1.5 text-[10px] font-semibold tabular-nums">
                  Class {s.slaClass}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Changes */}
        {!isLoading && changes.length > 0 && (
          <CommandGroup heading={`Changes · ${changes.length}`}>
            {changes.slice(0, 20).map((c) => (
              <CommandItem
                key={c.id}
                value={`change ${c.title} ${CHANGE_STATUS_LABELS[c.status]} ${c.type}`}
                onSelect={() => onNavigate('changes')}
              >
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[120px]">
                  {c.type.toLowerCase()}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  {CHANGE_STATUS_LABELS[c.status]}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Problems (Service Owner) */}
        {!isLoading && problems.length > 0 && (
          <CommandGroup heading={`Problems · ${problems.length}`}>
            {problems.slice(0, 20).map((p) => (
              <CommandItem
                key={p.id}
                value={`problem ${p.title} ${p.serviceName ?? ''} ${p.status}`}
                onSelect={() => onNavigate('problems')}
              >
                <Bug className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{p.title}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                  {p.serviceName ?? '—'}
                </span>
                <span className="text-xs text-muted-foreground ml-2 capitalize">
                  {p.status?.toLowerCase()}
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
          <span>type to filter</span>
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
