'use client';

import * as React from 'react';
import { useApp } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BookOpen, CornerDownLeft, X } from 'lucide-react';
import { ROLE_GUIDES, ROLE_GUIDE_ORDER } from './guides';
import type { Role } from '@/lib/types';

/**
 * RoleGuidePanel — a self-mounting role guide reference viewer.
 *
 * Renders a floating action button (bottom-right) that opens a Dialog showing
 * the current user's role guide. Includes a selector to view the other roles
 * for cross-role context. Also toggles via Cmd/Ctrl+G.
 *
 * Mount this component once anywhere in the app — it registers its own
 * listeners and overlays.
 */
export default function RoleGuidePanel() {
  const { session } = useApp();
  const [open, setOpen] = React.useState(false);
  const [selectedRole, setSelectedRole] = React.useState<Role | null>(null);

  // Register global Cmd/Ctrl+G shortcut.
  React.useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        const target = e.target as HTMLElement | null;
        // Don't hijack when typing in a form field.
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [session]);

  // Default the selector to the current role whenever the dialog opens.
  React.useEffect(() => {
    if (open && session) {
      setSelectedRole(session.role);
    }
  }, [open, session]);

  // Reset the selection when the dialog closes so the next open starts fresh.
  React.useEffect(() => {
    if (!open) setSelectedRole(null);
  }, [open]);

  if (!session) return null;

  const role = selectedRole ?? session.role;
  const guide = ROLE_GUIDES[role];
  const isCurrent = role === session.role;

  return (
    <>
      {/* Floating action button */}
      <Button
        type="button"
        size="icon"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'ring-1 ring-primary/30 hover:ring-primary/40',
          'transition-all hover:scale-105 active:scale-95',
        )}
        aria-label="Open Role Guide"
        title="Open Role Guide (Ctrl/⌘ + G)"
      >
        <BookOpen className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh]"
          showCloseButton={false}
        >
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-br from-primary/5 to-transparent">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-lg sm:text-xl flex items-center gap-2 flex-wrap">
                  <BookOpen className="h-5 w-5 text-primary shrink-0" />
                  <span className="truncate">Role Guide — {guide.title}</span>
                  {isCurrent ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-primary/10 text-primary px-2 py-0.5 border border-primary/20">
                      Your role
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-muted text-muted-foreground px-2 py-0.5 border border-border">
                      Cross-role context
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="mt-1.5">
                  CereBree uSMS · what your role means structurally.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 -mr-2 -mt-1 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Role tagline + layer */}
            <div className="mt-3 space-y-0.5">
              <p className="text-sm font-medium text-foreground/90">{guide.tagline}</p>
              <p className="text-xs text-muted-foreground">{guide.layer}</p>
            </div>

            {/* Role selector */}
            <div
              role="tablist"
              aria-label="Select role guide"
              className="mt-4 flex gap-1.5 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-1"
            >
              {ROLE_GUIDE_ORDER.map((r) => {
                const g = ROLE_GUIDES[r];
                const active = r === role;
                return (
                  <button
                    key={r}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedRole(r)}
                    className={cn(
                      'shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      active
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {g.title}
                  </button>
                );
              })}
            </div>
          </DialogHeader>

          {/* Body */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-5 space-y-6">
              {guide.sections.map((section) => (
                <section key={section.heading} className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-primary" />
                    {section.heading}
                  </h3>
                  {section.paragraphs?.map((p, i) => (
                    <p key={i} className="text-sm leading-relaxed text-foreground/80">
                      {p}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="space-y-1.5">
                      {section.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground/80">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}

              <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Based on the{' '}
                  <span className="font-medium text-foreground/80">uSMS Role Guide Suite v1.0</span>.
                  Summarized for in-app reference — consult the full guide for edge cases and escalation detail.
                </p>
              </div>
            </div>
          </ScrollArea>

          {/* Footer hint */}
          <div className="border-t bg-muted/30 px-6 py-2.5 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <CornerDownLeft className="h-3 w-3" />
              esc to close · switch roles above
            </p>
            <p className="text-[11px] text-muted-foreground">uSMS Role Guide Suite v1.0</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
