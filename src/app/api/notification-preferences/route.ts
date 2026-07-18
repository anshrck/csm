import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Notification preferences API (Phase 9 item 21)
 *
 * Per the task contract, preferences are NOT persisted server-side in a
 * separate model (the schema already had NotificationDelivery added but no
 * NotificationPreference model). Instead, the server returns the canonical
 * default preference matrix and the client persists per-user overrides in
 * localStorage.
 *
 * This endpoint:
 *   - GET    → returns the default preference matrix + the supported channel
 *              list + the supported notification-type list. The client merges
 *              its localStorage overrides on top of these defaults before
 *              rendering.
 *   - POST   → echoes back the supplied preferences (the client is the source
 *              of truth). Useful as a sanity-check endpoint that validates the
 *              shape of the body before the client writes it to localStorage.
 *   - PATCH  → same as POST — included for callers that prefer PATCH semantics.
 *
 * Future enhancement: when a User.notificationPrefsJson column is added, these
 * handlers can be upgraded to persist the preferences server-side without
 * changing the public contract.
 */

export type NotificationChannel = 'EMAIL' | 'TEAMS' | 'SLACK' | 'PORTAL';

export const SUPPORTED_CHANNELS: NotificationChannel[] = ['PORTAL', 'EMAIL', 'TEAMS', 'SLACK'];

// Every notification type the system emits (mirrors the schema comment on
// Notification.type). Used to seed the preference matrix.
export const SUPPORTED_TYPES = [
  'DemandCreated',
  'DemandQuoted',
  'DemandAccepted',
  'DemandRejected',
  'DemandFulfilled',
  'SlaWarning',
  'SlaBreached',
  'ChangeClosed',
  'QuoteApprovalRequested',
  'SlaReportApproved',
  'SlaReportReturned',
  'SlaReportPendingReview',
  'CommitmentApproved',
  'CommitmentEscalated',
  'BreachCommunicated',
  'BreachResponded',
] as const;

export type NotificationType = (typeof SUPPORTED_TYPES)[number];

export type PreferenceMatrix = Record<NotificationType, Record<NotificationChannel, boolean>>;

/** Friendly labels for the UI — the Reports / preferences table reads these. */
export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  PORTAL: 'In-app portal',
  EMAIL: 'Email',
  TEAMS: 'Microsoft Teams',
  SLACK: 'Slack',
};

export const TYPE_LABELS: Record<NotificationType, string> = {
  DemandCreated: 'New demand submitted',
  DemandQuoted: 'Quote issued to customer',
  DemandAccepted: 'Customer accepted quote',
  DemandRejected: 'Demand rejected',
  DemandFulfilled: 'Demand fulfilled',
  SlaWarning: 'SLA warning',
  SlaBreached: 'SLA breached',
  ChangeClosed: 'Change closed',
  QuoteApprovalRequested: 'Quote approval requested',
  SlaReportApproved: 'SLA report approved',
  SlaReportReturned: 'SLA report returned for revision',
  SlaReportPendingReview: 'SLA report pending review',
  CommitmentApproved: 'Commitment approved',
  CommitmentEscalated: 'Commitment escalated',
  BreachCommunicated: 'Breach communicated to customer',
  BreachResponded: 'Breach response recorded',
};

/**
 * Default preference matrix.
 *
 * Design:
 *   - PORTAL is always ON for every type (the in-app drawer is the system of
 *     record — turning it off would make the notification invisible to the
 *     user). The UI shows PORTAL as a locked-on checkbox.
 *   - EMAIL is ON by default for the high-urgency governance / breach /
 *     approval events that an operator would not want to miss.
 *   - TEAMS and SLACK are OFF by default — opt-in channels for users who
 *     want them.
 */
export function defaultPreferences(): PreferenceMatrix {
  const matrix = {} as PreferenceMatrix;
  const emailOn: NotificationType[] = [
    'SlaBreached',
    'SlaWarning',
    'QuoteApprovalRequested',
    'CommitmentEscalated',
    'DemandRejected',
    'DemandFulfilled',
  ];
  for (const t of SUPPORTED_TYPES) {
    matrix[t] = {
      PORTAL: true,
      EMAIL: emailOn.includes(t),
      TEAMS: false,
      SLACK: false,
    };
  }
  return matrix;
}

/** GET — return defaults + supported channels/types for the client. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    defaults: defaultPreferences(),
    channels: SUPPORTED_CHANNELS,
    types: SUPPORTED_TYPES,
    channelLabels: CHANNEL_LABELS,
    typeLabels: TYPE_LABELS,
    portalLocked: true, // PORTAL is always on — UI must render it as disabled/checked
    persistence: 'client-localStorage',
    note:
      'Preferences are stored client-side (localStorage). The server returns the canonical default matrix; the client overlays user overrides on top.',
  });
}

/**
 * POST / PATCH — validate + echo the supplied preference matrix.
 *
 * The client sends its full matrix; the server validates the shape (every
 * supported type present, every supported channel present, no unknown keys)
 * and returns it back. The client then writes the echoed body to localStorage.
 *
 * If the body fails validation, returns 400 with a descriptive error.
 */
async function upsert(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a preference matrix object' }, { status: 400 });
  }

  const matrix = body as Record<string, Record<string, unknown>>;

  // Validate shape — every supported type must be present with every
  // supported channel set to a boolean. PORTAL must be true (locked on).
  for (const t of SUPPORTED_TYPES) {
    const row = matrix[t];
    if (!row || typeof row !== 'object') {
      return NextResponse.json(
        { error: `Missing or invalid row for notification type "${t}"` },
        { status: 400 },
      );
    }
    for (const ch of SUPPORTED_CHANNELS) {
      if (typeof row[ch] !== 'boolean') {
        return NextResponse.json(
          { error: `Row "${t}" is missing a boolean value for channel "${ch}"` },
          { status: 400 },
        );
      }
    }
    // Reject unknown channels on the row.
    for (const k of Object.keys(row)) {
      if (!SUPPORTED_CHANNELS.includes(k as NotificationChannel)) {
        return NextResponse.json(
          { error: `Row "${t}" has unknown channel "${k}"` },
          { status: 400 },
        );
      }
    }
    // Enforce PORTAL-locked rule.
    if (row['PORTAL'] !== true) {
      return NextResponse.json(
        { error: `PORTAL channel for "${t}" cannot be disabled — it is the system of record` },
        { status: 400 },
      );
    }
  }
  // Reject unknown notification types.
  for (const k of Object.keys(matrix)) {
    if (!SUPPORTED_TYPES.includes(k as NotificationType)) {
      return NextResponse.json(
        { error: `Unknown notification type "${k}"` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    preferences: matrix,
    savedTo: 'client-localStorage',
    note: 'Server validation passed. Persist these preferences to localStorage on the client.',
  });
}

export async function POST(req: NextRequest) {
  return upsert(req);
}

export async function PATCH(req: NextRequest) {
  return upsert(req);
}
