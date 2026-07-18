'use client';

import { useEffect, useRef, use } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import { type SessionUser } from '@/lib/types';
import { viewToPath, ROLE_PREFIX, dashboardPath } from '@/lib/routing';
import { LoginScreen } from '@/components/shell/LoginScreen';
import { AppShell } from '@/components/shell/AppShell';
import { AiPanel } from '@/components/ai/AiPanel';
import CustomerWorkspace from '@/components/workspaces/customer/CustomerWorkspace';
import ScmWorkerWorkspace from '@/components/workspaces/scm-worker/ScmWorkerWorkspace';
import CmLeaderWorkspace from '@/components/workspaces/cm-leader/CmLeaderWorkspace';
import ServiceOwnerWorkspace from '@/components/workspaces/service-owner/ServiceOwnerWorkspace';
import GlobalSearch from '@/components/search/GlobalSearch';
import RoleGuidePanel from '@/components/guide/RoleGuidePanel';
import { Loader2, ShieldCheck } from 'lucide-react';

/**
 * Catch-all workspace route.
 *
 * Any URL of the form `/<role-prefix>/<view>` or `/<role-prefix>/<view>/<id>`
 * resolves here. The slug is parsed (via `syncFromUrl`) into the same Zustand
 * view+params the rest of the app already understands, so the existing
 * workspace components keep working unchanged.
 *
 * The store remains the single source of truth for view+params; this page also
 * pushes a new URL whenever the store's view changes (in-app navigation), and
 * syncs the store from the URL whenever the URL changes (browser back/forward
 * or a deep-link).
 *
 * In Next.js 16, `params` is a Promise and must be unwrapped with `use()` in
 * client components. The unwrapped `slug` array is then safe to use in hooks.
 */
export default function CatchAllWorkspacePage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  // Unwrap the params Promise (Next.js 16 requirement for client components).
  const { slug } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const {
    session,
    hydrated,
    setSession,
    setHydrated,
    syncFromUrl,
    view,
    params: storeParams,
    navTick,
  } = useApp();

  /**
   * Ref used to break the URL ⇄ store feedback loop.
   * Set to `true` right before we call `router.push` so the next slug change
   * is recognised as our own push and doesn't re-sync the store (which would
   * clobber any params the in-app navigation set).
   */
  const pushedRef = useRef(false);

  // ---- Hydrate session (same as /) ---------------------------------------
  useEffect(() => {
    let active = true;
    apiGet<{ user: SessionUser }>('/api/auth/me')
      .then((res) => {
        if (active) setSession(res.user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [setSession, setHydrated]);

  // ---- Auth + role-prefix guard -------------------------------------------
  // If unauthenticated → redirect to / (login).
  // If authenticated but URL prefix doesn't match role → redirect to dashboard.
  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      router.replace('/');
      return;
    }
    const expectedPrefix = ROLE_PREFIX[session.role];
    const firstSeg = slug?.[0];
    if (firstSeg !== expectedPrefix) {
      router.replace(dashboardPath(session.role));
    }
  }, [hydrated, session, slug, router]);

  // ---- URL → store sync (browser back/forward, deep-link, refresh) -------
  useEffect(() => {
    if (!hydrated || !session) return;
    if (pushedRef.current) {
      // This slug change came from our own router.push — don't re-sync.
      pushedRef.current = false;
      return;
    }
    if (!slug) return;
    // Skip if the URL prefix doesn't match the role (the redirect above will fire).
    const expectedPrefix = ROLE_PREFIX[session.role];
    if (slug[0] !== expectedPrefix) return;
    syncFromUrl(slug);
  }, [slug, hydrated, session, syncFromUrl]);

  // ---- store → URL push (in-app navigation) -------------------------------
  useEffect(() => {
    if (!hydrated || !session) return;
    const expectedPath = viewToPath(session.role, view, storeParams);
    if (pathname !== expectedPath) {
      pushedRef.current = true;
      router.push(expectedPath);
    }
  }, [navTick, view, storeParams, session, hydrated, pathname, router]);

  // ---- Render states ------------------------------------------------------
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

  // If the URL prefix doesn't match this user's role, the redirect above is
  // already in flight — show a brief loader rather than rendering the wrong
  // workspace.
  const expectedPrefix = ROLE_PREFIX[session.role];
  if (slug?.[0] !== expectedPrefix) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Redirecting to your workspace…
        </div>
      </div>
    );
  }

  const workspace = (() => {
    switch (session.role) {
      case 'SERVICE_CUSTOMER':
        return <CustomerWorkspace />;
      case 'SCM_WORKER':
        return <ScmWorkerWorkspace />;
      case 'CM_LEADER':
        return <CmLeaderWorkspace />;
      case 'SERVICE_OWNER':
        return <ServiceOwnerWorkspace />;
      default:
        return null;
    }
  })();

  return (
    <>
      <AppShell>{workspace}</AppShell>
      <AiPanel />
      <GlobalSearch />
      <RoleGuidePanel />
    </>
  );
}
