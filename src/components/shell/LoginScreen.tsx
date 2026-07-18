'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiPost } from '@/lib/api';
import { useApp } from '@/lib/store';
import { ROLE_LABELS, type Role, type SessionUser } from '@/lib/types';
import { toast } from 'sonner';
import { ShieldCheck, ArrowRight, Loader2, Lock, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUICK_LOGINS: { role: Role; email: string; name: string; color: string }[] = [
  { role: 'SERVICE_CUSTOMER', email: 'customer@cerebree.io', name: 'Elena Vance', color: '#0d9488' },
  { role: 'SCM_WORKER', email: 'scm@cerebree.io', name: 'Priya Anand', color: '#d97706' },
  { role: 'CM_LEADER', email: 'cmleader@cerebree.io', name: 'Sofia Reyes', color: '#be123c' },
  { role: 'SERVICE_OWNER', email: 'owner@cerebree.io', name: 'Dr. Henrik Sørensen', color: '#15803d' },
];

export function LoginScreen() {
  const setSession = useApp((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();

  function doLogin(emailValue: string, passwordValue: string) {
    startTransition(async () => {
      try {
        const res = await apiPost<{ user: SessionUser }>('/api/auth/login', { email: emailValue, password: passwordValue });
        setSession(res.user);
        toast.success(`Welcome back, ${res.user.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Login failed');
      }
    });
  }

  function quickLogin(emailValue: string) {
    setEmail(emailValue);
    setPassword('demo1234');
    doLogin(emailValue, 'demo1234');
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="relative lg:w-1/2 bg-sidebar text-sidebar-foreground flex flex-col justify-between p-8 lg:p-12 overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-[0.07]" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <div>
              <div className="font-semibold tracking-tight">CereBree</div>
              <div className="text-[11px] text-sidebar-foreground/60 -mt-0.5">uSMS Platform</div>
            </div>
          </div>
        </div>

        <div className="relative max-w-md py-12">
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight">
            Governance is not created by tools. It is created by structure.
          </h1>
          <p className="mt-4 text-sidebar-foreground/70 leading-relaxed">
            The Universal Service Management System — a constitutionally grounded platform where every role has a named
            accountability, every actor finds a governed interface, and every boundary is explained rather than merely enforced.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {(['SERVICE_CUSTOMER', 'SCM_WORKER', 'CM_LEADER', 'SERVICE_OWNER'] as Role[]).map((r) => (
              <span key={r} className="text-xs px-2.5 py-1 rounded-full border border-sidebar-border/60 text-sidebar-foreground/80">
                {ROLE_LABELS[r]}
              </span>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-sidebar-foreground/50">
          HRX · SeOS · uSMS Framework v1.1 · March 2026
        </div>
      </div>

      {/* Login panel */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h2>
            <p className="text-sm text-muted-foreground mt-1">Each role opens a separate, governed workspace.</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doLogin(email, password);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  className="pl-9"
                  placeholder="you@cerebree.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  className="pl-9"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
              {!pending && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Demo accounts</span>
            <Separator className="flex-1" />
          </div>

          <div className="grid gap-2">
            {QUICK_LOGINS.map((q) => (
              <button
                key={q.role}
                type="button"
                onClick={() => quickLogin(q.email)}
                disabled={pending}
                className="group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: q.color }}>
                  {q.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{ROLE_LABELS[q.role]}</div>
                  <div className="text-xs text-muted-foreground truncate">{q.name}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            ))}
          </div>

          <p className="mt-6 text-xs text-center text-muted-foreground">
            Password for all demo accounts: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">demo1234</code>
          </p>
        </div>
      </div>
    </div>
  );
}
