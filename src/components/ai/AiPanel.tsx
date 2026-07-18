'use client';

import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useApp } from '@/lib/store';
import { apiPost } from '@/lib/api';
import { toast } from 'sonner';
import { Sparkles, Send, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Role, SessionUser } from '@/lib/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
};

const SUGGESTED_PROMPTS: Record<Role, string[]> = {
  SERVICE_CUSTOMER: [
    "What's the status of my demands?",
    'Which of my services have SLA warnings?',
    'What can I request from the catalog?',
  ],
  SCM_WORKER: [
    'Which demands need my attention?',
    'Summarize SLA breaches in my scope.',
    "What's awaiting customer action?",
  ],
  CM_LEADER: [
    'Which quotes need my approval?',
    'Show SCM worker workload.',
    'Summarize active SLA breaches.',
  ],
  SERVICE_OWNER: [
    'Which of my services have SLA issues?',
    'What governance approvals are pending?',
    'Summarize open problems on my services.',
  ],
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AiPanel() {
  const { aiOpen, setAiOpen, session } = useApp();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const role: Role = session?.role ?? 'SERVICE_CUSTOMER';
  const prompts = SUGGESTED_PROMPTS[role] ?? [];
  const hasMessages = messages.length > 0;

  // Auto-scroll to bottom when messages change or while pending.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Focus the textarea when the panel opens.
  React.useEffect(() => {
    if (aiOpen) {
      const t = window.setTimeout(() => textareaRef.current?.focus(), 350);
      return () => window.clearTimeout(t);
    }
  }, [aiOpen]);

  // Auto-resize the textarea (works alongside field-sizing where supported).
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending || !session) return;

    const userMsg: ChatMessage = { id: newId(), role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setPending(true);

    try {
      const res = await apiPost<{ reply?: string; error?: string }>('/api/ai', { message: content });
      if (res && typeof res.reply === 'string' && res.reply.length > 0) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'assistant', content: res.reply as string },
        ]);
      } else {
        const errMsg = (res && res.error) || 'Cogni could not produce a response.';
        toast.error(errMsg);
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'assistant', content: errMsg, error: true },
        ]);
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      const msg = err?.message || 'Cogni service is unavailable.';
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'assistant', content: msg, error: true },
      ]);
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function clearConversation() {
    setMessages([]);
    setInput('');
    textareaRef.current?.focus();
  }

  return (
    <Sheet open={aiOpen} onOpenChange={setAiOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg p-0 flex flex-col gap-0"
      >
        {/* Header — dark sidebar accent */}
        <SheetHeader className="bg-sidebar text-sidebar-foreground px-5 py-4 border-b border-sidebar-border/60 pr-14">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sidebar-foreground leading-tight">
                Cogni — Operational Intelligence
              </SheetTitle>
              <SheetDescription className="text-sidebar-foreground/70">
                Your role-scoped AI assistant.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Body — message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4 bg-muted/30"
          role="log"
          aria-live="polite"
          aria-label="Cogni conversation"
        >
          {!hasMessages ? (
            <WelcomeBlock
              session={session}
              prompts={prompts}
              onPick={(t) => send(t)}
              disabled={pending}
            />
          ) : (
            <>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} session={session} />
              ))}
              {pending && <TypingIndicator />}
            </>
          )}
        </div>

        {/* Input area + footer note */}
        <div className="border-t bg-card">
          <div className="p-3 space-y-2">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pending ? 'Cogni is thinking…' : 'Ask Cogni about your portfolio…'}
                disabled={pending || !session}
                rows={1}
                className="resize-none min-h-[44px] max-h-40 bg-background field-sizing-fixed"
                aria-label="Message Cogni"
              />
              <Button
                size="icon"
                onClick={() => send(input)}
                disabled={pending || !input.trim() || !session}
                className="h-10 w-10 shrink-0"
                aria-label="Send message"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-muted-foreground leading-tight">
                Cogni assists or redirects — it never decides autonomously.
              </p>
              {hasMessages && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearConversation}
                  disabled={pending}
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  title="Clear conversation"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Welcome + suggested prompts -----------------------------------------
function WelcomeBlock({
  session,
  prompts,
  onPick,
  disabled,
}: {
  session: SessionUser | null;
  prompts: string[];
  onPick: (t: string) => void;
  disabled: boolean;
}) {
  const firstName = session?.name?.split(' ')[0] ?? 'there';
  return (
    <div className="h-full flex flex-col items-center text-center pt-6 pb-2">
      <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center mb-3">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-semibold">Hi {firstName}, I&apos;m Cogni.</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
        I can answer questions about your demands, services, SLA events, and
        governance state — grounded in your live portfolio.
      </p>
      <div className="mt-5 w-full space-y-2 text-left">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          Try asking
        </p>
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="w-full text-left text-sm rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 px-3 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Message bubble ------------------------------------------------------
function MessageBubble({
  message,
  session,
}: {
  message: ChatMessage;
  session: SessionUser | null;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
        style={
          isUser
            ? { backgroundColor: session?.avatarColor ?? '#0d9488' }
            : undefined
        }
      >
        {isUser ? (
          <span className="text-[11px] font-semibold text-white">
            {initials(session?.name ?? 'U')}
          </span>
        ) : (
          <Sparkles className="h-4 w-4 text-sidebar-primary-foreground" />
        )}
      </div>
      <div
        className={cn(
          'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap break-words',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : message.error
              ? 'bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-100 border border-rose-200 dark:border-rose-900 rounded-tl-sm'
              : 'bg-card border rounded-tl-sm',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

// --- Typing indicator ----------------------------------------------------
function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="h-8 w-8 rounded-full bg-sidebar flex items-center justify-center shrink-0">
        <Sparkles className="h-4 w-4 text-sidebar-primary-foreground" />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-card border">
        <div className="flex gap-1 items-center" aria-label="Cogni is typing">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
        </div>
      </div>
    </div>
  );
}
