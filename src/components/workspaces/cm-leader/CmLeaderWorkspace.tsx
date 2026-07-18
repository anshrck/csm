'use client';

import { useApp } from '@/lib/store';
import DemandDetail from '@/components/workspaces/shared/DemandDetail';
import Dashboard from './Dashboard';
import DemandQueue from './DemandQueue';
import Workers from './Workers';
import SlmGovernance from './SlmGovernance';
import Catalog from './Catalog';
import Changes from './Changes';
import Analytics from './Analytics';

export default function CmLeaderWorkspace() {
  const { view, params } = useApp();
  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'demands':
      return <DemandQueue />;
    case 'demand-detail':
      return <DemandDetail id={params.id} role="CM_LEADER" />;
    case 'workers':
      return <Workers />;
    case 'sla':
      return <SlmGovernance />;
    case 'catalog':
      return <Catalog />;
    case 'changes':
      return <Changes />;
    case 'analytics':
      return <Analytics />;
    default:
      return <Dashboard />;
  }
}
