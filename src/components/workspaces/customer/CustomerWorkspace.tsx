'use client';

import { useEffect } from 'react';
import { useApp, type ViewKey } from '@/lib/store';
import Dashboard from './Dashboard';
import DemandList from './DemandList';
import DemandDetail from './DemandDetail';
import SubmitDemand from './SubmitDemand';
import Catalog from './Catalog';
import SlaPerformance from './SlaPerformance';

const VALID_VIEWS: ViewKey[] = [
  'dashboard',
  'demands',
  'demand-detail',
  'submit-demand',
  'catalog',
  'sla',
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
    default:
      return <Dashboard />;
  }
}
