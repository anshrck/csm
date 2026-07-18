'use client';

import { create } from 'zustand';
import type { Role, SessionUser } from './types';
import { pathToView } from './routing';

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
  | 'reports'
  | 'notifications'
  | 'settings'
  | 'knowledge'
  // tickets (Phase 2 — shared workspace)
  | 'tickets'
  | 'ticket-detail'
  // Enterprise Workflow Review — ticket UI + CSAT follow-up + customer assignment
  | 'submit-ticket'
  | 'ticket-ops'
  | 'service-incidents'
  | 'csat-followup'
  // Enterprise Workflow Review — CM Leader oversight views
  | 'audit'
  | 'delivery-failures'
  // Service Owner Enterprise
  | 'service-health'
  | 'known-errors'
  | 'customer-impact'
  | 'risk-register'
  | 'lifecycle'
  | 'owner-audit'
  | 'service-detail'
  | 'article-detail';

interface AppState {
  session: SessionUser | null;
  hydrated: boolean;
  view: ViewKey;
  params: Record<string, string>;
  // notification drawer
  notifOpen: boolean;
  aiOpen: boolean;
  /**
   * Monotonically increasing counter that ticks every time the view changes
   * due to an in-app navigation. The catch-all route subscribes to it to know
   * when to push a new URL entry (as opposed to syncing from a URL change
   * caused by browser back/forward).
   */
  navTick: number;
  // actions
  setSession: (s: SessionUser | null) => void;
  setHydrated: (v: boolean) => void;
  navigate: (view: ViewKey, params?: Record<string, string>) => void;
  /** Updates the view + params from a URL change (browser back/forward / deep-link). Does NOT push a new URL. */
  syncFromUrl: (slug: string[]) => void;
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
  navTick: 0,
  setSession: (s) => set({ session: s }),
  setHydrated: (v) => set({ hydrated: v }),
  navigate: (view, params = {}) =>
    set((state) => ({ view, params, notifOpen: false, navTick: state.navTick + 1 })),
  syncFromUrl: (slug) => {
    const { view, params } = pathToView(slug);
    set({ view, params, notifOpen: false });
  },
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
    { key: 'tickets', label: 'My Tickets', icon: 'Ticket' },
    { key: 'submit-ticket', label: 'Submit Ticket', icon: 'PlusCircle' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'sla', label: 'SLA Performance', icon: 'Gauge' },
    { key: 'knowledge', label: 'Knowledge Base', icon: 'BookOpen' },
  ],
  SCM_WORKER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'demands', label: 'Demand Queue', icon: 'FileText' },
    { key: 'tickets', label: 'Ticket Queue', icon: 'Ticket' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'sla', label: 'SLM Dashboard', icon: 'Gauge' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
    { key: 'handovers', label: 'Handovers', icon: 'ArrowLeftRight' },
    { key: 'knowledge', label: 'Knowledge Base', icon: 'BookOpen' },
  ],
  CM_LEADER: [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'demands', label: 'Demand Queue', icon: 'FileText' },
    { key: 'tickets', label: 'Ticket Queue', icon: 'Ticket' },
    { key: 'ticket-ops', label: 'Ticket Operations', icon: 'ClipboardList' },
    { key: 'workers', label: 'SCM Workers', icon: 'Users' },
    { key: 'sla', label: 'SLM Governance', icon: 'Gauge' },
    { key: 'csat-followup', label: 'CSAT Follow-up', icon: 'HeartHandshake' },
    { key: 'catalog', label: 'Service Catalog', icon: 'Library' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
    { key: 'reports', label: 'Reports', icon: 'BarChart3' },
    { key: 'analytics', label: 'Analytics', icon: 'TrendingUp' },
    { key: 'audit', label: 'Audit Log', icon: 'ScrollText' },
    { key: 'delivery-failures', label: 'Delivery Admin', icon: 'MailCheck' },
    { key: 'knowledge', label: 'Knowledge Base', icon: 'BookOpen' },
  ],
  SERVICE_OWNER: [
    { key: 'dashboard', label: 'Command Center', icon: 'LayoutDashboard' },
    { key: 'service-health', label: 'Service Health', icon: 'Activity' },
    { key: 'service-incidents', label: 'Incidents', icon: 'Flame' },
    { key: 'sla', label: 'SLA Performance', icon: 'Gauge' },
    { key: 'governance', label: 'Governance', icon: 'ShieldCheck' },
    { key: 'problems', label: 'Problems', icon: 'Bug' },
    { key: 'known-errors', label: 'Known Errors', icon: 'BookOpen' },
    { key: 'changes', label: 'Changes', icon: 'GitBranch' },
    { key: 'customer-impact', label: 'Customer Impact', icon: 'Users' },
    { key: 'risk-register', label: 'Risk Register', icon: 'TriangleAlert' },
    { key: 'lifecycle', label: 'Lifecycle', icon: 'RefreshCw' },
    { key: 'portfolio', label: 'Service Portfolio', icon: 'Briefcase' },
    { key: 'reports', label: 'Reports', icon: 'BarChart3' },
    { key: 'owner-audit', label: 'Audit Log', icon: 'ScrollText' },
    { key: 'knowledge', label: 'Knowledge', icon: 'BookOpen' },
  ],
};
