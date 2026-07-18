'use client';

import { useEffect } from 'react';
import { useApp, type ViewKey } from '@/lib/store';
import Dashboard from './Dashboard';
import DemandList from './DemandList';
import DemandDetail from './DemandDetail';
import SubmitDemand from './SubmitDemand';
import Catalog from './Catalog';
import SlaPerformance from './SlaPerformance';
import Knowledge from './Knowledge';
import TicketList from '@/components/workspaces/shared/TicketList';
import TicketDetail from '@/components/workspaces/shared/TicketDetail';

const VALID_VIEWS: ViewKey[] = [
  'dashboard',
  'demands',
  'demand-detail',
  'submit-demand',
  'catalog',
  'sla',
  'knowledge',
  'tickets',
  'ticket-detail',
];

export default function CustomerWorkspace() {
  const { view, params, navigate } = useApp();

  // Guard: if the active view isn't valid for the customer role, fall back to dashboard.
  useEffect(() => {
    if (!VALID_VIEWS.includes(view)) {
      navigate('dashboard');
    }
  }, [view, navigate]);

  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'demands':
      return <DemandList />;
    case 'demand-detail':
      return <DemandDetail id={params.id} />;
    case 'submit-demand':
      return <SubmitDemand />;
    case 'catalog':
      return <Catalog />;
    case 'sla':
      return <SlaPerformance />;
    case 'knowledge':
      return <Knowledge />;
    case 'tickets':
      return (
        <TicketList
          role="SERVICE_CUSTOMER"
          title="My Tickets"
          description="Tickets and incidents raised by your organisational unit. Track triage, progress, and resolution."
        />
      );
    case 'ticket-detail':
      return <TicketDetail id={params.id} role="SERVICE_CUSTOMER" />;
    default:
      return <Dashboard />;
  }
}
