'use client';

import { useApp } from '@/lib/store';
import Dashboard from './Dashboard';
import Portfolio from './Portfolio';
import SlaPerformance from './SlaPerformance';
import Governance from './Governance';
import Problems from './Problems';
import Changes from './Changes';
import DemandDetail from './DemandDetail';

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
    case 'demand-detail':
      return <DemandDetail id={params.id} />;
    default:
      return <Dashboard />;
  }
}
