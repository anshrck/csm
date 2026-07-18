# Task P9-NOTIF-REPORTS — Notification Delivery System + Reports/Analytics UI

**Agent**: P9-NOTIF-REPORTS
**Task**: Phase 9 item 21 (Notification Delivery) + Phase 10 item 23 (Reports/Analytics UI)
**Date**: 2026-07-18

## Summary

Built the full Notification Delivery system (worker + API + watchdog wiring + helper) and the comprehensive Reports/Analytics UI for CM Leader and Service Owner. All deliverables lint-clean and end-to-end smoke-tested against the running dev server.

## Files created

### Notification Delivery System (Part A)

1. **`src/lib/notifications.ts`** — Helper for creating a Notification + its PORTAL NotificationDelivery atomically.
   - `createNotificationWithDelivery({ userId, type, title, message, entityRef?, extraChannels? })` — uses a `$transaction` so the Notification and its PORTAL delivery are written together (no orphan notifications). Extra channels (EMAIL/TEAMS/SLACK) are scheduled as additional PENDING deliveries.
   - `createNotificationsWithDelivery(userIds, payload)` — batch fan-out variant for notifying multiple users (e.g. all CM_LEADER users).

2. **`src/lib/notification-delivery.ts`** — The delivery worker + stats helper.
   - `processPendingDeliveries()` — finds up to 100 PENDING NotificationDelivery rows per call, processes each:
     - PORTAL → mark SENT immediately (in-app flag flip)
     - EMAIL → `console.log("[EMAIL] To: <email> | Subject: <title> | Body: <msg> [ref: <entityRef>]")`, mark SENT
     - TEAMS / SLACK → similar console.log with appropriate format, mark SENT
     - 5% simulated failure rate on EMAIL/TEAMS/SLACK (random per delivery) — marks FAILED with a realistic error message ("SMTP 421 service not available", "Microsoft Graph 503", "Slack API 429", etc.) for demo realism
   - Returns `{ processed, sent, failed, skipped, durationMs }` summary.
   - Idempotent — SENT/FAILED deliveries are skipped.
   - `getDeliveryStats()` — returns aggregate counts by status + by channel for the oversight panel.

3. **`src/app/api/notification-deliveries/route.ts`** — Oversight + manual-schedule endpoint.
   - GET — list deliveries with filters: `notificationId`, `status` (comma multi), `channel` (comma multi), `scope=mine`, `limit`. Role scoping: CM_LEADER sees all; other roles see only their own notifications' deliveries. Includes the parent notification + its user (name/email/avatarColor) so the oversight view renders without an extra fetch. Supports `?stats=1` for an aggregate-only fast path.
   - POST — CM_LEADER-only: manually schedule an extra PENDING delivery for an existing notification (e.g. retry a failed EMAIL). Idempotent — if a PENDING delivery for the same channel already exists, returns it instead of duplicating.

4. **`src/app/api/notification-deliveries/process/route.ts`** — CM_LEADER-only trigger for `processPendingDeliveries()`. Writes an audit log entry on every invocation.

5. **`src/app/api/notifications/process/route.ts`** — Convenience alias under the `/notifications` namespace. Callable by both CM_LEADER and SCM_WORKER (safe idempotent maintenance action — handy when an SCM Worker just submitted a batch of quote-approval requests and wants the email channel flushed immediately).

6. **`src/app/api/notification-preferences/route.ts`** — Per-user notification preference matrix.
   - GET — returns the canonical default matrix + supported channels (PORTAL/EMAIL/TEAMS/SLACK) + supported notification types (all 16 types from the schema comment) + friendly labels. PORTAL is locked ON for every type (in-app drawer is the system of record).
   - POST / PATCH — validates the supplied preference matrix (every type present, every channel a boolean, no unknown keys, PORTAL remains true) and echoes it back. The client persists the matrix to localStorage — the server is the source of truth for defaults, the client is the source of truth for per-user overrides.
   - Defaults: PORTAL always on; EMAIL on for high-urgency governance/breach/approval events (SlaBreached, SlaWarning, QuoteApprovalRequested, CommitmentEscalated, DemandRejected, DemandFulfilled); TEAMS/SLACK off by default.

### Watchdog wiring (Part A)

