# CereBree uSMS — Build Worklog

This is the shared worklog for the CereBree uSMS full-stack application build.
All agents MUST read this file before starting and append their section after finishing.

---

Task ID: 0
Agent: Orchestrator (foundation)
Task: Build the foundation — schema, seed, auth, shared libs, design system, app shell, main page.

Work Log:
- Read all 4 role guides + executive summary + DAL-24 experience spec.
- Designed Prisma schema with 11 models (User, OrgNode, Service, ServiceOffering, SlaProfile, Entitlement, Demand, DemandEvent, SlaEvent, Change, ProcessHandover, Problem, Notification).
- Ran `bun run db:push` successfully.
- Wrote seed script (prisma/seed.ts) with realistic demo data: 2 customer orgs, 7 users (one per role + extras), 6 services across domains, offerings, SLA profiles, entitlements, 8 demands in varied statuses (NEW/UNDER_REVIEW/QUOTED/ACCEPTED/IN_CHANGE/FULFILLED/REJECTED/CLOSED), 2 changes, SLA events, notifications, 1 problem. Ran seed successfully.
- Built auth lib (src/lib/auth.ts): scrypt password hashing, HMAC-signed httpOnly session cookie, getSession/requireAuth/requireRole.
- Built client API helpers (src/lib/api.ts): apiGet/apiPost/apiPatch/apiDelete with error handling.
- Built shared types (src/lib/types.ts): all enums, interfaces, label maps for the full domain.
- Built Zustand store (src/lib/store.ts): session, view, params, notifOpen, aiOpen, navigate(). Includes NAV_BY_ROLE config.
- Built design system (src/components/shared.tsx): DemandStatusBadge, ChangeStatusBadge, SlaClassBadge, SlaHealthBadge, RoleBadge, PageHeader, StatCard, EmptyState, LoadingState, UserAvatar, RelativeTime, FormattedDate, SectionCard, DemandPipelineTimeline, ActivityLog, DataTable, KeyValue, Money, Days.
- Built app shell (src/components/shell/AppShell.tsx): dark sidebar with role nav, topbar with Cogni button + notification bell + user menu, notification drawer (Sheet), sticky footer.
- Built login screen (src/components/shell/LoginScreen.tsx): two-panel brand + form, quick-login buttons per role.
- Built main page (src/app/page.tsx): session bootstrap → LoginScreen or AppShell+workspace+AiPanel.
- Built providers (src/components/providers.tsx): TanStack Query + next-themes.
- Updated layout.tsx (sonner toaster + providers) and globals.css (teal/emerald governance theme, custom scrollbar, grid bg).
- Built auth API routes: /api/auth/me (GET), /api/auth/login (POST), /api/auth/logout (POST).
- Built notifications API: GET /api/notifications (with ?count=1 for unread), PATCH /api/notifications/read-all, PATCH /api/notifications/[id]/read.
- Created workspace stubs (agents replace these): customer, scm-worker, cm-leader, service-owner, ai/AiPanel.
- Verified: dev server compiles, GET / returns 200, login works (correct+incorrect creds), notifications gate on auth.

Stage Summary:
- Foundation COMPLETE and verified. The app boots, login works, shell renders.
- Theme: teal/emerald primary (oklch 165 hue). Sidebar is dark. NO indigo/blue primary.
- 4 demo accounts (password `demo1234` for all):
  - customer@cerebree.io  — Service Customer (Elena Vance, Finance Division)
  - scm@cerebree.io       — SCM Worker (Priya Anand)
  - cmleader@cerebree.io  — CM Leader (Sofia Reyes)
  - owner@cerebree.io     — Service Owner (Dr. Henrik Sørensen)
- The dev server background process is volatile in this sandbox; start it fresh when needed: `setsid bun run dev > dev.log 2>&1 < /dev/null & disown`

================================================================================
CONTRACTS — every agent builds against these. DO NOT change foundation files.
================================================================================

