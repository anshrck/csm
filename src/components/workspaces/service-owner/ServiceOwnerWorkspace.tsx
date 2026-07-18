'use client';

import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import Dashboard from './Dashboard';
import Portfolio from './Portfolio';
import SlaPerformance from './SlaPerformance';
import Governance from './Governance';
import Problems from './Problems';
import Changes from './Changes';
import DemandDetail from './DemandDetail';
import Knowledge from './Knowledge';
import ServiceTickets from './ServiceTickets';
import TicketList from '@/components/workspaces/shared/TicketList';
import TicketDetail from '@/components/workspaces/shared/TicketDetail';

// Reports view is loaded via next/dynamic (ssr:false) to keep its large
// recharts bundle out of the initial client bundle for Service Owner users
// who never open it. Loading state shown while the chunk resolves.
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

/**
 * Service Owner workspace — accountability command center.
 *
 * The Service Owner sits in the Owner layer and is structurally accountable
 * for service value, quality, and SLA commitments. This workspace surfaces
 * portfolio status, SLA performance, pending governance approvals, active
 * problem records, and known errors — framed around governance obligations
 * rather than passive feed consumption.
 */
export default function ServiceOwnerWorkspace() {
  const { view, params } = useApp();

  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'portfolio':
      return <Portfolio />;
    case 'sla':
      return <SlaPerformance />;
    case 'governance':
      return <Governance />;
    case 'problems':
      return <Problems />;
    case 'changes':
      return <Changes />;
    case 'reports':
      return <Reports />;
    case 'demand-detail':
      return <DemandDetail id={params.id} />;
    case 'knowledge':
      return <Knowledge />;
    case 'tickets':
      return (
        <TicketList
          role="SERVICE_OWNER"
          title="Service Tickets — Owned Services"
          description="Tickets raised on the services you own. Read-only oversight of triage, SLA performance, and resolution activity."
          hideCreate
        />
      );
    case 'service-incidents':
      return <ServiceTickets />;
    case 'ticket-detail':
      return <TicketDetail id={params.id} role="SERVICE_OWNER" />;
    default:
      return <Dashboard />;
  }
}