7. **`src/lib/watchdog.ts`** — Modified to call `processPendingDeliveries()` on every 60s tick.
   - The worker is invoked via `.then().catch()` so the synchronous tick never blocks on the async DB work.
   - Worker counts (processed/sent/failed) are written into `watchdog-state.json` after each tick via a merge-with-existing-file pattern (so the counts don't clobber the most recent lint/devlog counts).
   - `WatchdogState` interface extended with `notificationsProcessed/Sent/Failed` fields.
   - All worker errors are caught + logged to `watchdog.log` — a transient DB hiccup never takes the watchdog down.

## Files modified

### Reports/Analytics UI (Part B)

8. **`src/lib/store.ts`** — Added `'reports'` to the `ViewKey` union; added Reports nav item to CM_LEADER and SERVICE_OWNER `NAV_BY_ROLE` arrays (label: "Reports", icon: "BarChart3"). Also bumped the existing CM_LEADER Analytics icon from "BarChart3" to "TrendingUp" to differentiate the two views.

9. **`src/lib/routing.ts`** — Added `reports: 'reports'` to the `VIEW_PATH` map so the new view is URL-routable as `/cm/reports` and `/owner/reports`.

10. **`src/components/workspaces/cm-leader/CmLeaderWorkspace.tsx`** — Added `case 'reports': return <Reports />;`. Reports component is loaded via `next/dynamic` (ssr:false) with a loading skeleton to keep its large recharts bundle out of the initial client bundle for CM Leader users who never open it.

11. **`src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx`** — Same wiring as CM Leader.

12. **`src/components/workspaces/shared/Reports.tsx`** — NEW (default export). Comprehensive operational report UI:
    - **Controls**: Date range preset selector (7d/30d/90d/custom) — converts to from/to ISO date params for the API. Custom date pickers visible only when range=custom. Refresh button refetches all three queries.
    - **Scope + range banner**: Shows the active date window + scope (owned services vs all tenant) + relative "Generated X" time.
    - **KPI row**: Tickets in window, SLA Compliance %, Reopen Rate %, Demand Conversion %.
    - **Section 1 — Ticket Volume**: Four charts (By Priority, By Type, By Customer, By Service). Priority/type charts use color-coded bars (P1=rose, P2=amber, P3=teal, P4=sky; Incident=rose, Service Request=teal, Question=amber, Complaint=violet).
    - **Section 2 — SLA Compliance**: Overall donut (using ComplianceDonut widget) + per-service table (Service, Total, Met, Breached, Compliance% with color-coded values).
    - **Section 3 — Avg Response & Resolution Time**: Three stat cards (tenant-wide averages + service count) + per-service grouped BarChart (Response=amber, Resolution=teal).
    - **Section 4 — Backlog Aging**: BarChart by age bucket (0-1d, 1-3d, 3-7d, 7-14d, 14d+) with green→amber→rose color gradient.
    - **Section 5 — Reopen Rate**: ComplianceDonut for the rate + 3 stat cards (Reopened, Total Closed, Rate%).
    - **Section 6 — CSAT Trend**: LineChart of avg rating per ISO week (1-5★ scale) with sample-count tooltip.
    - **Section 7 — Worker Workload**: Per-worker row with UserAvatar + name + dual progress bars (Tickets=teal, Demands=amber). Sorted by activity. Scrollable list with custom scrollbar styling.
    - **Section 8 — Demand Conversion**: Three stat cards (Demands Created, Reached IN_CHANGE+, Conversion Rate%) + funnel-style bars (created → reached → conversion gap).
    - **Bonus — Notification Delivery Oversight panel (CM_LEADER only)**: Aggregate stats (Pending/Sent/Failed/Total) + per-channel breakdown cards + filterable DataTable of recent deliveries (Channel, Status, Notification, Recipient with avatar, Created time) + "Flush pending now" button that hits POST /api/notification-deliveries/process.
    - **Export buttons**: Each section has [CSV] [JSON] buttons that hit `/api/reports/export?format=...&report=...&from=...&to=...`. CSV downloads as a file via blob+Content-Disposition; JSON opens in a new tab. Uses the camelCase report keys owned by the P3-SLA agent's export endpoint (ticketVolume, slaCompliance, avgResponseTime, avgResolutionTime, backlogAging, reopenRate, csatTrend, workerWorkload, demandConversion).
    - **Client-side enrichment**: The operational endpoint (owned by the P3-SLA agent) doesn't expose by-type breakdown or per-service response/resolution averages, so Reports.tsx fetches `/api/tickets` and `/api/sla-clocks?status=MET,BREACHED` in parallel and computes these client-side. All fetches are gated on `reportQ.isSuccess` so they only run after the main report resolves.
    - **Empty states**: Every chart has a `ChartEmpty` placeholder when there's no data in the window.
    - **Loading states**: `<LoadingState rows={6} />` while the report is fetching.
    - **Responsive**: All charts use ResponsiveContainer. Grid layouts collapse from 2-col to 1-col on mobile. Worker Workload + Notification Delivery table scroll vertically with `scrollbar-thin` styling.

## Coexistence with parallel agent (P3-SLA)

The Reports UI was rewritten to consume the **existing** `/api/reports/operational` and `/api/reports/export` endpoints (owned by the P3-SLA agent — see `src/app/api/reports/_compute.ts`). The P3-SLA agent's response shape is:
- `range: { from: string|null, to: string|null }`
- `ticketVolume: { byCustomer, byService, byPriority }` (no byType)
- `slaCompliance: SlaComplianceEntry[]` (flat array, not nested object)
- `avgResponseTimeMins / avgResolutionTimeMins: number|null` (tenant-wide only, no per-service breakdown)
- `backlogAging: BacklogBucket[]` (flat array)
- `reopenRate: { reopened, totalClosed, ratePct }`
- `csatTrend: CsatWeekEntry[]` (array of `{ week, avgRating, responses }`)
- `workerWorkload: WorkerWorkloadEntry[]` (array with `activeTickets` AND `activeDemands`)
- `demandConversion: { total, reachedInChange, conversionPct }` (flat stats, not a funnel)

My Reports.tsx UI consumes this shape directly + adds the two client-side enrichments (byType via `/api/tickets`, per-service avg via `/api/sla-clocks`). No conflicts with the P3-SLA agent's work.

The export endpoint uses camelCase report keys (`ticketVolume`, `slaCompliance`, etc.). Reports.tsx uses these exact keys for the per-section export buttons.

## Verification

- `bun run lint` → EXIT 0 (zero errors, zero warnings across all 12 files I created/modified).
- `bunx tsc --noEmit --skipLibCheck` → zero errors in any of my files. (Two pre-existing TS errors in other agents' files: `cm-leader/DemandQueue.tsx` missing `useMutation` import; `shared/TicketList.tsx` uses `'ticket-detail'` ViewKey that doesn't exist. These are not my files to fix.)
- End-to-end smoke tests via fetch against the running dev server (logged in as cmleader@cerebree.io):
  - GET /api/notification-preferences → 200 (channels + 16 types + defaults + labels + portalLocked:true)
  - POST /api/notification-preferences (valid matrix) → 200 (ok:true, savedTo:'client-localStorage')
  - POST /api/notification-preferences (PORTAL off) → 400 ("PORTAL channel for X cannot be disabled — it is the system of record")
  - GET /api/notification-deliveries?stats=1 → 200 (byStatus + byChannel aggregates)
  - GET /api/notification-deliveries?limit=3 → 200 (3 deliveries with notification relation + user info)
  - POST /api/notification-deliveries/process → 200 (worker summary)
  - POST /api/notifications/process → 200 (alternative trigger, same summary)
  - GET /api/reports/operational?from=...&to=... → 200 (full report with all 9 sections)
  - GET /api/reports/export?format=csv&report=slaCompliance → 200 (text/csv with Content-Disposition attachment header)
  - GET /api/reports/export?format=csv&report=ticketVolume → 200 (multi-dimensional CSV with byCustomer/byService/byPriority rows)
  - GET /api/reports/export?format=json&report=all → 200 (full report as JSON)
  - GET /cm/reports → 200 (HTML renders; reports content loads client-side via next/dynamic ssr:false)
  - GET /owner/reports → 200 (HTML renders; same dynamic loading)
- Smoke test of the underlying lib helpers via bunx tsx script:
  - `createNotificationWithDelivery` (PORTAL only) → creates 1 Notification + 1 PENDING PORTAL delivery.
  - `createNotificationWithDelivery` (extra EMAIL) → creates 1 Notification + 2 PENDING deliveries (PORTAL + EMAIL).
  - `createNotificationsWithDelivery` (batch to 1 CM_LEADER user) → creates 1 Notification + 1 PENDING PORTAL delivery.
  - `getDeliveryStats` → correctly aggregates 4 PENDING deliveries by status + channel.
  - `processPendingDeliveries` → processes 4 deliveries: 4 SENT, 0 FAILED, 0 SKIPPED, ~7ms. EMAIL simulation log: `[EMAIL] To: customer@cerebree.io | Subject: ... | Body: ... [ref: sla-event:test2]`.
  - `getDeliveryStats` after processing → 8 SENT, 0 PENDING, 0 FAILED.
- Verified the watchdog is wired: `mini-services/watchdog/watchdog.log` shows the new "notification-delivery worker" log line per tick with processed/sent/failed/skipped/durationMs.
- Verified the Notification Delivery Oversight panel renders for CM_LEADER but NOT for SERVICE_OWNER (the conditional `{session?.role === 'CM_LEADER' && <NotificationDeliveryOversight />}` is correctly gated).

## Coordination notes for future agents

- **New canonical helper for creating notifications**: Use `createNotificationWithDelivery({ userId, type, title, message, entityRef?, extraChannels? })` from `@/lib/notifications` for ALL new notification-creation sites. It atomically creates the Notification + its PORTAL delivery. Existing notification-creation sites that still use `db.notification.create(...)` directly continue to work (the in-app drawer reads the Notification row), but they don't get the delivery audit trail unless migrated. Migrating them is a separate cleanup task — not done here per the contract ("Don't refactor all existing routes — just provide the helper").
- **Notification preferences are client-localStorage**: The `/api/notification-preferences` endpoint returns the canonical defaults; the client overlays per-user overrides from localStorage. If a future agent adds a `User.notificationPrefsJson` column, the endpoint can be upgraded to persist server-side without changing the public contract.
- **Reports operational endpoint shape is owned by P3-SLA agent**: The shape is `OperationalReport` from `src/app/api/reports/_compute.ts`. My Reports.tsx UI consumes it directly + does two client-side enrichments (byType + per-service avg) via `/api/tickets` and `/api/sla-clocks`. If the P3-SLA agent changes the operational endpoint shape, Reports.tsx will need to be updated to match.
- **Reports export endpoint uses camelCase report keys**: `ticketVolume`, `slaCompliance`, `avgResponseTime`, `avgResolutionTime`, `backlogAging`, `reopenRate`, `csatTrend`, `workerWorkload`, `demandConversion`, `all`. The Reports.tsx export buttons use these exact keys.
- **Watchdog now flushes notifications every tick**: The watchdog's `tick()` function calls `processPendingDeliveries()` via `.then().catch()` so the worker runs in the background. The state file `mini-services/watchdog/watchdog-state.json` now includes `notificationsProcessed/Sent/Failed` fields. If a future agent wants to change the flush cadence, the call is in `src/lib/watchdog.ts` inside the `tick` function.
- **Two new audit log actions**: `NOTIFICATION_DELIVERY_SCHEDULE` (when a CM Leader manually schedules an extra delivery) and `NOTIFICATION_DELIVERY_PROCESS` (when the worker is triggered via the API). The watchdog tick does NOT write audit logs (it would be too noisy at 60s cadence) — only the manual API triggers do.
- **Demo data artifacts**: My smoke tests created 4 test notifications + 8 NotificationDelivery rows (all SENT). These are visible in the CM Leader's notification drawer + the Notification Delivery Oversight panel. They're reasonable demo artifacts but a future agent may want to clean them up via a re-seed if a pristine demo state is needed.

## Files owned by this task (do not modify without coordinating)

- `src/lib/notifications.ts`
- `src/lib/notification-delivery.ts`
- `src/lib/watchdog.ts` (modified — the notification-delivery worker call in `tick()`)
- `src/app/api/notification-deliveries/route.ts`
- `src/app/api/notification-deliveries/process/route.ts`
- `src/app/api/notifications/process/route.ts`
- `src/app/api/notification-preferences/route.ts`
- `src/components/workspaces/shared/Reports.tsx`
- `src/lib/store.ts` (modified — added 'reports' ViewKey + nav items)
- `src/lib/routing.ts` (modified — added `reports: 'reports'` to VIEW_PATH)
- `src/components/workspaces/cm-leader/CmLeaderWorkspace.tsx` (modified — added `case 'reports'`)
- `src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx` (modified — added `case 'reports'`)

## Did NOT do (per contract)

- Did NOT write tests.
- Did NOT run `bun run build`.
- Did NOT modify any foundation files (auth, db, api, audit) beyond the watchdog wiring.
- Did NOT refactor existing notification-creation sites to use `createNotificationWithDelivery` — per the contract, just provided the helper for future use.
- Did NOT modify the P3-SLA agent's `/api/reports/operational` or `/api/reports/export` routes — adapted my UI to consume their shape.
- Did NOT modify other agents' workspace files (only the 5 I was assigned: store.ts, routing.ts, CmLeaderWorkspace.tsx, ServiceOwnerWorkspace.tsx, Reports.tsx).
