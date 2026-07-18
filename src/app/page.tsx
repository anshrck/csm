'use client';

import { useEffect } from 'react';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import { type SessionUser } from '@/lib/types';
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

export default function Home() {
  const { session, hydrated, setSession, setHydrated } = useApp();

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
