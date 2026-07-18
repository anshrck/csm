'use client';

import * as React from 'react';
import { useApp, type ViewKey } from '@/lib/store';
import { apiPost } from '@/lib/api';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CommandPalette } from './CommandPalette';
import { toast } from 'sonner';

/**
 * GlobalSearch — a self-mounting global search command palette.
 *
 * Listens for Cmd/Ctrl+K and opens a centered cmdk-style dialog that searches
 * across the user's role-scoped entities (demands, services, changes, problems)
 * and exposes quick actions.
 *
 * Mount this component once anywhere in the app — it registers its own
 * keydown listener and renders its own overlay. Does nothing until a session
 * is present.
 */
export default function GlobalSearch() {
  const { session, navigate, setAiOpen, logout } = useApp();
  const [open, setOpen] = React.useState(false);

  // Register global Cmd/Ctrl+K shortcut.
  React.useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [session]);

  // Close on Escape is handled natively by the Dialog. We also clear any
  // in-flight selection state by unmounting the palette when closed (Dialog
  // only mounts content while open).

  const handleNavigate = React.useCallback(
    (view: ViewKey, params?: Record<string, string>) => {
      navigate(view, params);
      setOpen(false);
    },
    [navigate],
  );

  const handleOpenAi = React.useCallback(() => {
    setAiOpen(true);
    setOpen(false);
  }, [setAiOpen]);

  const handleSignOut = React.useCallback(async () => {
    setOpen(false);
    try {
      await apiPost('/api/auth/logout');
    } catch {
      /* ignore — clear local state regardless */
    }
    logout();
    toast.success('Signed out');
  }, [logout]);

  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden rounded-lg shadow-xl"
        showCloseButton={false}
      >
        {/* Screen-reader title (the palette's own header is visual-only). */}
        <DialogTitle className="sr-only">Global search</DialogTitle>
        <DialogDescription className="sr-only">
          Search across your demands, services, changes, and quick actions.
        </DialogDescription>
        <CommandPalette
          role={session.role}
          onNavigate={handleNavigate}
          onOpenAi={handleOpenAi}
          onSignOut={handleSignOut}
        />
      </DialogContent>
    </Dialog>
  );
}
