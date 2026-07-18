'use client';

import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import DemandDetail from '@/components/workspaces/shared/DemandDetail';
import Dashboard from './Dashboard';
import DemandQueue from './DemandQueue';
import Workers from './Workers';
import SlmGovernance from './SlmGovernance';
import Catalog from './Catalog';
import Changes from './Changes';
import Analytics from './Analytics';
import Knowledge from './Knowledge';
import TicketList from '@/components/workspaces/shared/TicketList';
import TicketDetail from '@/components/workspaces/shared/TicketDetail';

// Reports view is loaded via next/dynamic (ssr:false) to keep its large
// recharts bundle out of the initial client bundle for CM Leader users who
// never open it. Loading state shown while the chunk resolves.
const Reports = dynamic(
  () => import('@/components/workspaces/shared/Reports'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="h-9 w-64 rounded-md bg-muted/40 animate-pulse" />
        <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    ),
  },
);

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
    case 'reports':
      return <Reports />;
    case 'knowledge':
      return <Knowledge />;
    case 'tickets':
      return (
        <TicketList
          role="CM_LEADER"
          title="Ticket Queue — Tenant Overview"
          description="All tenant tickets. Triage, reassign, progress, resolve, and monitor SLA performance. Use bulk assign to distribute work."
        />
      );
    case 'ticket-detail':
      return <TicketDetail id={params.id} role="CM_LEADER" />;
    default:
      return <Dashboard />;
  }
}
