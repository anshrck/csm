'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp, NAV_BY_ROLE, type ViewKey } from '@/lib/store';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { type SessionUser, type Notification, ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RelativeTime } from '@/components/shared';
import * as Icons from 'lucide-react';
import { toast } from 'sonner';

const WORKSPACE_TITLES: Record<string, string> = {
  SERVICE_CUSTOMER: 'CSM Portal',
  SCM_WORKER: 'CSM Workspace',
  CM_LEADER: 'CSM Workspace',
  SERVICE_OWNER: 'Service Owner Portal',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, view, navigate, logout, notifOpen, setNotifOpen, aiOpen, setAiOpen } = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  if (!session) return null;
  const nav = NAV_BY_ROLE[session.role] ?? [];
  const wsTitle = WORKSPACE_TITLES[session.role] ?? 'Workspace';

  // Sidebar nav: keep `navigate()` so the existing in-app state updates + URL
  // push (handled by the catch-all route's effect) both fire. `navigate` is
  // already wired into the URL sync hook on the catch-all page, so clicking a
  // sidebar item updates the URL via router.push and adds a history entry.
  const handleNavigate = (v: ViewKey) => {
    navigate(v);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex w-60 flex-col bg-sidebar text-sidebar-foreground shrink-0">
          <SidebarContent session={session} nav={nav} activeView={view} onNavigate={handleNavigate} />
        </aside>

        {/* Mobile nav sheet */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground">
            <SidebarContent
              session={session}
              nav={nav}
              activeView={view}
              onNavigate={handleNavigate}
            />
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            session={session}
            wsTitle={wsTitle}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onOpenNotif={() => setNotifOpen(true)}
            onOpenAi={() => setAiOpen(!aiOpen)}
          />
          <main className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
          </main>
        </div>
      </div>
      <Footer />
      <NotificationDrawer open={notifOpen} onOpenChange={setNotifOpen} userId={session.id} />
    </div>
  );
}

function SidebarContent({
  session,
  nav,
  activeView,
  onNavigate,
}: {
  session: SessionUser;
  nav: { key: string; label: string; icon: string }[];
  activeView: string;
  onNavigate: (v: any) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-sidebar-border/60">
        <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
          <Icons.ShieldCheck className="h-4.5 w-4.5 text-sidebar-primary-foreground" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold tracking-tight text-sm leading-tight">CereBree</div>
          <div className="text-[10px] text-sidebar-foreground/60 leading-tight">uSMS Platform</div>
        </div>
      </div>

      <div className="px-3 py-4 border-b border-sidebar-border/60">
        <div className="flex items-center gap-2.5 px-2">
          <Avatar className="h-9 w-9 border border-sidebar-border/60">
            <AvatarFallback style={{ backgroundColor: session.avatarColor, color: 'white' }} className="text-xs font-semibold">
              {session.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{session.name}</div>
            <div className="text-[11px] text-sidebar-foreground/60 truncate">{ROLE_LABELS[session.role]}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {nav.map((item) => {
          const Icon = (Icons as any)[item.icon] ?? Icons.Circle;
          const active = activeView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left',
                active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border/60">
        <div className="px-2 py-1.5 rounded-md bg-sidebar-accent/50">
          <p className="text-[10px] text-sidebar-foreground/60 leading-relaxed">{ROLE_DESCRIPTIONS[session.role]}</p>
        </div>
      </div>
    </div>
  );
}

function TopBar({
  session,
  wsTitle,
  onOpenMobileNav,
  onOpenNotif,
  onOpenAi,
}: {
  session: SessionUser;
  wsTitle: string;
  onOpenMobileNav: () => void;
  onOpenNotif: () => void;
  onOpenAi: () => void;
}) {
  const { logout } = useApp();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    apiGet<{ unread: number }>('/api/notifications?count=1').then((r) => active && setUnread(r.unread)).catch(() => {});
    const t = setInterval(() => {
      apiGet<{ unread: number }>('/api/notifications?count=1').then((r) => active && setUnread(r.unread)).catch(() => {});
    }, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [session.id]);

  async function handleLogout() {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      /* ignore */
    }
    logout();
    toast.success('Signed out');
    // After clearing the session, send the user back to the login screen at `/`.
    // The catch-all workspace route would otherwise redirect them itself, but
    // doing it here keeps the URL clean and avoids a flash of the workspace.
    router.replace('/');
  }

  return (
    <header className="h-16 border-b bg-card/80 backdrop-blur sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav}>
        <Icons.Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <Icons.Layers className="h-4 w-4 text-muted-foreground hidden sm:block" />
        <span className="text-sm font-medium truncate">{wsTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="gap-2" onClick={onOpenAi}>
          <Icons.Sparkles className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Cogni</span>
        </Button>
        <Button variant="ghost" size="icon" className="relative" onClick={onOpenNotif} aria-label="Notifications">
          <Icons.Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-muted transition-colors">
              <Avatar className="h-8 w-8 border">
                <AvatarFallback style={{ backgroundColor: session.avatarColor, color: 'white' }} className="text-xs font-semibold">
                  {session.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                </AvatarFallback>
              </Avatar>
              <Icons.ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{session.name}</span>
                <span className="text-xs text-muted-foreground">{session.email}</span>
                <Badge variant="outline" className="mt-1.5 w-fit text-[10px]">{ROLE_LABELS[session.role]}</Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {session.title && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{session.title}</div>
            )}
            {session.orgNodeName && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                <Icons.Building2 className="h-3 w-3" /> {session.orgNodeName}
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-rose-600 focus:text-rose-700">
              <Icons.LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function NotificationDrawer({ open, onOpenChange, userId }: { open: boolean; onOpenChange: (v: boolean) => void; userId: string }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => apiGet<Notification[]>('/api/notifications'),
    enabled: open,
    staleTime: 10_000,
  });

  async function markAllRead() {
    try {
      await apiPatch('/api/notifications/read-all');
      queryClient.setQueryData<Notification[]>(['notifications', userId], (prev) =>
        (prev ?? []).map((n) => ({ ...n, read: true })),
      );
    } catch {
      toast.error('Could not mark notifications as read');
    }
  }

  async function markRead(id: string) {
    try {
      await apiPatch(`/api/notifications/${id}/read`);
      queryClient.setQueryData<Notification[]>(['notifications', userId], (prev) =>
        (prev ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Icons.Bell className="h-4 w-4" /> Notifications
            </SheetTitle>
            {items.some((n) => !n.read) && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs h-7">
                Mark all read
              </Button>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Icons.BellOff className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'w-full text-left px-5 py-3.5 flex gap-3 hover:bg-muted/50 transition-colors',
                    !n.read && 'bg-primary/[0.03]',
                  )}
                >
                  {!n.read && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                  {n.read && <span className="mt-1.5 h-2 w-2 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn('text-sm', !n.read ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                      <RelativeTime date={n.createdAt} className="text-[11px] text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Icons.ShieldCheck className="h-3.5 w-3.5" />
          <span>CereBree uSMS · Universal Service Management System</span>
        </div>
        <div className="flex items-center gap-3">
          <span>HRX · SeOS · uSMS Framework v1.1</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Reduced to the Max</span>
        </div>
      </div>
    </footer>
  );
}
