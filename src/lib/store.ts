'use client';

import { create } from 'zustand';
import type { Role, SessionUser } from './types';

// View keys per workspace. Each role maps to a set of views.
export type ViewKey =
  // shared
  | 'dashboard'
  | 'demands'
  | 'demand-detail'
  | 'submit-demand'
  | 'catalog'
  | 'sla'
  | 'changes'
  | 'change-detail'
  | 'handovers'
  | 'portfolio'
  | 'governance'
  | 'problems'
  | 'workers'
  | 'analytics'
  | 'notifications'
  | 'settings';

interface AppState {
  session: SessionUser | null;
  hydrated: boolean;
  view: ViewKey;
  params: Record<string, string>;
  // notification drawer
  notifOpen: boolean;
  aiOpen: boolean;
  // actions
  setSession: (s: SessionUser | null) => void;
  setHydrated: (v: boolean) => void;
  navigate: (view: ViewKey, params?: Record<string, string>) => void;
  setNotifOpen: (v: boolean) => void;
  setAiOpen: (v: boolean) => void;
  logout: () => void;
}

export const useApp = create<AppState>((set) => ({
  session: null,
  hydrated: false,
  view: 'dashboard',
  params: {},
  notifOpen: false,
  aiOpen: false,
  setSession: (s) => set({ session: s }),
  setHydrated: (v) => set({ hydrated: v }),
  navigate: (view, params = {}) => set({ view, params, notifOpen: false }),
  setNotifOpen: (v) => set({ notifOpen: v }),
  setAiOpen: (v) => set({ aiOpen: v }),
  logout: () => set({ session: null, view: 'dashboard', params: {} }),
}));

// Navigation config per role.
export interface NavItem {
  key: ViewKey;
  label: string;
  icon: string; // lucide icon name
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  SERVICE_CUSTOMER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'demands', label: 'My Demands', icon: 'FileText' },
    { key: 'submit-demand', label: 'Submit Demand', icon: 'PlusCircle' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'sla', label: 'SLA Performance', icon: 'Gauge' },
  ],
  SCM_WORKER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'demands', label: 'Demand Queue', icon: 'FileText' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'sla', label: 'SLM Dashboard', icon: 'Gauge' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
    { key: 'handovers', label: 'Handovers', icon: 'ArrowLeftRight' },
  ],
  CM_LEADER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'demands', label: 'Demand Queue', icon: 'FileText' },
    { key: 'workers', label: 'SCM Workers', icon: 'Users' },
    { key: 'sla', label: 'SLM Governance', icon: 'Gauge' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
    { key: 'analytics', label: 'Analytics', icon: 'BarChart3' },
  ],
  SERVICE_OWNER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'portfolio', label: 'Service Portfolio', icon: 'Briefcase' },
    { key: 'sla', label: 'SLA Performance', icon: 'Gauge' },
    { key: 'governance', label: 'Governance Approvals', icon: 'ShieldCheck' },
    { key: 'problems', label: 'Problem Records', icon: 'Bug' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
  ],
};
