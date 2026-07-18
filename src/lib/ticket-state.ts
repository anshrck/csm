// Enterprise Workflow Review — Ticket state machine.
// Defines allowed transitions, required fields, and validation rules.

export type TicketStatus =
  | 'NEW'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELED';

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

/** Allowed transitions: from status -> set of valid next statuses. */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['TRIAGED', 'CANCELED'],
  TRIAGED: ['ASSIGNED', 'CANCELED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'RESOLVED', 'CANCELED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'CANCELED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'], // IN_PROGRESS = reopen before close
  CLOSED: ['IN_PROGRESS'], // reopen, permission restricted
  CANCELED: [],
};

/** Check if a transition is valid. */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  const allowed = TICKET_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** Get the list of valid next statuses for a given current status. */
export function getNextStatuses(current: TicketStatus): TicketStatus[] {
  return TICKET_TRANSITIONS[current] ?? [];
}

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a transition with required fields. */
export function validateTransition(
  from: TicketStatus,
  to: TicketStatus,
  body: Record<string, unknown>,
  role: string,
): TransitionValidationResult {
  if (!isValidTransition(from, to)) {
    return { valid: false, error: `Invalid transition: ${from} -> ${to}. Allowed: ${(TICKET_TRANSITIONS[from] ?? []).join(', ') || 'none (terminal)'}` };
  }

  // Enforce required fields per transition
  switch (to) {
    case 'ASSIGNED':
      if (!body.assignedUserId && !body.assignmentGroupId) {
        return { valid: false, error: 'Assign requires assignedUserId or assignmentGroupId.' };
      }
      break;
    case 'RESOLVED':
      if (!body.resolutionCode) {
        return { valid: false, error: 'Resolve requires resolutionCode.' };
      }
      if (!body.resolutionNotes || String(body.resolutionNotes).trim().length < 5) {
        return { valid: false, error: 'Resolve requires resolutionNotes (at least 5 characters).' };
      }
      break;
    case 'CLOSED':
      // Close requires RESOLVED unless CM_LEADER override
      if (from !== 'RESOLVED' && role !== 'CM_LEADER') {
        return { valid: false, error: 'Close requires ticket to be RESOLVED first (CM Leader can override).' };
      }
      break;
    case 'IN_PROGRESS':
      // Reopen from CLOSED requires a reason
      if (from === 'CLOSED' && !body.reopenReason) {
        return { valid: false, error: 'Reopen from CLOSED requires reopenReason.' };
      }
      break;
    case 'WAITING_CUSTOMER':
      // Waiting customer requires a customer-visible comment
      if (!body.comment || String(body.comment).trim().length < 3) {
        return { valid: false, error: 'Waiting on customer requires a customer-visible comment.' };
      }
      break;
  }

  return { valid: true };
}

/** Map action route names to target statuses. */
export const ACTION_TO_STATUS: Record<string, TicketStatus> = {
  triage: 'TRIAGED',
  assign: 'ASSIGNED',
  progress: 'IN_PROGRESS',
  waiting: 'WAITING_CUSTOMER',
  resume: 'IN_PROGRESS',
  resolve: 'RESOLVED',
  close: 'CLOSED',
  reopen: 'IN_PROGRESS',
  cancel: 'CANCELED',
};
