'use client';

import { useApp } from '@/lib/store';
import dynamic from 'next/dynamic';
import Dashboard from './Dashboard';
import DemandQueue from './DemandQueue';
import Catalog from './Catalog';
import SlmDashboard from './SlmDashboard';
import Changes from './Changes';
import Handovers from './Handovers';

// DemandDetail is built by Task 5 in @/components/workspaces/shared/DemandDetail.
// Use a dynamic import so the SCM workspace can boot independently and so the
// demand-detail route only resolves when the user actually opens a demand.
const DemandDetail = dynamic(
  () => import('@/components/workspaces/shared/DemandDetail'),
  {
    loading: () => (
      <div className="p-8 text-sm text-muted-foreground">Loading demand…</div>
    ),
    ssr: false,
  },
) as React.ComponentType<{ id: string; role: 'SCM_WORKER' | 'CM_LEADER' }>;

export default function ScmWorkerWorkspace() {
  const { view, params } = useApp();
  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'demands':
      return <DemandQueue />;
    case 'demand-detail':
      return <DemandDetail id={params.id} role="SCM_WORKER" />;
    case 'catalog':
      return <Catalog />;
    case 'sla':
      return <SlmDashboard />;
    case 'changes':
      return <Changes />;
    case 'handovers':
      return <Handovers />;
    default:
      return <Dashboard />;
  }
}
