'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import { type SessionUser } from '@/lib/types';
import { LoginScreen } from '@/components/shell/LoginScreen';
import { dashboardPath } from '@/lib/routing';
import { Loader2, ShieldCheck } from 'lucide-react';

/**
 * Root entry.
 *
 * - While hydrating: full-screen loader.
 * - If unauthenticated: render the login screen.
 * - If authenticated: redirect to the role-prefixed dashboard.
 */
export default function Home() {
  const router = useRouter();
  const { session, hydrated, setSession, setHydrated } = useApp();

  // Fetch session ONCE on mount. No cleanup cancellation — we always want the
  // result to land so hydration never stalls.
  useEffect(() => {
    let cancelled = false;
    apiGet<{ user: SessionUser | null }>('/api/auth/me')
      .then((res) => {
        if (!cancelled && res?.user) setSession(res.user);
      })
      .catch(() => {
        /* not logged in — that's fine, show login */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect to the workspace once hydrated + authenticated.
  useEffect(() => {
    if (hydrated && session) {
      router.replace(dashboardPath(session.role));
    }
  }, [hydrated, session, router]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading CereBree uSMS…
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  // Brief loader while we hand off to the workspace route.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your workspace…
      </div>
    </div>
  );
}
