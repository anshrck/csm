// Shared TypeScript types + label maps for the Ticket / Incident domain.
//
// These types describe the wire format returned by the tickets API routes
// (`/api/tickets` and sub-routes). They are deliberately a separate module
// from `@/lib/types` so the foundation file stays untouched.

import type { Role } from './types';

// ---- Enums ----

export type TicketType = 'INCIDENT' | 'SERVICE_REQUEST' | 'QUESTION' | 'COMPLAINT';

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

export type Impact = 'LOW' | 'MEDIUM' | 'HIGH';

export type TicketStatus =
  | 'NEW'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELED';

export type ResolutionCode =
  | 'FIXED'
  | 'WORKAROUND'
  | 'DUPLICATE'
  | 'NOT_REPRODUCIBLE'
  | 'OUT_OF_SCOPE';

export type TicketEventType =
  | 'CREATED'
  | 'ASSIGNED'
  | 'TRIAGED'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'RESUMED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELED'
  | 'COMMENT';

export type SlaClockType = 'RESPONSE' | 'RESOLUTION';

export type SlaClockStatus = 'RUNNING' | 'PAUSED' | 'MET' | 'BREACHED' | 'CANCELED';

// ---- Label maps ----

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  INCIDENT: 'Incident',
  SERVICE_REQUEST: 'Service Request',
  QUESTION: 'Question',
  COMPLAINT: 'Complaint',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  P1: 'P1 — Critical',
  P2: 'P2 — High',
  P3: 'P3 — Medium',
  P4: 'P4 — Low',
};

export const TICKET_PRIORITY_SHORT: Record<TicketPriority, string> = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'New',
  TRIAGED: 'Triaged',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  WAITING_CUSTOMER: 'Waiting Customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELED: 'Canceled',
};

export const RESOLUTION_CODE_LABELS: Record<ResolutionCode, string> = {
  FIXED: 'Fixed',
  WORKAROUND: 'Workaround',
  DUPLICATE: 'Duplicate',
  NOT_REPRODUCIBLE: 'Not Reproducible',
  OUT_OF_SCOPE: 'Out of Scope',
};

export const IMPACT_LABELS: Record<Impact, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const SLA_CLOCK_TYPE_LABELS: Record<SlaClockType, string> = {
  RESPONSE: 'Response',
  RESOLUTION: 'Resolution',
};

export const SLA_CLOCK_STATUS_LABELS: Record<SlaClockStatus, string> = {
  RUNNING: 'Running',
  PAUSED: 'Paused',
  MET: 'Met',
  BREACHED: 'Breached',
  CANCELED: 'Canceled',
};

// ---- Interfaces (wire format) ----

export interface TicketEventRow {
  id: string;
  ticketId: string;
  eventType: string;
  actorId: string | null;
  actorName: string;
  notes: string | null;
  createdAt: string;
}

export interface SlaClockRow {
  id: string;
  ticketId: string;
  policyId: string;
  policyName?: string;
  type: SlaClockType;
  status: SlaClockStatus;
  startedAt: string;
  dueAt: string;
  pausedAt: string | null;
  totalPausedMins: number;
  metAt: string | null;
  breachedAt: string | null;
  // Derived display helpers (computed by the API)
  remainingMins: number | null; // minutes remaining until dueAt (negative if overdue); null when not RUNNING
  elapsedMins: number; // minutes elapsed since startedAt (excluding paused)
  percentRemaining: number | null; // 0..100 of clock time remaining; null when not RUNNING or dueAt<=startedAt
  // Optional context fields joined by /api/sla-clocks (ticket/policy/service/customer)
  ticketNumber?: string;
  ticketTitle?: string;
  ticketStatus?: string;
  ticketPriority?: string;
  ticketType?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  serviceCustomerId?: string;
  serviceCustomerName?: string | null;
}

export interface Ticket {
  id: string;
  number: string;
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  impact: Impact | null;
  urgency: Impact | null;
  status: TicketStatus;
  serviceId: string | null;
  serviceName: string | null;
  serviceCustomerId: string;
  serviceCustomerName: string | null;
  requesterId: string;
  requesterName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignmentGroupId: string | null;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  // Relations only included on the single-ticket GET
  events?: TicketEventRow[];
  slaClocks?: SlaClockRow[];
}

// ---- Helper: derive a coarse SLA health from a set of clocks ----

export type TicketSlaHealth = 'on_track' | 'at_risk' | 'breached' | 'met' | 'paused' | 'none';

export function deriveSlaHealth(clocks: SlaClockRow[] | undefined): TicketSlaHealth {
  if (!clocks || clocks.length === 0) return 'none';
  let hasBreached = false;
  let hasMet = true;
  let hasRunning = false;
  let hasPaused = false;
  for (const c of clocks) {
    if (c.status === 'BREACHED') hasBreached = true;
    if (c.status === 'RUNNING') hasRunning = true;
    if (c.status === 'PAUSED') hasPaused = true;
    if (c.status !== 'MET') hasMet = false;
  }
  if (hasBreached) return 'breached';
  if (hasRunning) {
    // At risk = any RUNNING clock within 25% of its due time (negative = overdue too)
    for (const c of clocks) {
      if (c.status === 'RUNNING' && c.percentRemaining !== null && c.percentRemaining <= 25) {
        return 'at_risk';
      }
    }
    return 'on_track';
  }
  if (hasPaused) return 'paused';
  if (hasMet) return 'met';
  return 'none';
}

// ---- Helper: format minutes as a compact human label ----

export function formatMins(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return '—';
  const abs = Math.abs(mins);
  if (abs < 60) return `${Math.round(mins)}m`;
  if (abs < 1440) {
    const h = Math.floor(abs / 60);
    const m = Math.round(abs % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(abs / 1440);
  const h = Math.round((abs % 1440) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

// ---- Roles that can act on tickets (helper for UI gating) ----

export const TICKET_AGENT_ROLES: Role[] = ['SCM_WORKER', 'CM_LEADER'];