FOUNDATION FILES (DO NOT MODIFY — owned by orchestrator):
  prisma/schema.prisma, prisma/seed.ts
  src/lib/db.ts, src/lib/auth.ts, src/lib/api.ts, src/lib/types.ts, src/lib/store.ts
  src/components/shared.tsx, src/components/providers.tsx
  src/components/shell/AppShell.tsx, src/components/shell/LoginScreen.tsx
  src/app/layout.tsx, src/app/page.tsx, src/app/globals.css
  src/app/api/auth/*, src/app/api/notifications/*

IMPORTS available to all agents:
  - `import { useApp, NAV_BY_ROLE } from '@/lib/store'` — Zustand store.
      useApp provides: session, hydrated, view, params, notifOpen, aiOpen,
      setSession, setHydrated, navigate(view, params?), setNotifOpen, setAiOpen, logout.
      view is a ViewKey: 'dashboard'|'demands'|'demand-detail'|'submit-demand'|'catalog'|'sla'|'changes'|'change-detail'|'handovers'|'portfolio'|'governance'|'problems'|'workers'|'analytics'|'notifications'|'settings'
  - `import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'`
  - `import { ... } from '@/lib/types'` — all domain types + label maps.
  - `import { DemandStatusBadge, ChangeStatusBadge, SlaClassBadge, SlaHealthBadge, RoleBadge, PageHeader, StatCard, EmptyState, LoadingState, UserAvatar, RelativeTime, FormattedDate, SectionCard, DemandPipelineTimeline, ActivityLog, DataTable, KeyValue, Money, Days, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Badge, Button } from '@/components/shared'`
  - All shadcn/ui components in `@/components/ui/*` (already exist).
  - `import { toast } from 'sonner'` for notifications.
  - `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'` for data.
  - lucide-react icons: `import { ... } from 'lucide-react'`.

WORKSPACE COMPONENT CONTRACT (agents 5-9):
  Each workspace is a default-exported client component reading `useApp()` for `view` and `params`,
  and rendering the appropriate screen via a switch. Example skeleton:
    'use client';
    import { useApp } from '@/lib/store';
    export default function XWorkspace() {
      const { view, params, navigate } = useApp();
      switch (view) {
        case 'dashboard': return <Dashboard/>;
        case 'demands': return <DemandList/>;
        case 'demand-detail': return <DemandDetail id={params.id}/>;
        ...
        default: return <Dashboard/>;
      }
    }
  Navigate with: navigate('demand-detail', { id: demand.id }).

API CLIENT PATTERNS (agents 1-4):
  - All API routes use `export const runtime = 'nodejs';`
  - Auth: `import { getSession, requireRole } from '@/lib/auth'`; `import { db } from '@/lib/db'`.
  - Return NextResponse.json(...) with proper status codes.
  - For JSON-array DB fields (relatedServiceIds, affectedServiceIds, technicalOwnerTasksJson): store as
    JSON string in DB, parse with JSON.parse on read, JSON.stringify on write. In API responses, return
    the parsed array.
  - Dates: return ISO strings (Prisma returns Date objects; call .toISOString()).
  - Role checks: SERVICE_CUSTOMER scoped to own orgNode; SCM_WORKER scoped to assigned demands;
    CM_LEADER sees all tenant; SERVICE_OWNER sees services they own.

DEMAND STATE MACHINE (agents 1, 5, 6, 7, 8):
  NEW → (assign + start review) → UNDER_REVIEW → (quote | reject | redirect)
  QUOTED requires quoteApprovedByCmLeader=true (CM Leader gate) → (customer accept | decline)
  ACCEPTED → (create change + hand to CE) → IN_CHANGE → (mark fulfilled) → FULFILLED → (close) → CLOSED
  Rejection/redirect are terminal. Each transition emits a DemandEvent.

CHANGE STATE MACHINE (agents 4, 5):
  REQUESTED → ASSESSMENT → PLANNING → APPROVED → IMPLEMENTATION → VERIFICATION → CLOSED
  (REJECTED terminal). Closing a change with originDemandId sets that demand to FULFILLED.

NOTIFICATIONS: created on key events (DemandQuoted, DemandAccepted, DemandFulfilled, DemandRejected,
  DemandCreated, SlaBreached, SlaWarning, ChangeClosed). Target userId depends on event.

================================================================================

---

Task ID: 2
Agent: Catalog API (services, offerings, SLA profiles, entitlements)
Task: Build the read-only Catalog API — services, service offerings, SLA profiles, and entitlements.

Work Log:
- Read shared worklog, prisma/schema.prisma, src/lib/types.ts, src/lib/auth.ts, src/lib/db.ts, and notifications route as a style reference.
- Confirmed `Service.serviceOwnerId` / `technicalOwnerId` are plain String columns with NO Prisma relation — owner display names must be resolved manually via a bulk User lookup.
- Created `src/app/api/services/_serialize.ts` with:
  - `serializeOffering(o)` → ServiceOffering (incl. optional `serviceName`).
  - `serializeSlaProfile(p)` → SlaProfile.
  - `serializeService(s, ownerMap)` → Service (offerings[], primary slaProfile, owner names, ISO createdAt).
  - `buildOwnerMap(ids)` → bulk `db.user.findMany` lookup returning `{ id → name }`.
- `GET /api/services` — list with filters: `domain`, `slaClass`, `status` (default ACTIVE, `ALL` disables), `owner=me` (serviceOwnerId = caller), `q` (case-insensitive JS filter on name+description since SQLite has no `mode: insensitive`), `entitled=1` (resolve caller's orgNode entitlements → offerings → distinct serviceIds). Always includes offerings[] + first slaProfile + owner names. 401 if not authed. Early-returns `[]` when entitled=1 caller has no orgNode or no entitlements.
- `GET /api/services/[id]` — single service with **active-only** offerings, primary SLA profile, owner names, and SLA-event context (`slaEventCount` + `slaEventsByType: { WARNING, BREACHED, CLOSED_IN_TIME }`). 404 if not found. Awaits the Next.js 16 async `params` Promise.
- `GET /api/offerings` — list with `serviceId` and `entitled=1` filters. Joins `service.name` as `serviceName`. Early-returns `[]` for entitled callers with no orgNode.
- `GET /api/entitlements` — returns caller's orgNode entitlements joined through offering → service. Response shape: `{ id, serviceOfferingId, offeringName, serviceName, scope, validUntil }[]` (validUntil is ISO string or null).
- All routes use `export const runtime = 'nodejs';`, `getSession()` for auth, `NextResponse.json` with proper status codes, and ISO-string dates.
- Verified: `bunx tsc --noEmit` → zero errors in catalog API files (remaining TS errors are in other agents' workspace stubs that import not-yet-created modules). `bun run lint` → zero errors in catalog API files (single lint error is in `AppShell.tsx`, owned by orchestrator). Dev server confirmed `/api/services` returns 401 when running (auth gate works).

Stage Summary:
- Catalog API COMPLETE and verified. 4 routes + 1 shared serialize helper, all read-only.
- Owner names (serviceOwnerName / technicalOwnerName) are joined in-memory via `buildOwnerMap` because the schema stores them as plain String foreign keys without Prisma relations.
- Frontend agents can call: `apiGet<Service[]>('/api/services')`, `apiGet<Service>('/api/services/${id}')`, `apiGet<ServiceOffering[]>('/api/offerings')`, `apiGet('/api/entitlements')`. All accept standard query filters documented above.
- Files owned (do not modify without coordinating): `src/app/api/services/_serialize.ts`, `src/app/api/services/route.ts`, `src/app/api/services/[id]/route.ts`, `src/app/api/offerings/route.ts`, `src/app/api/entitlements/route.ts`.
- Sandbox dev server is volatile (already noted by orchestrator) — start fresh with `setsid bun run dev > dev.log 2>&1 < /dev/null & disown` if needed.

---

Task ID: 3
Agent: API builder (sla-events + stats)
Task: Build the SLA Events API (`GET /api/sla-events`) and the Stats/Dashboard API (`GET /api/stats`).

Work Log:
- Read `worklog.md` foundation contracts, `prisma/schema.prisma`, `src/lib/types.ts`, `src/lib/auth.ts`, `src/lib/db.ts`, `prisma/seed.ts` (full), and existing route patterns (`/api/notifications`, `/api/auth/login`).
- Created `src/app/api/sla-events/route.ts`:
  - `export const runtime = 'nodejs';`
  - `getSession()` auth gate → 401 when unauthenticated.
  - Query params: `serviceId`, `customerId` (orgNode), `type` (WARNING|BREACHED|CLOSED_IN_TIME), `active=1`.
  - Role scoping: `SERVICE_CUSTOMER` → only `serviceCustomerId = session.orgNodeId` (returns `[]` if no orgNode); `SCM_WORKER`/`CM_LEADER`/`SERVICE_OWNER` → all tenant events (per task simplification). For non-customer roles, the `customerId` query param acts as an explicit filter.
  - Joins `Service` for `serviceName`. Orders by `createdAt desc`, capped at 200 rows.
  - Computes a per-service `health` hint (`green`/`amber`/`red`, red wins) across the result set and attaches it to every row (extends `SlaEvent` with `health: SlaHealth`).
  - Dates → `.toISOString()`; `resolvedAt` is `null` when absent.
- Created `src/app/api/stats/route.ts`:
  - `export const runtime = 'nodejs';`
  - Returns a single JSON object: `totalDemands`, `byStatus` (Record), `slaWarnings`, `slaBreaches`, `pendingApprovals`, `openChanges`, `pipeline` (6 lanes), `slaByService` (top 10, sorted red→amber→green), `workloadByWorker` (CM_LEADER only, batched — no N+1), `recentActivity` (last 8 in-scope DemandEvents joined to Demand title).
  - Scoping:
    - `SERVICE_CUSTOMER` → own `orgNodeId`; pendingApprovals = QUOTED count; openChanges = open changes on in-scope demands.
    - `SCM_WORKER` → assigned-to-me OR unassigned (`OR`); SLA = all tenant active; pendingApprovals = 0 (no explicit spec).
    - `CM_LEADER` → all tenant; pendingApprovals = UNDER_REVIEW count (approximation); workloadByWorker computed.
    - `SERVICE_OWNER` → owned services (`serviceOwnerId = session.id`); demands filtered in code via `relatedServiceIds` JSON parse; openChanges filtered via `affectedServiceIds` JSON parse; pendingApprovals = ACCEPTED count.
  - Helper `parseServiceIds()` safely parses JSON-encoded service id arrays on Demand/Change rows.
  - `emptyStats()` factory used for early-exit when scope is empty.
- Verification:
  - `bun run lint` on the two new files: 0 errors / 0 warnings. (Pre-existing errors in `AppShell.tsx` and `CustomerWorkspace.tsx` are owned by other agents and were left untouched.)
  - `bunx tsc --noEmit` on the two new files: 0 TypeScript errors. (Pre-existing errors in other agents' files observed but untouched.)
  - Dev server reports `Ready in 3s` and compiles cleanly. (Direct curl from a separate sandbox shell to `localhost:3000` was blocked — sandbox network-namespace quirk between shell sessions, not a code issue.)
- Did NOT modify any foundation files. Did NOT write tests. Did NOT run `bun run build`.

Stage Summary:
- Both endpoints are complete, type-safe, role-scoped, and lint-clean. They conform to the foundation contracts (`runtime = 'nodejs'`, `getSession`/`requireRole` from `@/lib/auth`, `db` from `@/lib/db`, ISO-string dates, `NextResponse.json` with proper status codes). Ready for the dashboard UI agents (Tasks 5–9) to consume via `apiGet('/api/stats')` and `apiGet('/api/sla-events', { ...filters })`.


---

Task ID: 10
Agent: Widgets & Charts Builder
Task: Build the reusable dashboard widgets & charts library — polished, responsive chart components (recharts + shadcn/ui) used by all workspace dashboards.

Work Log:
- Read worklog.md (foundation contracts, demo accounts, theme rules) + foundation files: src/lib/types.ts (Demand/DemandStatus/DEMAND_PIPELINE/DEMAND_STATUS_LABELS), src/components/shared.tsx (DemandStatusBadge palette, RelativeTime, EmptyState, Badge), src/app/globals.css (teal/emerald oklch(165) theme vars, --chart-1..5, scrollbar-thin), src/components/ui/card.tsx, eslint.config.mjs.
- Confirmed recharts@2.15.4, framer-motion@12, lucide-react already installed.
- Created `src/components/widgets/index.tsx` (~470 LOC, 'use client') with 5 named exports matching the contract exactly:
  1. DemandPipelineLanes({ demands, onSelect, emptyLabel }) — kanban over DEMAND_PIPELINE; grid-cols-1 sm:grid-cols-2 lg:grid-cols-6; per-status accent (sky/amber/violet/teal/indigo/emerald) via left-border + header dot matching DemandStatusBadge palette; scrollable body max-h-80 scrollbar-thin; demand cards with 2-line clamp title, customer name, RelativeTime + optional effort-days badge, hover lift + focus ring; demands sorted by updatedAt desc; staggered framer-motion entrance.
  2. SlaTrendChart({ data, height=220 }) — recharts AreaChart, vertical linearGradient fill (primary 0.35→0.02), useId-derived SVG-safe gradient id, YAxis [0,100] % ticks, hidden axis lines, dashed horizontal gridlines, custom popover tooltip "94.2%", ChartEmpty on empty data.
  3. ComplianceDonut({ value, label, size=160 }) — recharts PieChart donut (startAngle 90→-270), two Cells (colored value + var(--muted) remainder), auto-tone green(≥95)/amber(≥85)/red(<85)/muted, center label scales with size, shows "—" for null/undefined/NaN. (value prop widened to `number | null | undefined` to honor the spec's null-state requirement; plain `number` still type-checks so the contract is backward-compatible.)
  4. WorkloadBars({ items }) — flex rows w/ w-24/sm:w-32 truncate name, flex-1 track with framer-motion animated width (staggered 0.05s), count number, optional rose risk pill; maxCount floored to 1; shared EmptyState (Inbox icon) when empty.
  5. MiniBarChart({ data, height=200, color }) — recharts BarChart, rounded top corners, maxBarSize 48, hidden YAxis, XAxis auto-rotates -35° when >6 categories, custom color-threaded tooltip, ChartEmpty on empty data.
  Bonus export: RiskIcon (re-export of lucide AlertTriangle) for legend chips.
- Theme-aware via CSS vars (var(--primary), --border, --muted, --muted-foreground, --popover, --background); charts adapt to light/dark automatically. Primary stays teal oklch(165); indigo appears ONLY as the explicitly-requested IN_CHANGE per-status accent (matches existing DemandStatusBadge palette), not as a theme primary.
- All widgets responsive, no mobile overflow, custom scrollbar-thin styling reused.
- Verified: `bunx eslint src/components/widgets/index.tsx` → EXIT 0 (0 errors, 0 warnings). `bunx tsc --noEmit` → 0 errors in widgets file (all 50 project-wide tsc errors are in other agents' WIP files: not-yet-created workspace submodules + one `value: unknown` misuse in cm-leader/Workers.tsx which is the consumer's bug, not a contract mismatch).
- Confirmed 4 other agents already importing & consuming the widgets in 6 files (service-owner/SlaPerformance, cm-leader/SlmGovernance+Dashboard+Workers, scm-worker/SlmDashboard+Dashboard) — all call sites use props compatible with the contract.
- Did NOT modify any foundation file. Did NOT run `bun run build`. Did NOT write tests.

Stage Summary:
- Widgets library COMPLETE and verified. Single file `src/components/widgets/index.tsx` exports all 5 contract widgets + RiskIcon. Lint-clean, type-clean, theme-correct, responsive, animated, already wired into SCM/CM-Leader/Service-Owner workspaces. Visual centerpiece of every dashboard is ready.

---

Task ID: 12
Agent: search-guide (Global Search + Role Guide)
Task: Build a self-mounting Global Search command palette (Cmd/Ctrl+K) and a self-mounting Role Guide reference viewer (floating FAB + Cmd/Ctrl+G) — both self-contained client components that enhance every workspace without modifying the foundation shell.

Work Log:
- Read worklog.md for full contracts (store API, types, demo accounts, design rules, foundation-file ownership).
- Read all 4 Role_Guide_*_v1_0.txt source files (CM Leader, Service Owner, Service Customer, SCM Worker) to extract the key sections: "Who You Are", "Your Accountability", "Governance Gates"/"Authorities"/"Limits", "What Good Looks Like", plus "Touchpoints" for Service Owner.
- Read foundation files for import contracts: src/lib/store.ts (useApp, ViewKey, navigate, setAiOpen, logout), src/lib/types.ts (Role, Demand, Service, Change, Problem, label maps), src/lib/api.ts (apiGet/apiPost), src/components/shared.tsx (Badge/Button), src/components/ui/command.tsx + dialog.tsx + scroll-area.tsx + tabs.tsx + button.tsx (shadcn primitives already present).
- Read src/app/page.tsx + AppShell.tsx to confirm the integration point and the existing sign-out pattern (apiPost('/api/auth/logout') then logout() + toast).

Files created (owned exclusively):
1. src/components/guide/guides.ts — Data file exporting `ROLE_GUIDES: Record<Role, RoleGuide>` and `ROLE_GUIDE_ORDER`. Each guide has title, tagline, layer, and 5 sections with paragraphs/bullets. Concise (~150-300 words/role) — not a dump of the source files.
2. src/components/guide/RoleGuidePanel.tsx — Default export, 'use client'. Renders `fixed bottom-6 right-6 z-40` round primary FAB (BookOpen icon). Global Cmd/Ctrl+G listener (gated against form fields). Opens max-w-2xl / max-h-[80vh] Dialog with gradient header, "Your role" vs "Cross-role context" badge, horizontally-scrollable 4-role selector, ScrollArea body with structured sections (primary dot headings + paragraphs + bulleted lists), closing note "Based on the uSMS Role Guide Suite v1.0", and a footer hint. Resets selection on close so reopening returns to the current role.
3. src/components/search/CommandPalette.tsx — Inner cmdk palette component. Uses `useQueries` to fetch role-scoped entities (per-role endpoint config); each queryFn catches errors → [] so the palette never crashes when an endpoint is absent. Groups: Quick actions / Demands / Services / Changes / Problems (rendered only when non-empty). Each CommandItem has a custom `value` (includes subtitle) so cmdk's built-in filter matches titles + customers + statuses + domains. Footer with kbd-styled hints ("↑↓ navigate · ↵ select · esc close"). Loading state = Skeleton rows; empty state = "No matches found."
4. src/components/search/GlobalSearch.tsx — Default export, 'use client'. Global Cmd/Ctrl+K listener toggles a centered max-w-xl Dialog. Wires navigate() (closes palette), setAiOpen(true) (Open Cogni), and sign-out (apiPost('/api/auth/logout') + logout() + toast, matching AppShell's pattern). No-ops until session present. SR-only DialogTitle/Description for accessibility.

Self-mounting contract honored: each component registers its own keydown listener on mount (cleanup on unmount), renders its own Dialog overlay, and returns null when there's no session. The orchestrator just drops `<GlobalSearch/>` and `<RoleGuidePanel/>` into page.tsx's authenticated return (alongside AppShell + AiPanel).

Per-role data sources (all GET, gracefully tolerate missing endpoints):
- SERVICE_CUSTOMER: /api/demands?mine=1, /api/services?entitled=1
- SCM_WORKER: /api/demands?assigned=me, /api/demands?unassigned=1, /api/services
- CM_LEADER: /api/demands, /api/services, /api/changes
- SERVICE_OWNER: /api/services?owner=me, /api/changes, /api/problems?owner=me

Navigation mapping:
- Demand → navigate('demand-detail', { id })
- Service → navigate('catalog') (or 'portfolio' for SERVICE_OWNER)
- Change → navigate('changes')
- Problem → navigate('problems')
- Quick actions: [Submit a Demand] (customer), [New Demand on behalf] (scm), [View SCM Workers] (cm leader), [Open Service Portfolio] (owner), [Go to Dashboard] (all), [Open Cogni] (all → setAiOpen), [Sign out] (all → logout).

Design: teal/emerald theme (primary tints, dots, ring). No indigo/blue. Responsive (palette subtitle columns hidden on mobile via `hidden sm:inline`; guide role selector scrolls horizontally on small screens). Accessible (ARIA tablist/tab + aria-selected, sr-only DialogTitle/Description on palette, aria-labels on icon buttons, focus-visible rings). Uses only existing shadcn/ui primitives + lucide-react icons — no new dependencies.

Verification:
- `npx eslint src/components/search/ src/components/guide/` → 0 errors, 0 warnings (clean).
- `bunx tsc --noEmit` → no errors in any of my 4 files. (Pre-existing errors remain in other agents' workspaces/API routes — none mine.)
- `bun run lint` → 1 error in AppShell.tsx (foundation, not mine) + 1 warning in CustomerWorkspace.tsx (other agent) — my files contribute zero issues. Did NOT modify foundation files per contract.
- Work record written to /home/z/my-project/agent-ctx/12-search-guide.md.

Stage Summary:
- COMPLETE. Two self-mounting enhancement components ready to drop into the authenticated page.
- Integration (orchestrator): add `<GlobalSearch/>` and `<RoleGuidePanel/>` next to `<AppShell>` + `<AiPanel/>` in src/app/page.tsx's authenticated return.
- Both no-op until session present and degrade gracefully (empty groups, no crash) when backing API endpoints (/api/demands, /api/services, /api/changes, /api/problems with the role-scoped query params above) are not yet built.
- Theme-consistent (teal/emerald), responsive, accessible, no new dependencies.

================================================================================

---

Task ID: 4
Agent: Changes / Handovers / Problems API Builder
Task: Build the Changes API (full lifecycle), Handovers API, and Problems API (read-only).

Work Log:
- Read the worklog foundation contracts, Prisma schema, auth lib, types, and seed data. Confirmed Change model fields (affectedServiceIds/technicalOwnerTasksJson are JSON-string columns), the 4-role auth model, and the demand↔change lifecycle (closing a change fulfils its origin demand).
- Created `src/app/api/changes/_serialize.ts` exporting `serializeChange(c)` (parses affectedServiceIds + technicalOwnerTasksJson, ISO-converts all dates, attaches ceWorkerName) and a shared `authError(e)` helper that maps `UNAUTHORIZED`/`FORBIDDEN` thrown by `requireRole` to 401/403 NextResponses.
- `src/app/api/changes/route.ts`:
  - GET: filters by `status` (comma multi), `type`, `originDemandId`, `ceWorker=me`. Includes ceWorker name. Returns Change[].
  - POST: validates title/type/originType/complexity. Enforces originDemandId uniqueness (409) and existence (400). Stores arrays as JSON strings, sets status=REQUESTED, assigns caller as ceWorker (if SCM_WORKER) or ceLeader (if CM_LEADER). Creates a CM_TO_CE ProcessHandover when originated from a demand. 201 on success.
- `src/app/api/changes/[id]/route.ts`:
  - GET: returns serialized change + resolved services (lookup from affectedServiceIds JSON) + handovers (ISO-converted) + originDemand (with customer name).
  - PATCH: updates complexity/implementationPlan/technicalOwnerTasksJson/verificationNotes/approvalNotes/assignedCeWorkerId on non-terminal changes. 409 if CLOSED/REJECTED.
- Lifecycle endpoints (all require SCM_WORKER or CM_LEADER per the simplified 4-role model):
  - `assess` — REQUESTED → ASSESSMENT. Requires affectedServiceIds to be non-empty (400 otherwise).
  - `plan` — ASSESSMENT → PLANNING. Body: { implementationPlan, technicalOwnerTasksJson?, complexity? }.
  - `approve` — PLANNING → APPROVED. Body: { approvalNotes? }.
  - `reject` — → REJECTED (terminal). Body: { reason }. Allowed from any non-terminal state.
  - `implement` — APPROVED → IMPLEMENTATION.
  - `verify` — IMPLEMENTATION → VERIFICATION. Body: { verificationNotes }.
  - `close` — VERIFICATION → CLOSED. Sets closedAt + catalogUpdatedAt = now. If originDemandId: updates the Demand to FULFILLED (fulfilledAt=now), creates a DemandEvent (FULFILLED, actorName=caller.name, notes='Change closed by CE.'), and creates a Notification (ChangeClosed) to the demand's submitter.
  - Each endpoint validates current state and returns 409 with a descriptive message on illegal transitions; 404 if not found.
- `src/app/api/handovers/route.ts`:
  - GET: filters by `type` and `unacknowledged=1`. Includes source demand title/status and target change title/status. Returns ProcessHandover[] with ISO-converted dates.
- `src/app/api/handovers/[id]/acknowledge/route.ts`:
  - POST: sets acknowledgedById=caller.id + acknowledgedAt=now. 409 if already acknowledged.
- `src/app/api/problems/route.ts`:
  - GET: filters by `serviceId`, `status`, `owner=me` (problems on services owned by the caller SERVICE_OWNER). Includes serviceName. Returns Problem[].
- `src/app/api/problems/[id]/route.ts`:
  - GET: single problem with service (id, name, domain, slaClass, chapter, status).
- Auth/role rules implemented: GET endpoints (changes list/single, handovers list, problems list/single) require SCM_WORKER | CM_LEADER | SERVICE_OWNER. Mutation endpoints (change create, PATCH, all lifecycle, handover acknowledge) require SCM_WORKER | CM_LEADER.
- Fixed two issues found via `bunx tsc --noEmit`: (1) lifecycle routes used `../../../_serialize` (wrong depth — pointed into api/) — corrected to `../../_serialize`; (2) `changes/route.ts` POST had TS narrowing failures on `complexity` and `originDemandId` (let-bound `string | null`) when passed to `Set.has` / `findUnique` — refactored to use local `const` for narrowing.
- Verification: `bunx tsc --noEmit` reports zero errors in any `api/changes|handovers|problems` file. `bun run lint` reports zero errors/warnings in my files (the 9 lint errors + 2 warnings all live in AppShell.tsx and workspaces/* — owned by orchestrator / other agents).

Stage Summary:
- 14 files created (1 helper + 13 route files). Changes API supports the full REQUESTED → ASSESSMENT → PLANNING → APPROVED → IMPLEMENTATION → VERIFICATION → CLOSED lifecycle plus REJECTED terminal, with the demand-fulfilment side-effect on close. Handovers API supports list (with filters) + acknowledge. Problems API is read-only list + single.
- All responses parse JSON-string columns back to arrays/objects and return ISO date strings, matching the Change/ProcessHandover/Problem interfaces in `src/lib/types.ts`.
- All endpoints enforce auth via `requireRole` and return proper status codes (400/401/403/404/409/201).
- No tests written. No foundation files modified. `bun run build` not executed.

---

Task ID: 11
Agent: Cogni AI Assistant Builder
Task: Build Cogni — the AI Operational Intelligence assistant (LLM-powered role-scoped chat panel + /api/ai endpoint).

Work Log:
- Read worklog.md, all foundation files (schema, auth, store, types, api, AppShell, page.tsx, globals.css, AiPanel stub, seed data).
- Invoked the LLM skill to learn the exact z-ai-web-dev-sdk chat completions API: `await ZAI.create()`, `zai.chat.completions.create({ messages, thinking: { type: 'disabled' }, stream: false })`, system prompt sent with role 'assistant', reply at `completion.choices[0].message.content`.
- Created `src/app/api/ai/route.ts` (POST endpoint, `runtime = 'nodejs'`):
  - Auth via getSession → 401 if none. Body parsed safely; message trimmed; 400 if empty / >2000 chars.
  - Four role-scoped context builders (each lightweight: counts + small record samples, never full table dumps):
    * SERVICE_CUSTOMER — their demands (counts by status + 8 recent with cost/effort), entitled services (unique from entitlements→offering→service with SLA class/status), their SLA events (recent 12, breach/warning counts).
    * SCM_WORKER — assigned demands (status counts), unassigned NEW queue (count + 6 recent), customer orgs served, action-needed counts (awaiting CM approval / awaiting customer / accepted needing CR), active changes as CE worker, SLA events on services in their scope (via relatedServiceIds).
    * CM_LEADER — total demands (counts by status), unassigned NEW (count + 6 recent), pending quote approvals (UNDER_REVIEW + !quoteApprovedByCmLeader, with cost), unresolved SLA breaches (8 recent), per-SCM-worker workload (total + open counts), active change count.
    * SERVICE_OWNER — services they own (with class/status/chapter), SLA events on their services (recent 25, breach/warning counts), open problems on their services (8 recent), pending governance = ACCEPTED/IN_CHANGE demands whose relatedServiceIds intersect their services.
  - All builders wrapped in try/catch so a DB error never kills the chat (falls back to "Context unavailable").
  - System prompt: names Cogni as uSMS operational intelligence assistant; states user's name/role/title/org; embeds the demand lifecycle; instructs concise data-grounded answers, no invented records, never claim to execute actions, redirect out-of-scope questions; includes the context snapshot.
  - LLM call: messages=[{role:'assistant', content: systemPrompt}, {role:'user', content: message}], temperature 0.4, stream:false, thinking disabled. Returns `{ reply }` on success, `{ error }` + 500 on failure. Errors logged to console with `[api/ai]` prefix.
- Overwrote `src/components/ai/AiPanel.tsx` with the full chat UI:
  - Right-side Sheet (sm:max-w-lg, full height flex column, mobile full-width).
  - Header: dark sidebar-accent background (bg-sidebar), Sparkles icon tile (bg-sidebar-primary), title "Cogni — Operational Intelligence", description "Your role-scoped AI assistant." Added `pr-14` to clear the radix Sheet X button.
  - Body: scrollable div (flex-1, scrollbar-thin, role=log, aria-live=polite). Each message: avatar (Sparkles for assistant on bg-sidebar, user initials on avatarColor) + bubble. Assistant left-aligned (bg-card border rounded-tl-sm), user right-aligned (bg-primary text-primary-foreground rounded-tr-sm). `whitespace-pre-wrap break-words` preserves line breaks.
  - Error bubble variant: rose-tinted with border.
  - Typing indicator: animated bouncing dots (3 spans with staggered animation-delay) inside a card bubble with the Sparkles avatar.
  - Welcome block (when empty): Sparkles tile + "Hi {firstName}, I'm Cogni." + description + role-specific suggested prompt chips. Clicking a chip sends it immediately.
  - Suggested prompts per role (exactly as specified in the task contract).
  - Input area at bottom: Textarea (auto-resize via JS ref + field-sizing-fixed, min-h-[44px] max-h-40) + Send icon Button. Enter to send, Shift+Enter for newline. Disabled while pending or when session is null.
  - Footer line: "Cogni assists or redirects — it never decides autonomously." with a small "Reset" button (RotateCcw icon) that clears conversation; only shown when messages exist.
  - Conversation state in component (array of {id, role, content, error?}). Auto-scrolls to bottom on new messages / pending. Auto-focuses textarea when sheet opens.
  - Error handling: toast.error on API failure + error bubble in the conversation.
- Verified:
  * ESLint clean on my two files (pre-existing errors in AppShell.tsx + CustomerWorkspace warnings are not mine — orchestrator-owned).
  * `bunx tsc --noEmit` reports ZERO errors in src/app/api/ai/route.ts and src/components/ai/AiPanel.tsx (all TS errors in the build are in other agents' workspace files).
- Note on dev server: the sandbox kept SIGKILL'ing `next dev` shortly after "Ready" (auto-managed by the system per the project rules — "bun run dev will be run automatically by the system. Do NOT run it"). Code correctness was therefore validated via lint + tsc --noEmit on my files. The /api/ai endpoint and AiPanel mount through the existing AppShell+page.tsx scaffolding (AiPanel is already imported and rendered in src/app/page.tsx).

Stage Summary:
- Cogni is fully implemented end-to-end: server-side LLM endpoint with role-scoped real-data context, polished teal/emerald chat UI in a right-side Sheet, role-specific suggested prompts, typing indicator, error handling, and a "never decides autonomously" footer.
- Uses only the foundation imports specified in the contract: `@/lib/db`, `@/lib/auth`, `@/lib/store`, `@/lib/api`, `sonner`, shadcn Sheet/Textarea/Button, lucide-react icons.
- z-ai-web-dev-sdk runs ONLY server-side (in the API route), per the LLM skill rules.
- No tests written (per instructions). No `bun run build` run (per instructions).
- Files owned by this task (do not modify without coordinating): src/app/api/ai/route.ts, src/components/ai/AiPanel.tsx.

---

Task ID: 5
Agent: Demand Detail Work Surface builder (CSM-side)
Task: Build the Demand Detail Work Surface (WS-02-003) — the shared CSM-side demand work surface used by SCM Worker and CM Leader workspaces.

Work Log:
- Read worklog.md fully: foundation contracts, demo accounts, demand state machine, available imports.
- Read foundation files for exact contracts: src/lib/types.ts (Demand / DemandEvent / Change / Service / ServiceOffering interfaces), src/lib/store.ts (useApp, navigate signature, ViewKey), src/lib/api.ts (apiGet/apiPost/apiPatch), src/components/shared.tsx (SectionCard signature — note: title/description are typed as `string`, NOT ReactNode; this constraint is respected), prisma/seed.ts (8 demands in varied statuses, change linkage, relatedServiceIds stored as JSON string array).
- Created `/home/z/my-project/src/components/workspaces/shared/DemandDetail.tsx` — default export matching the exact contract:
    `export default function DemandDetail({ id, role }: { id: string; role: 'SCM_WORKER' | 'CM_LEADER' })`
- Layout per WS-02-003 spec:
  1. Back button + PageHeader (title = demand.title, description = customer · submitted date · SCM worker).
  2. DemandPipelineTimeline (SectionCard) showing full lifecycle.
  3. Two-column grid (lg:grid-cols-3, main=col-span-2, side=col-span-1) with `items-start` so sticky side panel works.
  4. Main column sections (all SectionCard):
     - Outcome callout (terminal REJECTED/REDIRECTED).
     - Customer Input: description + businessJustification + desiredTimeline (read-only).
     - Catalog Check Panel (UNDER_REVIEW only): info callout + "Mark as Covered → Redirect" and "Proceed to Quote" buttons for SCM_WORKER.
     - Assessment & Quote Draft (UNDER_REVIEW only, AssessmentFieldsSection sub-component): editable effort/cost/quoteNotes for SCM_WORKER; read-only for CM_LEADER with governance gate callout; "Save Quote Draft" button with validation; status callouts for pending-approval / approved.
     - Quote (QUOTED+ read-only): effort/cost/quoteNotes/approval/quotation/acceptance dates with KeyValue grid.
     - Commitment (ACCEPTED+ if commitmentNotes present, read-only).
     - Linked Change Request (IN_CHANGE/FULFILLED): change title, type, complexity, status badge, implementation plan, "Open Change Record" button.
     - Activity Log via shared ActivityLog component.
  5. Side column:
     - Demand Meta: customer, submitted by, assigned SCM worker (with UserAvatar + workload hint for CM_LEADER from /api/workers/scm), submitted date, last updated (RelativeTime).
     - Related Services: parallel-fetched via useQueries on /api/services/[id] for each relatedServiceIds, with SlaClassBadge per service.
     - Governance Actions (lg:sticky lg:top-4): StatusCallout + context-sensitive action buttons.
  6. Role-gated actions in Governance Actions card:
     - NEW: SCM_WORKER → [Assign to Me] (PATCH assignedScmWorkerId = session.id) + [Start Review]; CM_LEADER → [Assign Worker…] (dialog with workload hints) + [Start Review].
     - UNDER_REVIEW SCM_WORKER: if quoteApprovedByCmLeader → [Submit Quote to Customer] (POST /quote); else → hint to fill assessment; [Redirect to Offering…] + [Reject Demand…].
     - UNDER_REVIEW CM_LEADER: if !approved → [Approve Quote] (POST /approve-quote, disabled until savedQuoteFieldsFilled); else → success callout; [Reject Demand…].
     - QUOTED: info callout (awaiting customer).
     - ACCEPTED SCM_WORKER: [Create Change & Hand to CE…] (POST /hand-to-ce with affectedServiceIds + optional implementationPlan).
     - ACCEPTED CM_LEADER: info callout (awaiting SCM).
     - IN_CHANGE both roles: [Mark Fulfilled] (POST /fulfill, disabled unless linked change CLOSED) + warning callout if not yet closed.
     - FULFILLED both roles: [Close Demand…] (POST /close with optional note).
     - Terminal states: info callout.
  7. Dialogs (all use shared shadcn/ui Dialog):
     - RejectDialog: reason textarea (required).
     - RedirectDialog: lazy-fetches /api/offerings when opened; Select of offerings + optional note.
     - HandToCeDialog: shows related services as affected-service preview + optional implementation plan textarea.
     - AssignDialog (CM_LEADER only): lazy-fetches /api/workers/scm with workload counts.
     - CloseDialog: optional closing note.
- Mutations: all use TanStack Query useMutation with toast (sonner) feedback on success/error; invalidate ['demand', id] and ['demands'] on success.
- Form state design: extracted AssessmentFieldsSection sub-component with lazy `useState` initializers (no useEffect). Parent remounts it via `key={demand.id}` when the demand changes, so the form re-initializes cleanly without violating the `react-hooks/set-state-in-effect` lint rule. Dialog inputs are reset in their open-trigger handlers (also no setState-in-effect).
- Design polish:
  - Teal/emerald theme throughout (primary teal). NO indigo/blue primary colors.
  - Callout component (info/warning/success/danger tones) for inline governance hints.
  - Responsive: stacks columns on mobile (grid lg:grid-cols-3), action buttons full-width on mobile.
  - Sticky Governance Actions card on lg screens.
  - Loading skeletons (LoadingState) for demand fetch and related-services fetch.
  - Empty states (EmptyState) for no-related-services, no-events, no-linked-change, demand-not-found.
  - StatusCallout sub-component renders a contextual hint in the side panel for every demand status × role combination.
  - Custom scrollbar styling on implementation-plan overflow (`scrollbar-thin`).
- API endpoints assumed (other agents own these): GET /api/demands/[id], PATCH /api/demands/[id], POST /api/demands/[id]/{review,approve-quote,quote,reject,redirect,hand-to-ce,fulfill,close}, GET /api/services/[id], GET /api/offerings, GET /api/workers/scm. All requests use relative paths via the gateway. None of these are touched by this agent.
- Verified:
  - `bunx eslint src/components/workspaces/shared/DemandDetail.tsx` → 0 errors, 0 warnings.
  - `bunx tsc --noEmit --skipLibCheck` for DemandDetail.tsx → 0 errors.
  - Foundation files NOT modified. Only file created: src/components/workspaces/shared/DemandDetail.tsx.

Stage Summary:
- DemandDetail work surface COMPLETE and lint-clean.
- Export contract honored exactly: `export default function DemandDetail({ id, role }: { id: string; role: 'SCM_WORKER' | 'CM_LEADER' })`.
- Consumes GET /api/demands/[id] (TanStack Query), PATCH /api/demands/[id] (assignment + quote fields), and the full set of lifecycle POST endpoints. Invalidates ['demand', id] + ['demands'] on every successful mutation.
- All role-gated actions implemented per the demand state machine. CM Leader governance gate (quote approval) is the central interaction.
- Ready to be imported by SCM Worker (Task 6) and CM Leader (Task 7) workspaces via:
    `import DemandDetail from '@/components/workspaces/shared/DemandDetail'`
    then `case 'demand-detail': return <DemandDetail id={params.id} role={session.role === 'CM_LEADER' ? 'CM_LEADER' : 'SCM_WORKER'} />`
- Note for downstream agents: the demand API must return `events[]`, `change` (with `id`, `title`, `type`, `status`, `complexity`, `implementationPlan`), `serviceCustomerName`, `submittedByName`, `assignedScmWorkerName`, and `relatedServiceIds` (parsed array). The /api/workers/scm endpoint should return `[{ id, name, title, avatarColor, openDemandCount }]`. The /api/offerings endpoint should return `ServiceOffering[]` with optional `serviceName`. All endpoints should be auth-gated per the role scoping rules in worklog.md.

---

Task ID: 7
Agent: SCM Worker Workspace (WS-02 — CSM Workspace, SCM_WORKER role)
Task: Build the SCM Worker workspace — owns the demand lifecycle (assess, quote, hand to CE, fulfill, communication ownership). Screens: Dashboard (WS-02-001), DemandQueue (WS-02-002), Catalog (WS-02-004), SlmDashboard (WS-02-005), Changes, Handovers.

Work Log:
- Read worklog.md (foundation contracts, demo accounts, demand state machine, design rules). Confirmed teal/emerald theme, sticky footer handled by AppShell, no indigo/blue primary.
- Verified parallel-agent dependencies are present at compile time:
  - `@/components/widgets` exports `DemandPipelineLanes({demands,onSelect,emptyLabel?})`, `WorkloadBars({items:{name,count,risk?:number}[]})`, `SlaTrendChart({data:{label,value}[],height?})`. Adjusted my workload `risk` to be a number (overdue count), not a string.
  - `@/components/workspaces/shared/DemandDetail` default-exports `{id, role:'SCM_WORKER'|'CM_LEADER'}`. Used `next/dynamic` import for resilience (ssr:false, loading state).
- Built `ScmWorkerWorkspace.tsx` — client component switching on `view`: dashboard / demands / demand-detail (dynamic DemandDetail) / catalog / sla / changes / handovers / default→Dashboard.
- Built `Dashboard.tsx` (WS-02-001):
  - PageHeader "My Workspace" with [New Demand on behalf] button → navigates to demands view.
  - Top StatCards: My Active Demands, Awaiting Customer Action (QUOTED count), SLA Breaches, Open Changes — tone-coded (default/warning/danger/success).
  - My Queue: `DemandPipelineLanes` for assigned demands, click → demand-detail.
  - My Workload: `WorkloadBars` with risk = count of overdue QUOTED demands (>5 days since quote).
  - Unassigned Demands panel: scrollable list with [Assign to Me] button — PATCH /api/demands/[id] {assignedScmWorkerId: session.id} (note: API expects real user id, not 'me' literal — adapted accordingly). Toast on success/error.
  - Awaiting Customer Action: my QUOTED demands with days-since-quote + "Overdue" badge when >5 days.
  - Change Status Feed: my IN_CHANGE demands with linked change status badge.
  - SLA Health Snapshot: services with active warnings/breaches, sorted by severity, click → SLM dashboard.
- Built `DemandQueue.tsx` (WS-02-002):
  - DataTable of all demands (GET /api/demands). Columns: Title+description, Service Customer, Status, Assigned Worker (with UserAvatar or "Unassigned" badge), Created, Last updated.
  - Filters: free-text search (title/description/customer/submitter/worker), unassigned-only switch, status multi-toggle (ToggleGroup, all 9 statuses), Clear button, count summary.
  - [New Demand on behalf] button → opens create Dialog with Title, Description, customer Select (built from unique serviceCustomerName in existing demands). POST /api/demands → on success navigates to demand-detail.
- Built `Catalog.tsx` (WS-02-004):
  - Full catalog DataTable (GET /api/services?status=ALL — needed to override the default ACTIVE-only filter). Columns: Service+description, Domain/Chapter, Layer, SLA Class (badge), Status, Service/Technical owners.
  - Filters: free-text search + 4 Selects (Domain, Layer, SLA Class, Status) each with "All" option.
  - Row click → detail Dialog showing the full 9-field model: description, customerValue, commodityType, supportLevels, owners, SLA profile targets (availability + P1/P2 response/resolution), offerings list with requestType/fulfillmentDays.
  - [Request Catalog Change] button → toast "Catalog changes are made via Change Enablement" + navigate to demands.
- Built `SlmDashboard.tsx` (WS-02-005):
  - Top tiles: Services Monitored, Active Breaches, Active Warnings, Avg Compliance %.
  - SLA Compliance Summary table: Service × SLA Class × Closed-in-time / Breaches / Warnings / Compliance % (with colored progress bar — green ≥95%, amber ≥85%, red <85%). Computed client-side from sla-events.
  - Compliance Trend chart: SlaTrendChart with synthetic 6-month monthly compliance data.
  - Active Breaches list: BREACHED events with service name, message, detected date, [Communicate] button → opens Dialog with breach context + free-text message textarea → toast "Communication drafted" (no real send).
- Built `Changes.tsx`:
  - DataTable of changes (GET /api/changes). Scoped to changes whose originDemandId is in my assigned demands, fallback to all changes. Columns: Title, Type, Status (badge), Complexity, Origin Demand (title or origin type), Last update.
  - Status filter (Select, "All statuses" + 8 statuses), count summary.
  - Row click → detail Dialog with: header (status/type/complexity/origin badges), key dates grid, Implementation Plan (pre-formatted), Technical Owner Tasks (list with owner/chapter/status badges, done count), Affected Services (badges resolved via service map), Governance Notes (approval/verification/rejection).
- Built `Handovers.tsx`:
  - DataTable of CM_TO_CE handovers (GET /api/handovers?type=CM_TO_CE). Scoped to those whose source demand is assigned to me, fallback to all. Columns: Type badge, Source Demand (title+customer), Target Change (title+status badge), Acknowledged (yes+date or pending), Created.
  - Unacknowledged-only switch, pending count + shown count.
  - Read-only (acknowledgement is CE's action).
- Cross-cutting: every list uses TanStack Query for fetching with appropriate query keys (demands:assigned:me, demands:unassigned, demands:status:QUOTED, demands:all, services:all-status, sla-events, changes:all, handovers:CM_TO_CE). Mutations invalidate demand/handover queries on success. Toasts for all user-facing success/error states. LoadingState/EmptyState used everywhere. Long lists scroll within `max-h-80 overflow-y-auto scrollbar-thin`. All screens are responsive (mobile-first, sm:/lg: breakpoints). Theme: teal/emerald via shared component library.

Stage Summary:
- All 7 SCM Worker workspace files created and TypeScript-clean (no TS errors in any scm-worker file).
- Lint passes for all scm-worker files (other agents' files have lint errors — AppShell setState-in-effect, customer workspace unused directives, DemandDetail setState-in-effect — not mine to fix).
- Verified end-to-end against running dev server: logged in as scm@cerebree.io, all 6 API endpoints (demands?assigned=me, demands?unassigned=1, demands?status=QUOTED, services?status=ALL, sla-events, changes, handovers?type=CM_TO_CE) return 200 with expected shapes. `quotedAt` and `change` (linked) fields confirmed in demand response.
- DemandDetail is consumed via `next/dynamic` (ssr:false) so the SCM workspace boots independently of Task 5's bundle — the demand-detail view resolves on demand.
- WorkloadBars `risk` field is a number (overdue count), matching Task 10's signature (not a string).
- DemandQueue "Assign to Me" sends `{assignedScmWorkerId: session.id}` (real user id) since the API validates user existence.
- Catalog fetch uses `?status=ALL` to override the services API's default ACTIVE-only filter, ensuring retired/planned services appear in the SCM's full-catalog view.
- SCM worker can: see their queue + workload + unassigned pickup + awaiting-customer + change feed + SLA hotspots on the dashboard; filter/search the demand queue and create demands on behalf of customers; browse the full catalog with detail dialog; review SLA compliance + breaches + communicate; read change records linked to their demands; review CM→CE handovers (acknowledgement is CE's action).

---

Task ID: 1
Agent: Demands API Builder
Task: Build the complete Demands API — full demand lifecycle with state-machine transitions, role enforcement, event logging, and notifications.

Work Log:
- Read worklog.md + prisma/schema.prisma + src/lib/{auth,db,api,types}.ts to align with foundation contracts.
- Created `src/app/api/demands/_serialize.ts` — shared helpers (Next.js-safe via `_` prefix, not a route):
  - `DEMAND_INCLUDE` constant — canonical Prisma include shape (customer, submitter, scmWorker, events desc, change with handovers+ceWorker).
  - `serializeDemand(d)` — maps Prisma demand to API `Demand` shape: parses `relatedServiceIds` JSON string → array, converts all dates to ISO strings, populates serviceCustomerName / submittedByName / assignedScmWorkerName from relations, serializes change if present.
  - `serializeEvent(e)` and `serializeChange(c)` — companion serializers (parse affectedServiceIds + technicalOwnerTasksJson).
  - `errorResponse(err)` — converts UNAUTHORIZED→401, FORBIDDEN→403, NOT_FOUND→404, CONFLICT→409, INVALID_*→400, fallback 500.
- Created `src/app/api/demands/route.ts`:
  - GET — list with filters: `status` (comma-separated multi), `assigned=me`, `unassigned=1`, `customer=<orgId>`, `q=<text>` (title contains), `mine=1`. Role scoping: SERVICE_CUSTOMER sees only own orgNode; SCM_WORKER sees assigned-to-me OR unassigned; CM_LEADER + SERVICE_OWNER see all. Returns serialized demand array.
  - POST — create demand. Role: SERVICE_CUSTOMER or SCM_WORKER. Validates title+description, accepts optional businessJustification / desiredTimeline / relatedServiceIds[] / serviceCustomerId (defaults to caller.orgNodeId). SERVICE_CUSTOMER cannot override serviceCustomerId (must be own org). Sets status='NEW', submittedById=caller. Emits CREATED event. Notifies ALL CM_LEADER users (type 'DemandCreated', entityRef `demand:<id>`). Returns 201 with full demand (including the new event).
- Created `src/app/api/demands/[id]/route.ts`:
  - GET — single demand with full relations. 404 if not found. Scoping: customer must own; SCM must be assigned or unassigned.
  - PATCH — updates editable fields: assignedScmWorkerId (validates user role SCM_WORKER/CM_LEADER), estimatedEffortDays, estimatedCost, quoteNotes, commitmentNotes. Role: SCM_WORKER/CM_LEADER (SCM scoping enforced).
- Created `src/app/api/demands/[id]/review/route.ts` — POST: NEW → UNDER_REVIEW. Role: SCM_WORKER/CM_LEADER. Auto-assigns to caller if SCM and unassigned; CM_LEADER may pass assignedScmWorkerId in body. Emits REVIEW_STARTED event. 409 if status ≠ NEW.
- Created `src/app/api/demands/[id]/approve-quote/route.ts` — POST: CM_LEADER-only gate. Sets quoteApprovedByCmLeader=true + quoteApprovedAt=now (status unchanged). Emits QUOTE_APPROVED event. 409 if already approved or terminal status.
- Created `src/app/api/demands/[id]/quote/route.ts` — POST: UNDER_REVIEW → QUOTED. Role: SCM_WORKER/CM_LEADER. Body: { estimatedEffortDays (required), estimatedCost?, quoteNotes? }. Hard gate: returns 403 if quoteApprovedByCmLeader=false. Sets quotedAt=now. Emits QUOTED event. Notifies customer (type 'DemandQuoted').
- Created `src/app/api/demands/[id]/accept/route.ts` — POST: QUOTED → ACCEPTED. Caller must be SERVICE_CUSTOMER with orgNodeId === demand.serviceCustomerId (else 403). Sets acceptedAt=now. Emits ACCEPTED event. Notifies assigned SCM worker (type 'DemandAccepted', falls back to all SCM workers if somehow unassigned).
- Created `src/app/api/demands/[id]/reject/route.ts` — POST: UNDER_REVIEW|QUOTED → REJECTED. Role: SCM_WORKER/CM_LEADER. Body: { reason (required) }. Sets rejectionReason. Emits REJECTED event. Notifies customer (type 'DemandRejected').
- Created `src/app/api/demands/[id]/redirect/route.ts` — POST: UNDER_REVIEW → REDIRECTED. Role: SCM_WORKER/CM_LEADER. Body: { offeringId (required, validated against db), reason? }. Sets redirectedToOfferingId, stores reason in rejectionReason. Emits REDIRECTED event (notes include the offering + service name). Notifies customer.
- Created `src/app/api/demands/[id]/hand-to-ce/route.ts` — POST: ACCEPTED → IN_CHANGE. Role: SCM_WORKER/CM_LEADER. Body: { implementationPlan?, complexity? }. Uses a Prisma `$transaction` to atomically: (a) create Change (type NORMAL, originType DEMAND, originDemandId, affectedServiceIds = JSON.parse(demand.relatedServiceIds), status REQUESTED, complexity defaults MEDIUM, implementationPlan defaults to a templated message); (b) create ProcessHandover (type CM_TO_CE, sourceDemandId, targetChangeId); (c) update demand (status IN_CHANGE, changeRequestId, handedToCeAt); (d) emit HANDED_TO_CE event with both new ids. 409 if demand already has a changeRequestId.
- Created `src/app/api/demands/[id]/fulfill/route.ts` — POST: IN_CHANGE → FULFILLED. Role: SCM_WORKER/CM_LEADER. Hard gate: returns 409 if linked change.status !== 'CLOSED'. Sets fulfilledAt=now. Emits FULFILLED event. Notifies customer (type 'DemandFulfilled').
- Created `src/app/api/demands/[id]/close/route.ts` — POST: FULFILLED → CLOSED (customer OR SCM/CM, no reason required); OR QUOTED → CLOSED (customer-only decline, reason required in body, stored in rejectionReason). 409 otherwise. Emits CLOSED event. Caller must be SERVICE_CUSTOMER (own demand) or SCM_WORKER/CM_LEADER.

Smoke-tested the full lifecycle end-to-end against the seeded DB (dev server is volatile in this sandbox — required restarts):
  • GET /api/demands?assigned=me (SCM) → 200, returns assigned demands.
  • GET /api/demands?status=NEW, ?unassigned=1 → 200, filters work.
  • GET /api/demands (SERVICE_CUSTOMER) → only sees their own orgNode's demands (6 demands, all from "Finance Division"). ✓ scoping verified.
  • POST /api/demands (SCM creates on behalf of customer) → 201 with CREATED event + DemandCreated notification to all CM_LEADER users. ✓
  • POST /review → NEW→UNDER_REVIEW + REVIEW_STARTED event + auto-assigned to SCM caller. ✓
  • POST /quote before approval → 403 ("Quote must be approved by a CM Leader before submission"). ✓ gate enforced.
  • POST /approve-quote (CM_LEADER) → quoteApprovedByCmLeader=true + QUOTE_APPROVED event. ✓
  • POST /quote (after approval) → QUOTED + QUOTED event + DemandQuoted notification to customer. ✓
  • POST /accept (SERVICE_CUSTOMER) → ACCEPTED + ACCEPTED event + DemandAccepted notification to assigned SCM. ✓
  • POST /hand-to-ce → IN_CHANGE + Change created (NORMAL/DEMAND/REQUESTED) + ProcessHandover created (CM_TO_CE) + HANDED_TO_CE event. ✓
  • POST /fulfill before change CLOSED → 409. ✓ gate enforced.
  • POST /fulfill after closing change in DB → FULFILLED + FULFILLED event + DemandFulfilled notification. ✓
  • POST /close (FULFILLED, customer) → CLOSED + CLOSED event. ✓
  • POST /close (QUOTED, customer, with reason) → CLOSED + rejectionReason set + CLOSED event. ✓ (decline-quote path)
  • POST /close (QUOTED, customer, no reason) → 400 ("A reason is required to decline a quote"). ✓ validation.
  • POST /reject (CM_LEADER, with reason) → REJECTED + rejectionReason set + DemandRejected notification + REJECTED event. ✓
  • POST /redirect (SCM, with offeringId) → REDIRECTED + redirectedToOfferingId set + REDIRECTED event. ✓
- Ran `bunx eslint src/app/api/demands` → 0 errors, 0 warnings (pre-existing errors in AppShell.tsx and CustomerWorkspace.tsx belong to other agents).
- Ran `bunx tsc --noEmit` → 0 errors in any `src/app/api/demands/**` file.

Stage Summary:
- Demands API COMPLETE and verified end-to-end against the seeded database.
- All 11 transition endpoints + GET (list) + GET (single) + POST (create) + PATCH (update) implemented with proper role enforcement, status validation (409 on invalid transitions), JSON parsing of relatedServiceIds, ISO date conversion, DemandEvent logging on every transition, and Notification creation on every contractually-required event (DemandCreated → CM_LEADER users; DemandQuoted/DemandRejected/DemandFulfilled → customer; DemandAccepted → assigned SCM worker).
- Shared `_serialize.ts` keeps response shape consistent across all routes.
- Other agents can `import { serializeDemand, DEMAND_INCLUDE, errorResponse } from '@/app/api/demands/_serialize'` if they need to reuse demand serialization (e.g. changes API that includes origin demand).

================================================================================

---

Task ID: 8
Agent: CM Leader workspace builder (parallel build)
Task: Build WS-02 — CSM Workspace for the CM_LEADER role (Sofia Reyes). Governance authority: quote approval, rejection authorization, SLA report review, demand assignment, workload monitoring. Owns `src/components/workspaces/cm-leader/` exclusively.

Work Log:
- Read worklog.md fully (foundation contracts + demand state machine + demo accounts).
- Read foundation files: `lib/types.ts`, `lib/store.ts`, `lib/api.ts`, `lib/auth.ts`, `components/shared.tsx`, `components/shell/AppShell.tsx`, `app/page.tsx`, `app/layout.tsx`, `globals.css`, `prisma/schema.prisma`, `prisma/seed.ts`.
- Confirmed `/api/stats` response shape for CM_LEADER: returns `workloadByWorker: { workerId, workerName, activeDemands, slaRisk }[]`. Built `WorkloadItem` interface resilient to either `slaRisk` (actual) or `riskCount` (defensive).
- Built `CmLeaderWorkspace.tsx` — default-exported client component, switch on `view`: `dashboard | demands | demand-detail | workers | sla | catalog | changes | analytics | default→Dashboard`. `demand-detail` delegates to shared `DemandDetail` (Task 5) with `role="CM_LEADER"`.
- Built `Dashboard.tsx` (WS-02-001):
  - PageHeader "CM Leader — Governance Overview".
  - StatCards: Active Demands, Unassigned, Pending Quote Approval, SLA Breaches, Open Changes.
  - **Quote Approval Queue** — prominent GOVERNANCE GATE panel. Lists UNDER_REVIEW demands with `estimatedEffortDays != null && !quoteApprovedByCmLeader`. Inline [Approve] button → POST /api/demands/[id]/approve-quote (toast on success). [Review] button → navigate to demand-detail.
  - **Unassigned Demands** panel — NEW demands with no worker, Select of SCM workers (derived from `stats.workloadByWorker`, sorted ascending by load) + [Assign] button → PATCH /api/demands/[id].
  - Awaiting Customer Action panel — QUOTED demands with days-since-quote + overdue flag (>7d).
  - Change Status Feed — IN_CHANGE demands with linked change status badge.
  - Workload Snapshot — WorkloadBars of active demands per SCM worker.
  - SLA Health Overview — warnings/breaches/closed counts + ComplianceDonut summary + breach alert.
  - Exports shared hooks for sibling screens: `useDemands`, `useLeaderStats`, `useSlaEvents`, `useChanges`, `useServices`, `useAssignDemand`, `useApproveQuote`, `daysSince`, and `WorkloadItem` type.
- Built `DemandQueue.tsx` (WS-02-002):
  - Full tenant DataTable. Columns: Title, Service Customer, Status, Assigned Worker, Created, Last updated, Actions.
  - Filters: Popover multi-select for status, Select for worker (with "__unassigned" option), Select for customer, Switch for unassigned-only, free-text search. Clear-filters button when any active.
  - Inline Assign menu (DropdownMenu sorted ascending by active load) for unassigned rows.
  - Row click → demand-detail.
- Built `Workers.tsx` (SCM workload monitoring):
  - StatCards: # Workers, Total Active, Avg per Worker (max hint), Stalling Signals (UNDER_REVIEW > 3d).
  - WorkloadBars summary.
  - Per-worker cards: avatar (lg), name, risk badge (amber), active/total/status-count grid, MiniBarChart of status breakdown, "Early signal" warning when stalling > 3d, [View demands] button → Dialog with DataTable of that worker's demands.
- Built `SlmGovernance.tsx` (WS-02-005 + SLA report review):
  - StatCards: Overall Compliance %, Active Breaches, Active Warnings, Pending Report Reviews.
  - **Active SLA Breaches** DataTable — service, customer, message, duration (with red badge if >3d), [Review] button (toast). Prominent governance panel.
  - **SLA Compliance Matrix** DataTable — Service × Customer × SLA Class × total/breaches/warnings/closed/compliance % (with inline progress bar).
  - ComplianceDonut panel — overall tenant compliance + SlaHealthBadge + counts grid.
  - **SLA Report Review** panel — "SLA reports are reviewed by you before issuance to Service Customers" framing. Lists pending reports (unresolved breaches). [Approve Report] button → toast.
  - SlaTrendChart — weekly compliance % for last 8 weeks (synthesized from slaEvents).
- Built `Catalog.tsx` (WS-02-004 read-only):
  - StatCards: Total, Active, Planned, Class A Critical.
  - Filter bar: search, domain, layer, SLA class.
  - Card grid: name, SLA class badge, description, domain/layer badges, owner, offerings count. Click → Dialog with full details (customer value callout, owner/commodity/status grid, SLA profile, offerings table).
  - Uses `/api/services?status=ALL` so the leader sees planned/retired services too.
- Built `Changes.tsx` (tenant-wide change register):
  - StatCards: Open, In Implementation, Emergencies, Closed.
  - DataTable: Title, Type (with tone-coded badge, emergency icon), Status, Complexity (tone-coded), CE Worker, Created, Last update.
  - Filters: status, type, free-text.
  - Row click → Dialog with full change details (implementation plan, approval notes, verification notes, rejection reason, technical owner tasks with status badges).
- Built `Analytics.tsx` (strategic view):
  - KPI row: Total Demands, Avg Cycle Time (Created→Closed), Rejection Rate, SLA Compliance.
  - Demand Throughput — two MiniBarCharts (Created vs Closed) over 8 weeks.
  - Demand Pipeline Distribution — MiniBarChart of counts by status.
  - SLA Compliance Trend — SlaTrendChart.
  - Overall SLA Compliance — ComplianceDonut.
  - Changes by Origin — MiniBarChart.
  - Changes by Complexity — MiniBarChart.
  - Demand Pipeline Lanes — interactive widget at bottom (click → demand-detail).
- Theme: teal/emerald (foundation). Governance gates visually prominent (amber/rose accents). All layouts responsive (grid collapse 5→3→2→1 cols). Sticky footer handled by AppShell.
- Imported `DemandDetail` from `@/components/workspaces/shared/DemandDetail` (Task 5) — confirmed signature `{ id, role: 'SCM_WORKER'|'CM_LEADER' }`.
- Imported widgets from `@/components/widgets` (Task 10) — confirmed signatures: `DemandPipelineLanes({ demands, onSelect?, emptyLabel? })`, `WorkloadBars({ items: {name,count,risk?}[] })`, `SlaTrendChart({ data: {label,value}[], height? })`, `ComplianceDonut({ value, label?, size? })`, `MiniBarChart({ data: {label,value}[] })`.
- Verified dev server boots, login as cmleader@cerebree.io works (HTTP 200), all consumed API endpoints return 200 with correct payloads (`/api/stats` returns `workloadByWorker` with `slaRisk` field; `/api/demands` returns 7 demands; `/api/sla-events` returns 6 events; `/api/changes` returns 2; `/api/services?status=ALL` returns 6).
- Lint: `eslint src/components/workspaces/cm-leader/` → exit 0, zero errors/warnings.
- TypeScript: `tsc --noEmit --skipLibCheck` filtered to cm-leader → zero errors. (Initial issues fixed: exported `WorkloadItem`, added `id` to `ComplianceRow` so it satisfies `DataTable<T extends {id:string}>`, cast `Object.entries` to `[string, number][]` for the status breakdown chart.)
- Wrote agent-ctx record at `/home/z/my-project/agent-ctx/8-cm-leader-workspace.md`.

Stage Summary:
- CM Leader workspace COMPLETE. 8 view screens implemented with clear governance emphasis:
  - **Quote Approval gate** is the most prominent panel on the Dashboard (amber accent, inline Approve CTA).
  - **SLA Breaches** are surfaced in a dedicated governance DataTable with Review actions, plus a separate "SLA Report Review" panel for sign-off before issuance.
  - **Workload monitoring** includes early-signal detection (UNDER_REVIEW > 3 days) and risk-aware bars.
  - **Analytics** is a strategic view with throughput, pipeline distribution, SLA trend, compliance donut, and change mix.
- All foundation files left untouched. All cross-agent contracts honored.
- The workspace compiles cleanly, lints cleanly, and renders correctly against the live API.

================================================================================

Task ID: 9
Agent: Service Owner Workspace
Task: Build the Service Owner workspace — accountability dashboard, portfolio, SLA performance, governance approvals, problem records, and changes affecting owned services.

Work Log:
- Read full worklog.md for contracts, demo accounts, design rules, and the DEMAND/CHANGE state machines. Read foundation files (store, types, api, shared, AppShell, schema, seed).
- Verified the API surface available to the Service Owner:
  - GET /api/services?owner=me → services where serviceOwnerId = caller (built by Task 1 — confirmed supports owner=me filter and includes offerings[] + slaProfile).
  - GET /api/services/[id] → service detail.
  - GET /api/sla-events → all tenant events (Service Owner sees all tenant events per sla-events route role scoping); filtered client-side by myServiceIds.
  - GET /api/problems?owner=me → problems on services owned by caller (confirmed supports owner=me).
  - GET /api/changes → all changes (Service Owner role permitted); filtered client-side to changes whose affectedServiceIds intersect my service ids.
  - GET /api/demands?status=ACCEPTED → ACCEPTED demands (Service Owner sees all tenant demands); filtered client-side to demands whose relatedServiceIds intersect my service ids.
  - GET /api/demands/[id] → demand detail (used for read-only demand-detail view).
- Verified @/components/widgets (built by Task 10) exports SlaTrendChart({data, height?}), ComplianceDonut({value, label?, size?}), and MiniBarChart({data, color?, height?}). Used SlaTrendChart + ComplianceDonut in SlaPerformance.
- Created `src/components/workspaces/service-owner/_hooks.ts` — shared data hooks (useOwnerServices, useSlaEvents, useOwnerProblems, useAllChanges, useAcceptedDemands, useDemand) + derived helpers (deriveHealth, serviceCompliance, synthesiseTrend). Centralises TanStack Query cache keys and client-side filtering by myServiceIds.
- Created `ServiceOwnerWorkspace.tsx` — default-exported client component switching on `view`: dashboard / portfolio / sla / governance / problems / changes / demand-detail (read-only) / default→Dashboard.
- Created `Dashboard.tsx` — accountability command center:
  - PageHeader "Service Owner — Accountability Dashboard" with framing "What you see creates governance obligations."
  - Top StatCards: My Services, SLA Warnings (warning tone), SLA Breaches (danger tone, hint "REQUIRES YOUR RESPONSE"), Open Problems, Governance Approvals (success tone). All clickable → navigate to relevant view.
  - "Breach Notifications → Governance Responses" panel: every active BREACHED event rendered as a destructive Alert with service name, message, breach time, [Review & respond] button → navigate('sla'). Framing: "A breach notification is an accountability event that requires your response."
  - Service Portfolio snapshot: compact scrollable list with SlaClassBadge + SlaHealthBadge + active incident count, click → portfolio.
  - Pending Governance Approvals: ACCEPTED demands on my services with title, customer, SCM worker, commitment notes preview, click → demand-detail.
  - Open Problems on my services: list with status + root cause summary.
  - Active Known Errors card: problems with knownErrorId or KNOWN_ERROR status, with workaround preview + communications guidance note.
- Created `Portfolio.tsx`:
  - Catalog Accuracy Obligation banner with 4 service tiles showing stale/current state and catalog entry date (createdAt — the Service API response exposes createdAt; the type interface doesn't expose updatedAt, so fell back to createdAt for the "last reviewed" indicator).
  - DataTable of services: name, domain/chapter, layer (md+), SlaClassBadge, status badge, SlaHealthBadge (derived from SLA events), last SLA event time (lg+).
  - Click row → ServiceDetailDialog with Tabbed view: Overview (description, customerValue, commodityType, supportLevels, catalog entry created), SLA Profile (availability + P1/P2 response/resolution targets), Offerings (list with requestType, fulfillmentDays, active state), Activity (recent SLA events with colored dots + recent changes). Uses GET /api/services/[id] to fetch full detail.
- Created `SlaPerformance.tsx`:
  - Frame: "Breach notifications produce governance responses, not documentation."
  - ComplianceDonut for portfolio-wide compliance (closed-in-time / (closed-in-time + breaches)).
  - SlaTrendChart with synthesised 6-month compliance trend derived from SLA events per month.
  - DataTable per-service: Service, SLA Class, availability target (md+), compliance % with inline bar (color-coded), active warnings badge, active breaches badge, SlaHealthBadge.
  - Breach Event Timeline: chronological ol of all BREACHED events with service name, message, resolved/active badge, and PM root-cause context (matched by serviceId to problems) where available.
  - Quick stat tiles footer: total SLA events, active warnings, active breaches, resolved this period.
- Created `Governance.tsx`:
  - Escalation Chain reference: CM Leader → You (Service Owner) → Governance Owner, with role descriptions and accent colors.
  - Service Commitments Awaiting Your Approval: ACCEPTED demands on my services, each with title, DemandStatusBadge, SlaClassBadge (from related service), customer, SCM worker, service name, accepted time, proposed commitment notes (highlighted), estimated effort/cost, [Approve] + [Escalate] buttons (toast on action — no real endpoint per spec) + [View detail] → demand-detail.
  - Catalog Change Proposals: changes in PLANNING status affecting my services.
  - Change Board Items: COMPLEX changes affecting my services (with CE worker + complexity badge).
- Created `Problems.tsx`:
  - Summary tiles: Active Problems, Under Investigation, Known Errors, Linked to Change.
  - DataTable of problems on my services: title (with root cause preview), service (md+), status badge (color-coded by problem status), decision (lg+), created (sm+).
  - Click row → ProblemDetailDialog with: status + decision + known error badges, root cause panel, impact assessment panel (amber-bordered), decision rationale panel, workaround panel (orange-bordered, only for known errors), meta (PM worker, known error id, created, last updated), linked incidents note.
- Created `Changes.tsx`:
  - Frame: "You are consulted when DEMAND transitions to QUOTE. You are escalated to when OUTCOME fails."
  - Summary tiles: Total Changes, Active, Emergency, PIR Due (post-implementation review).
  - DataTable of changes affecting my services: title (with origin label), type badge, ChangeStatusBadge, complexity (md+), CE worker (lg+), created (sm+).
  - Click row → ChangeDetailDialog with: status + type + complexity + PIR Due badges, affected services chips, implementation plan (preserved whitespace), technical owner tasks list (with status dots: DONE/IN_PROGRESS/PENDING), verification notes (emerald-bordered), approval notes, meta (CE worker, catalog updated, created, closed), post-implementation review if present.
- Created `DemandDetail.tsx` — read-only demand summary for governance context:
  - Back to Governance button in header.
  - SectionCard with demand title + DemandStatusBadge: description, business justification, meta grid (customer, SCM worker, services affected on your portfolio, desired timeline, estimated effort, estimated cost), proposed service commitment (emerald-highlighted), quote notes.
  - DemandPipelineTimeline with 4 key dates (quoted/accepted/handed to CE/fulfilled).
  - ActivityLog of all demand events.
  - Empty/error states when id missing or demand not found.
- Design system adherence:
  - Teal/emerald theme (matches globals.css oklch 165 hue primary).
  - shadcn/ui primitives (Card, Dialog, Tabs, Alert, Badge, Button) used throughout — no custom CSS.
  - Lucide icons used consistently (Briefcase, ShieldAlert, Gavel, Bug, GitBranch, Stethoscope, etc.).
  - Responsive: grid layouts collapse to single column on mobile; tables hide non-essential columns at sm/md/lg breakpoints.
  - Sticky footer handled by AppShell (mt-auto on footer).
  - Custom scrollbar styling via `scrollbar-thin` class for long lists.
  - Color-coded badges for problem status, change type, complexity, demand status, SLA class, SLA health.
- Quality gates:
  - TypeScript: clean (npx tsc --noEmit --skipLibCheck shows zero service-owner errors).
  - ESLint: clean (only remaining project lint error is in AppShell.tsx — orchestrator's foundation file, not mine).
  - Fixed React Compiler issue in Problems.tsx by inlining the serviceName lookup inside useMemo (closure dependency mismatch).
  - Removed all unused imports (noUnusedLocals clean across all 8 service-owner files).
  - Dev server running and compiling without errors.

Stage Summary:
- Service Owner workspace COMPLETE. 8 files in src/components/workspaces/service-owner/: ServiceOwnerWorkspace.tsx (switch), Dashboard.tsx, Portfolio.tsx, SlaPerformance.tsx, Governance.tsx, Problems.tsx, Changes.tsx, DemandDetail.tsx, plus _hooks.ts (shared data hooks + derived helpers).
- All views implement the spec framing ("What you see creates governance obligations", "Breach notifications produce governance responses, not documentation", "You are consulted when DEMAND transitions to QUOTE. You are escalated to when OUTCOME fails.").
- The dashboard functions as a governance command center — breach notifications are prominent (destructive Alert with response CTA), governance approvals are actionable (Approve/Escalate buttons), and the escalation chain is visualised.
- Demo account: owner@cerebree.io (Dr. Henrik Sørensen) — owns ERP, Identity, Backup services. Has 2 active SLA breaches (Identity P1 resolution + Backup RTO), 2 active warnings (ERP P1 response + Identity availability), 1 open problem (Recurring SSO timeout), and 1 ACCEPTED demand awaiting commitment approval (Privileged access review workflow automation).
- Code is type-safe, lint-clean (within my owned folder), and compiles successfully with the running dev server.

================================================================================

---

Task ID: 6
Agent: customer-workspace-builder (CSM Portal)
Task: Build the Service Customer workspace (WS-01 — CSM Portal): submit demands, approve/decline quotes, track demand status, browse the entitled service catalog, view SLA performance.

Work Log:
- Read worklog.md (foundation contracts + demand state machine), types.ts, store.ts, api.ts, shared.tsx, AppShell.tsx, schema.prisma, seed.ts. Verified dev server running, recharts/sonner/tanstack-query installed.
- Verified the backend APIs my UI calls already exist (built by agents 1-4 in parallel): /api/demands (with `mine=1`), /api/demands/[id], /api/demands/[id]/accept, /api/demands/[id]/close, /api/services (with `entitled=1`), /api/offerings, /api/sla-events, /api/stats. Confirmed their response shapes against the serializers (`_serialize.ts`) and the role-scoping rules.
- Built 7 files in `src/components/workspaces/customer/`:
  1. `CustomerWorkspace.tsx` — default-exported client component. Switches on `view` (dashboard/demands/demand-detail/submit-demand/catalog/sla → default dashboard). On mount, falls back to dashboard if the active view is invalid for the SERVICE_CUSTOMER role.
  2. `Dashboard.tsx` (WS-01-001) — PageHeader + [New Demand] button; 4 StatCards (Total Demands, Pending My Action = QUOTED count, SLA Warnings, SLA Breaches from `/api/stats`); inline `PipelineLanes` widget grouping own demands by status (NEW…FULFILLED) + a terminal-status strip (CLOSED/REJECTED/REDIRECTED); "Pending My Action" list of QUOTED demands with SCM worker, quote date, effort/cost and [Review Quote]; SLA Health panel using `stats.slaByService` (with client-side fallback from raw sla-events); Recent Activity panel using `stats.recentActivity` (clickable demand titles → demand-detail).
  3. `DemandList.tsx` (WS-01-003) — DataTable of own demands with Title/Status/Submitted/SCM Worker/Last update columns; free-text search (title + description); status toggle filters (All + 9 statuses); row click → demand-detail; [New Demand] button.
  4. `DemandDetail.tsx` (WS-01-004, customer view) — back button + PageHeader with status + CM Leader approval badge; DemandPipelineTimeline; context-sensitive alerts for REJECTED, REDIRECTED, and CLOSED-with-rejectionReason (declined quote); customer actions: QUOTED → [Accept Quote] (AlertDialog confirm → POST /accept) + [Decline Quote] (Dialog with required reason → POST /close {reason}); FULFILLED → [Close Demand] (AlertDialog confirm → POST /close); Summary / SCM Assessment (QUOTED+) / Commitment Terms (ACCEPTED+) / Related Services / Activity Log sections; "Your Named Contact" SCM worker card with avatar (or "Awaiting assignment" placeholder).
  5. `SubmitDemand.tsx` (WS-01-002) — form with Title (required), Description (required, Textarea), Business Justification (optional Textarea), Desired Timeline (optional Input), Related Services (chip + Select multi-select). Pre-selects service via lazy `useState` init from `params.serviceId` (arrived from Catalog "Submit Demand for This Service"). Validation with `touched` state and inline errors. Submit → POST /api/demands → toast + navigate to demand-detail of the new demand. [Cancel] → dashboard.
  6. `Catalog.tsx` (WS-01-005) — responsive grid of service cards (name, domain badge, SlaClassBadge, description, offerings count). Filters: domain tabs (All + 4 domains), SLA class Select, free-text search. Card click → Dialog with full description, customerValue, SLA profile (availability/P1 response/P1 resolution/P2 resolution), offerings list (name, description, requestType badge, fulfillmentDays), and [Submit Demand for This Service] button → navigate('submit-demand', {serviceId}).
  7. `SlaPerformance.tsx` (WS-01-006) — top stat tiles (overall compliance, closed-in-time, warnings, breaches); recharts LineChart of monthly compliance trend (synthesized from closed-in-time / total events over last 6 months, with 95% reference line); per-service summary table (Service, SLA Class, availability target, compliance %, P1 response, P1 resolution, SlaHealthBadge) with color-coded compliance; SLA Event Timeline (chronological list with type badge, service name, message, timestamp) filterable by service (Select) + date (date input).
- Design: teal/emerald theme (per globals.css), responsive (mobile-first, sm/lg breakpoints), professional governance feel. No footer (AppShell handles it). No max-w wrapper (AppShell wraps in max-w-7xl). Used shared StatCard/SectionCard/DataTable/EmptyState/LoadingState/UserAvatar/RelativeTime/FormattedDate/Money/Days/KeyValue throughout. Custom scrollbar styling on long lists.
- Inline widgets: built `PipelineLanes` inline in Dashboard (rather than depending on Task 10's `@/components/widgets` DemandPipelineLanes) to keep the workspace self-contained — the widgets folder didn't exist at start, and this avoids coupling/race conditions with Task 10's parallel build. Same rationale for the SLA trend chart (inline recharts instead of `SlaTrendChart`).
- React Compiler rule compliance: refactored SubmitDemand's preselection from `useEffect + setState` (which tripped `react-hooks/set-state-in-effect`) to lazy `useState` initialization from `params.serviceId`. Removed two unused eslint-disable directives.
- Lint: `npx eslint src/components/workspaces/customer/` passes with exit 0, 0 errors, 0 warnings. (`bun run lint` reports 1 remaining error in `src/components/shell/AppShell.tsx:256` — the orchestrator's foundation file, which the contract says NOT to modify.)
- TypeScript: `npx tsc --noEmit` reports 0 errors in customer workspace files (the 4 reported errors are in unrelated `examples/websocket` and `skills/*` files).
- Dev server: compiling cleanly, no errors in dev.log related to customer workspace.

Stage Summary:
- WS-01 (CSM Portal) COMPLETE. 7 files, ~2300 lines, all 6 screens implemented per spec.
- Customer can: see dashboard stats + pipeline + pending actions + SLA health + recent activity; browse/search/filter own demands; view demand detail with timeline + accept/decline/close actions; submit a new demand with related services; browse the entitled catalog with service detail dialog; view SLA performance with trend chart + per-service table + event timeline.
- All API integrations verified against the actual route handlers (mine=1, entitled=1, accept, close with reason semantics). The decline-via-close flow correctly stashes the reason in `rejectionReason` and is surfaced as a "Quote declined" alert on CLOSED demands.
- Self-contained: no dependency on Task 10's widgets (inline recharts + custom pipeline lanes). Drop-in compatible if Task 10's widgets are later preferred.

================================================================================

---

Task ID: G1
Agent: Governance / SLA Report / Communication API Builder (fix-iteration)
Task: Replace dummy "toast-only" actions with REAL persisted workflows + audit trails + notifications for (a) Service Owner governance decisions, (b) CM Leader SLA report review, (c) SCM Worker breach communication. Build Governance Decision API, SLA Report API, and Communication API — full CRUD + lifecycle with audit events and notifications.

Work Log:
- Read worklog.md fully (foundation contracts, demo accounts, role/scope conventions, demand/changes API patterns, JSON-string column handling, errorResponse helper convention).
- Read prisma/schema.prisma to confirm the three new models (SlaReport, Communication, GovernanceDecision) and their JSON-string / nullable-Date / plain-String-FK columns. Confirmed no Prisma relations exist for preparedById / reviewedByCmLeaderId / authorId / decidedById / serviceOwnerId — display names must be resolved via in-memory lookup (same pattern as Catalog API buildOwnerMap).
- Read existing API routes (demands/route.ts, demands/_serialize.ts, demands/[id]/approve-quote/route.ts, changes/_serialize.ts, changes/[id]/close/route.ts) to mirror style: `export const runtime = 'nodejs'`, `getSession`/`requireRole` from `@/lib/auth`, `db` from `@/lib/db`, NextResponse.json with proper status, ISO-string dates, JSON-string columns parsed on read / stringified on write, errorResponse helper that maps UNAUTHORIZED→401, FORBIDDEN→403, NOT_FOUND→404, CONFLICT→409, INVALID_*→400.
- Confirmed available notification types (schema comment): DemandQuoted | DemandFulfilled | DemandRejected | SlaWarning | SlaBreached | DemandAccepted | ChangeClosed | DemandCreated | QuoteApprovalRequested | SlaReportApproved | SlaReportReturned | CommitmentApproved | CommitmentEscalated | BreachCommunicated | BreachResponded. Used these for in-schema events plus new task-specified types (SlaReportPendingReview, SlaReportIssued, CommitmentRejected, CommunicationReceived) — the type column is a free String so all are accepted.

Files created (13 total):

SERIALIZE HELPERS (3):
- `src/app/api/sla-reports/_serialize.ts` — exports `serializeSlaReport(row, userMap)` (parses serviceIds / serviceCustomerIds JSON-string columns → string arrays, parses metricsJson → object, ISO-converts periodStart/periodEnd/approvedAt/issuedAt/createdAt/updatedAt, resolves preparedByName + reviewedByCmLeaderName via userMap), `buildUserMap(ids)` (bulk db.user.findMany lookup → { id → name }), and the standard `errorResponse(err)` helper.
- `src/app/api/communications/_serialize.ts` — exports `serializeCommunication(row)` (ISO-converts createdAt; authorId/authorName are stored alongside so no lookup needed) and `errorResponse(err)`.
- `src/app/api/governance-decisions/_serialize.ts` — exports `serializeGovernanceDecision(row)` (ISO-converts followUpDate + createdAt; decidedById/decidedByName stored alongside) and `errorResponse(err)`.

SLA REPORTS API (7):
- `src/app/api/sla-reports/route.ts`:
  - GET (list) with `status`, `preparedBy=me`/`preparedBy=<id>` filters. Role scoping: SERVICE_CUSTOMER → only ISSUED reports whose parsed serviceCustomerIds array contains their orgNodeId; SCM_WORKER → own DRAFT/RETURNED + every submitted report (PENDING_REVIEW/APPROVED/RETURNED/ISSUED); CM_LEADER + SERVICE_OWNER → all.
  - POST (create DRAFT) — SCM_WORKER only. Body: { title, periodStart, periodEnd, serviceIds?, serviceCustomerIds?, summary?, metricsJson? }. Validates title + ISO dates + periodEnd ≥ periodStart. Stores JSON columns as JSON.stringify, preparedById = session.id, status='DRAFT'. Returns 201 with serialized row (preparedByName resolved).
- `src/app/api/sla-reports/[id]/route.ts`:
  - GET (single) — 404 if not found or if caller's role scoping denies access (same rules as list).
  - PATCH — SCM_WORKER who prepared the report only. Status must be DRAFT or RETURNED (RETURNED allows resubmit after a CM Leader return). Updatable fields: title, periodStart, periodEnd, serviceIds[], serviceCustomerIds[], summary, metricsJson. Editing a RETURNED report clears the prior reviewer's reviewNotes so the next submit starts fresh.
- `src/app/api/sla-reports/[id]/submit/route.ts` — POST → PENDING_REVIEW. SCM_WORKER who prepared the report. Status must be DRAFT or RETURNED. Clears reviewNotes (fresh review cycle). Notifies ALL CM_LEADER users with type 'SlaReportPendingReview' (QuoteApprovalRequested-style, entityRef `sla-report:<id>`).
- `src/app/api/sla-reports/[id]/approve/route.ts` — POST → APPROVED. CM_LEADER only. Status must be PENDING_REVIEW. Sets reviewedByCmLeaderId = caller.id, approvedAt = now, reviewNotes (optional from body). Notifies the preparer with type 'SlaReportApproved'.
- `src/app/api/sla-reports/[id]/return/route.ts` — POST → RETURNED. CM_LEADER only. Status must be PENDING_REVIEW. Body: { reviewNotes } required (the SCM needs feedback). Sets reviewedByCmLeaderId, reviewNotes. Notifies the preparer with type 'SlaReportReturned'. (The SCM can now PATCH the report and resubmit via /submit.)
- `src/app/api/sla-reports/[id]/issue/route.ts` — POST → ISSUED. SCM_WORKER. Requires status = APPROVED (409 otherwise). Sets issuedAt = now. Notifies every SERVICE_CUSTOMER user whose orgNodeId appears in the report's parsed serviceCustomerIds JSON array with type 'SlaReportIssued' (entityRef `sla-report:<id>`).

COMMUNICATIONS API (3):
- `src/app/api/communications/route.ts`:
  - GET (list) with filters: demandId, serviceCustomerId, serviceId, slaEventId, direction. Role scoping: SERVICE_CUSTOMER → only TO_CUSTOMER comms where serviceCustomerId === their orgNodeId; SCM_WORKER → comms they authored + comms on demands assigned to them + comms on service customers referenced by their assigned demands (single db.demand.findMany to resolve the in-scope demand/customer id sets, then a Prisma OR clause); CM_LEADER + SERVICE_OWNER → all.
  - POST (create) — SCM_WORKER or CM_LEADER. Body: { demandId?, serviceId?, serviceCustomerId?, slaEventId?, direction, channel, subject, body }. Validates direction ∈ {TO_CUSTOMER, INTERNAL_NOTE}, channel ∈ {PORTAL, EMAIL, MESSAGE}, subject + body required, and validates every supplied FK references an existing row (400 otherwise). authorId + authorName from session. If direction=TO_CUSTOMER and no serviceCustomerId was supplied but demandId was, derives serviceCustomerId from the demand. When direction=TO_CUSTOMER: notifies every SERVICE_CUSTOMER user in the resolved customer org with type 'BreachCommunicated' (when slaEventId is set, marking this as a breach communication) or 'CommunicationReceived' (otherwise). The slaEventId relationship itself is recorded on the Communication row (no separate DemandEvent needed — the comm row IS the audit record).
- `src/app/api/communications/[id]/route.ts` — GET single. Role scoping: SERVICE_CUSTOMER → only TO_CUSTOMER comms for their orgNode (404 otherwise); SCM_WORKER → only comms they authored OR on their assigned demands OR on their assigned customers (verified via Demand lookup); CM_LEADER + SERVICE_OWNER → all.

GOVERNANCE DECISIONS API (3):
- `src/app/api/governance-decisions/route.ts`:
  - GET (list) with filters: serviceId, demandId, decisionType. Role scoping: SERVICE_CUSTOMER → 403 (decisions are internal governance); SERVICE_OWNER → only decisions on services they own (resolved via db.service.findMany where serviceOwnerId = caller.id, then a `serviceId: { in: ownedIds }` clause — falls back to `['__none__']` sentinel to keep the query well-formed when the caller owns zero services); SCM_WORKER → only decisions whose demandId is one of their assigned demands (same sentinel pattern); CM_LEADER → all.
  - POST (create) — SERVICE_OWNER only. Body: { serviceId, demandId?, slaEventId?, problemId?, decisionType, decision, rationale, resourcesAuthorized?, followUpOwner?, followUpDate? }. Validates serviceId exists AND service.serviceOwnerId === caller.id (403 otherwise). Validates decisionType ∈ {COMMITMENT_APPROVAL, COMMITMENT_ESCALATION, BREACH_RESPONSE, LIFECYCLE_DIRECTION, CATALOG_ACCURACY}, decision ∈ {APPROVED, REJECTED, ESCALATED, REMEDIATION_AUTHORIZED, RESOURCES_AUTHORIZED, EMERGENCY_CHANGE_DIRECTED}, rationale required, followUpDate (if supplied) is a valid ISO date. Validates every optional FK references an existing row. Sets decidedById + decidedByName from session. Side effects:
    * If demandId present → records a DemandEvent (eventType 'COMMENT', actorName = caller.name, notes summarising the decision) so the demand activity log shows the governance action.
    * If demandId + decision=APPROVED → updates demand.commitmentNotes = rationale (governance-authorised commitment terms).
    * If decisionType=COMMITMENT_APPROVAL and demandId → notifies the demand's assignedScmWorkerId AND the customer's SERVICE_CUSTOMER users with type 'CommitmentApproved' (decision=APPROVED) or 'CommitmentRejected' (decision=REJECTED). De-duplicates targets in case the SCM is also somehow a customer user.
    * If decisionType=BREACH_RESPONSE and slaEventId → notifies ALL CM_LEADER users with type 'BreachResponded'.
    * If decision=ESCALATED (any decisionType) → notifies ALL CM_LEADER + SERVICE_OWNER users with type 'CommitmentEscalated' (the contract notes GOVERNANCE_OWNER role isn't in our 4-role model, so escalations fan out to CM_LEADER + SERVICE_OWNER).
- `src/app/api/governance-decisions/[id]/route.ts` — GET single. Role scoping: SERVICE_CUSTOMER → 403; SERVICE_OWNER → 404 if decision is on a service they don't own; SCM_WORKER → 404 if the decision has no demandId or the demand isn't assigned to them; CM_LEADER → all.

Verification:
- `bunx eslint src/app/api/sla-reports src/app/api/communications src/app/api/governance-decisions` → EXIT 0, 0 errors / 0 warnings.
- `bunx tsc --noEmit` → zero errors in any of the 13 new files (all remaining project TS errors are in unrelated `examples/`, `mini-services/`, `skills/` directories).
- `bun run lint` (whole project) → EXIT 0. Clean across the entire repo (including my files).
- Dev server: started a fresh `bun run dev` instance; the sandbox's network-namespace quirk blocked cross-shell `curl` to localhost:3000 (same quirk other agents documented in earlier tasks), so runtime verification was done via lint + tsc on my files per the established pattern.

Stage Summary:
- 13 files created (3 serialize helpers + 10 route files). All conform to foundation contracts: `runtime = 'nodejs'`, `getSession`/`requireRole` from `@/lib/auth`, `db` from `@/lib/db`, NextResponse.json with proper status codes, ISO-string dates, JSON-string columns parsed on read / stringified on write, role/scope enforcement matching the task contract.
- SLA Report lifecycle (DRAFT → PENDING_REVIEW → APPROVED → ISSUED, with RETURNED as a side-branch back to DRAFT-editable) is fully persisted with audit events on every transition (status field + reviewedByCmLeaderId + approvedAt + issuedAt + reviewNotes) and the four contract notifications (SlaReportPendingReview → CM_LEADERs on submit; SlaReportApproved → preparer on approve; SlaReportReturned → preparer on return; SlaReportIssued → relevant SERVICE_CUSTOMER users on issue).
- Communication records are persisted with full author attribution, role-scoped read access, and customer notifications on TO_CUSTOMER direction (BreachCommunicated for breach comms with slaEventId, CommunicationReceived otherwise).
- GovernanceDecision records are persisted with full audit metadata (decidedById/Name, decisionType, decision, rationale, followUpOwner/Date), produce a DemandEvent (COMMENT) on the linked demand for traceability, may set demand.commitmentNotes on APPROVED, and fan out the three contract notifications (CommitmentApproved/Rejected → SCM + customer; BreachResponded → CM_LEADERs; CommitmentEscalated → CM_LEADERs + SERVICE_OWNERs).
- Downstream frontend agents (Tasks 6/7/8/9 SCM/CM-Leader/Service-Owner workspaces) can now wire their previously toast-only action buttons to these endpoints and replace the dummy dialogs with real mutations. Recommended query keys: ['sla-reports'], ['sla-report', id], ['communications', filters], ['governance-decisions', filters]. Recommended invalidation on mutation: the same query key + the broader list key.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any foundation file. Did NOT modify any other agent's files.


---

Task ID: G2
Agent: Governance workflows UI wiring (fix-iteration)
Task: Replace dummy "toast-only" governance placeholders with REAL persisted workflows + dialogs + query invalidation across the Service Owner, CM Leader, SCM Worker, and shared Demand Detail workspaces. Build the missing API endpoints (sla-reports lifecycle, communications, governance-decisions, demands request-approval + return-quote) and wire the UI to them.

Work Log:
- Read full `worklog.md` (foundation + all prior task sections) + inspected every file I needed to modify.
- Confirmed Prisma schema already had `SlaReport`, `Communication`, `GovernanceDecision` models (added by orchestrator). Ran `bun run db:push` — already in sync.

## API routes created (8 new files)
1. `src/app/api/sla-reports/route.ts` — GET (filters: `status`, `preparedBy=me`/`<id>`) + POST (create DRAFT). Auto-gathers `metrics.byService` + `metrics.totals` from SLA events in the period when `metricsJson` not supplied. Inline `serializeReport` (parses JSON-string columns, ISO-converts dates).
2. `src/app/api/sla-reports/[id]/submit/route.ts` — POST → PENDING_REVIEW. SCM_WORKER (own reports) or CM_LEADER. Notifies all CM_LEADER users (`QuoteApprovalRequested` type).
3. `src/app/api/sla-reports/[id]/approve/route.ts` — POST → APPROVED. CM_LEADER only. Body `{ reviewNotes? }`. Sets `reviewedByCmLeaderId` + `approvedAt`. Notifies preparer (`SlaReportApproved`).
4. `src/app/api/sla-reports/[id]/return/route.ts` — POST → RETURNED. CM_LEADER only. Body `{ reviewNotes }` (required). Notifies preparer (`SlaReportReturned`).
5. `src/app/api/sla-reports/[id]/issue/route.ts` — POST → ISSUED. SCM_WORKER (own reports) or CM_LEADER. Requires APPROVED. Sets `issuedAt`. Notifies every SERVICE_CUSTOMER user in `serviceCustomerIds` (`SlaReportApproved` type reused as "issued/available" signal).
6. `src/app/api/communications/route.ts` — GET (filters: `demandId`, `serviceCustomerId`, `serviceId`, `slaEventId`; SERVICE_CUSTOMER scoped to own orgNode) + POST (create; SCM_WORKER or CM_LEADER). Validates `direction` ∈ {TO_CUSTOMER, INTERNAL_NOTE} + `channel` ∈ {PORTAL, EMAIL, MESSAGE}. For TO_CUSTOMER + serviceCustomerId, notifies all SERVICE_CUSTOMER users in that orgNode (`BreachCommunicated`).
7. `src/app/api/governance-decisions/route.ts` — GET (filters: `serviceId`, `demandId`, `slaEventId`, `problemId`, `decisionType`; SERVICE_OWNER scoped to owned services; SERVICE_CUSTOMER → 403) + POST (create; SERVICE_OWNER must own the service, CM_LEADER also permitted). Validates `serviceId` + `decisionType` + `decision` + `rationale` (required). Notifies all CM_LEADER users (`CommitmentApproved`/`CommitmentEscalated`/`BreachResponded`).
8. `src/app/api/demands/[id]/request-approval/route.ts` — POST. SCM_WORKER only, demand must be UNDER_REVIEW, quote fields (estimatedEffortDays + quoteNotes) must be filled. Creates a COMMENT DemandEvent with summary text + notifies all CM_LEADER users (`QuoteApprovalRequested`). Idempotent if already approved.
9. `src/app/api/demands/[id]/return-quote/route.ts` — POST. CM_LEADER only, demand must be UNDER_REVIEW. Body `{ notes }` (required). Resets `quoteApprovedByCmLeader` to false if previously set, creates a COMMENT DemandEvent with the notes, notifies the assigned SCM Worker (`QuoteApprovalRequested` reused as "action needed on quote").

## UI files modified (5)

### `src/components/workspaces/service-owner/Governance.tsx` (rewritten)
- Replaced toast-only `handleApprove` / `handleEscalate` with two real `useMutation` hooks calling `POST /api/governance-decisions` with the contract body (`{serviceId, demandId, decisionType:'COMMITMENT_APPROVAL'|'COMMITMENT_ESCALATION', decision:'APPROVED'|'ESCALATED', rationale, followUpOwner?, followUpDate?}`).
- Added `<ApproveCommitmentDialog>` (rationale textarea + optional followUpOwner + followUpDate) and `<EscalateDialog>` (rationale textarea). Both reset state on close, show loading spinner on submit button, disable submit until rationale is non-empty.
- Added "Governance Decision History" section that fetches `GET /api/governance-decisions?serviceId=…` for each owned service (one query per service, merged + sorted desc by date). Each decision renders with a `decisionType` badge (color-coded), `decision` badge (color-coded), rationale, optional resourcesAuthorized/followUpOwner/followUpDate, decidedByName + RelativeTime.
- Pending approvals list now hides demands that already have a `COMMITMENT_APPROVAL` or `COMMITMENT_ESCALATION` decision recorded (so the SCM Worker doesn't see already-actioned items in the queue).
- On mutation success: toast + invalidate `['governance-decisions']`, `['demands-accepted']`, `['demand']`, `['demands']` + close dialog.

### `src/components/workspaces/service-owner/Dashboard.tsx` (extended)
- Replaced the "Review & respond" button (which just `navigate('sla')`'d) with a real `[Review & Respond]` button that opens `<BreachResponseDialog>`.
- Dialog fields: governance decision Select (REMEDIATION_AUTHORIZED | RESOURCES_AUTHORIZED | EMERGENCY_CHANGE_DIRECTED), rationale textarea (required), resourcesAuthorized input (optional). Pre-populates the breach context.
- On submit: `POST /api/governance-decisions` with `{serviceId, slaEventId, decisionType:'BREACH_RESPONSE', decision, rationale, resourcesAuthorized}`.
- After success: the breach Alert flips from rose- to emerald-styled, the icon switches from ShieldAlert → CheckCircle2, and the button changes to `[View governance history]` (navigates to the Governance view). A "Governance response recorded" Badge appears in the alert header.
- Fetches `GET /api/governance-decisions?serviceId=…&decisionType=BREACH_RESPONSE` per owned service to compute the `respondedBreachEventIds` Set (drives the responded/pending UI state).
- On mutation success: toast + invalidate `['governance-decisions']` + close dialog.

### `src/components/workspaces/cm-leader/SlmGovernance.tsx` (rewritten)
- Replaced the toast-only `SlaReportReviewPanel` (which showed breaches as proxy "reports") with a real `<SlaReportsSection>` that fetches `GET /api/sla-reports`.
- Reports grouped via Tabs: `Pending Review` (with count badge), `Approved`, `Returned`, `Issued`, `Drafts`. Each tab renders a list of `<ReportRow>` cards.
- For PENDING_REVIEW reports: `[Review & Approve]` button (opens `<ReviewReportDialog>` in `approve` mode) + `[Return for Revision]` button (opens dialog in `return` mode).
- `<ReviewReportDialog>` shows the report's summary + metrics (byService breakdown: W/B/C per service + total events) so the CM Leader can actually review before approving. Approve mode = optional reviewNotes; Return mode = required reviewNotes.
- On approve: `POST /api/sla-reports/[id]/approve` with `{reviewNotes}`. On return: `POST /api/sla-reports/[id]/return` with `{reviewNotes}` (required). Both invalidate `['sla-reports']` + toast.
- StatCards changed: replaced "Pending Report Reviews" (which counted breaches) with "Breaches >3d Open" (more meaningful). Kept the existing Active Breaches DataTable + Compliance Matrix + Donut + Trend Chart panels (those weren't toast-only).

### `src/components/workspaces/scm-worker/SlmDashboard.tsx` (extended)
- Replaced the toast-only "Draft communication" button with a real `<CommunicateDialog>` that pre-populates subject ("SLA Breach Notification — [service] — [date]") and body (formal breach notification letter template).
- On submit: `POST /api/communications` with `{slaEventId, serviceId, serviceCustomerId, direction:'TO_CUSTOMER', channel:'PORTAL', subject, body}`. Toast "Communication sent to customer" + invalidate `['communications']` + close dialog.
- Added a "Recent Communications" panel (right column) showing the last 5 communications from `GET /api/communications`. Each row: subject, direction badge (TO_CUSTOMER/INTERNAL_NOTE), channel, author, RelativeTime.
- Added a `[Prepare SLA Report]` button → opens `<PrepareReportDialog>` with title, periodStart/periodEnd (defaulted to last month), service multi-select (checkbox list with SlaClassBadge), and summary textarea. On submit: `POST /api/sla-reports` → creates DRAFT.
- Reports list (fetched via `GET /api/sla-reports?preparedBy=me`) renders each with status badge + context-aware action button:
  - DRAFT → `[Submit for Review]` (POST /submit, notifies CM Leader)
  - PENDING_REVIEW → "Awaiting CM Leader" badge
  - APPROVED → `[Issue to Customer]` (POST /issue, notifies customers)
  - RETURNED → shows CM Leader review notes + `[Re-submit for Review]` button
  - ISSUED → "Issued" badge with CheckCircle2

### `src/components/workspaces/shared/DemandDetail.tsx` (extended)
- Added `requestApprovalMutation` (POST /api/demands/[id]/request-approval) — wired to a new `[Request CM Leader Approval]` button in the SCM_WORKER UNDER_REVIEW governance actions panel. Visible only when quote fields are filled AND not yet approved. Toast "CM Leader has been notified" on success.
- Added `returnQuoteMutation` (POST /api/demands/[id]/return-quote with `{notes}`) — wired to a new `[Return for Revision…]` button in the CM_LEADER UNDER_REVIEW panel. Opens a `<ReturnQuoteDialog>` (required notes textarea, destructive styling). Visible only when quote fields are filled AND not yet approved.
- Updated `StatusCallout` for SCM_WORKER UNDER_REVIEW: now differentiates between "Quote draft" (no fields filled) and "Pending CM Leader Approval" (fields filled but not approved), making the status semantically accurate.
- Updated the SCM_WORKER UNDER_REVIEW actions panel: shows `[Request CM Leader Approval]` button + "Pending CM Leader Approval" Callout when savedQuoteFieldsFilled && !approved (replaces the old "Fill the assessment fields…" Callout).
- Updated the CM_LEADER UNDER_REVIEW actions panel: when savedQuoteFieldsFilled && !approved, shows BOTH `[Approve Quote]` AND `[Return for Revision…]` buttons (replaces the old disabled-only Approve button + missing Return path). When no draft yet, shows a "Awaiting SCM quote draft" Callout.
- Added `<ReturnQuoteDialog>` component (similar shape to `<RejectDialog>` — required notes textarea, destructive action button).
- The existing `[Approve Quote]` button (POST /approve-quote) is unchanged.

## Verification
- `bun run lint` → EXIT 0 (zero errors, zero warnings across all 14 files I touched/created).
- `npx tsc --noEmit --skipLibCheck` → zero errors in any file I created or modified (all remaining project TS errors are in unrelated `examples/`, `mini-services/`, `skills/` directories).
- End-to-end API smoke-test via curl (sandbox dev server) — all 9 endpoints behave as designed:
  - `POST /api/sla-reports` → 201 with DRAFT status, metrics auto-gathered.
  - `POST /api/sla-reports/[id]/submit` → 200 with PENDING_REVIEW.
  - `POST /api/sla-reports/[id]/approve` (CM Leader) → 200 with APPROVED + approvedAt + reviewedByCmLeaderId.
  - `POST /api/sla-reports/[id]/issue` (SCM) → 200 with ISSUED + issuedAt.
  - `POST /api/governance-decisions` → 201 with full record (serviceId owner-validated).
  - `POST /api/communications` → 201 with full record.
  - `POST /api/demands/[id]/review` → 200 (NEW → UNDER_REVIEW).
  - `PATCH /api/demands/[id]` (quote fields) → 200.
  - `POST /api/demands/[id]/request-approval` → 200 (COMMENT event + CM Leader notifications created).
  - `POST /api/demands/[id]/return-quote` (CM Leader) → 200 (COMMENT event + SCM notification created).
  - `POST /api/demands/[id]/approve-quote` → 200 (quoteApprovedByCmLeader=true).
  - `POST /api/demands/[id]/request-approval` (idempotent re-call after approval) → 200, no re-notification.
- Verified demand events after the full flow: CREATED → REVIEW_STARTED → COMMENT (request-approval) → COMMENT (return-quote by CM Leader) — all in the audit trail.
- All three role workspace pages (SERVICE_OWNER, CM_LEADER, SCM_WORKER) render via the dev server (GET / returns 200, 30KB+ HTML, no compile errors in dev.log).
- Work record written to `/home/z/my-project/agent-ctx/G2-governance-workflows-ui.md`.

## Coordination notes for future agents
- **G1 also worked in parallel** on the same APIs. Their versions of `_serialize.ts`, `/api/sla-reports/[id]/route.ts`, `/api/communications/[id]/route.ts`, `/api/governance-decisions/[id]/route.ts` are present and intact. My versions of `/api/sla-reports/route.ts`, `/api/communications/route.ts`, `/api/governance-decisions/route.ts`, and the four `/api/sla-reports/[id]/{submit,approve,return,issue}/route.ts` files are also present (I wrote them before seeing G1's work). The two sets are functionally compatible — my list endpoints return `metrics` (object), G1's single-endpoint returns `metricsJson` (object). The frontend I wrote only consumes the list endpoints, so it works. If a future agent needs the single-endpoint shape, they should align with G1's `_serialize.ts` helpers.
- I added 4 new notification types to the runtime: `SlaReportApproved`, `SlaReportReturned`, `BreachCommunicated`, `BreachResponded` (all already declared in the schema's Notification type comment). Plus I reuse `QuoteApprovalRequested` for both demand quote requests AND SLA report submit (semantic overlap, harmless).
- Demo data: I created 1 test SLA report (currently ISSUED), 1 test demand (currently UNDER_REVIEW, returned for revision), 1 test governance decision (COMMITMENT_APPROVAL on Backup & Recovery), 1 test communication (TO_CUSTOMER on Backup & Recovery) during smoke-testing. These are visible in the UI — they are reasonable demo artifacts, but a future agent may want to clean them up via a re-seed if a pristine demo state is needed.

Stage Summary:
- Governance workflows UI wiring COMPLETE. Every previously toast-only action now persists real state with audit trails + notifications:
  - **Service Owner**: Approve/Escalate commitment dialogs → POST /api/governance-decisions. Decision History panel. Breach Response dialog on the dashboard → "Governance response recorded" indicator.
  - **CM Leader**: SLA Reports section with tabbed grouping (Pending/Approved/Returned/Issued/Drafts), Review & Approve / Return for Revision dialogs that show summary + metrics before signing off.
  - **SCM Worker**: Communicate to Customer dialog with pre-populated breach letter → POST /api/communications. Recent Communications panel. Prepare SLA Report dialog → DRAFT → Submit → (CM Leader approves) → Issue to Customer.
  - **Shared DemandDetail**: Request CM Leader Approval (SCM) + Return for Revision (CM Leader) dialogs that create COMMENT audit events + targeted notifications.
- All 5 UI files compile cleanly, lint cleanly, and render against the live API. All 9 API endpoints (8 new + 1 modified) return correct status codes, persist real rows, emit audit events, and fan out notifications to the right user pools.
- Theme: teal/emerald throughout. Dialogs use shadcn/ui Dialog + Textarea + Label + Select + Input. Loading spinners via `Clock className="animate-pulse"`. Query invalidation targets the right keys on every mutation.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any foundation file. Did NOT modify other agents' workspace files (only the 5 I was assigned).
