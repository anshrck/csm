# P8-ROUTING-UX — URL-based Routing + Queue/Work Management UX

Task ID: P8-ROUTING-UX
Agent: Routing + Queue UX Builder
Task: Implement Phase 8 items 19 (URL-based routing) and 20 (queue/work management UX) from the plan.

## Files created

### Routing core (Phase 8 item 19)
- `src/lib/routing.ts` — URL helpers:
  - `ROLE_PREFIX: Record<Role, string>` (SERVICE_CUSTOMER→customer, SCM_WORKER→scm, CM_LEADER→cm, SERVICE_OWNER→owner)
  - `PREFIX_ROLE` reverse lookup
  - `VIEW_PATH: Record<ViewKey, string>` — maps every ViewKey to a path segment. Detail views reuse their parent list path so URLs read as `/scm/demands/abc123`. Includes `tickets` / `ticket-detail`, plus `reports` and `knowledge` (added by other agents).
  - `DETAIL_VIEWS` map — `/demands/<id>` → demand-detail, `/changes/<id>` → change-detail, `/tickets/<id>` → ticket-detail.
  - `pathToView(slug)` — parses `string[]` slug → `{ view, params, prefix, unknownRole }`.
  - `viewToPath(role, view, params)` — builds a URL. Detail views emit `/<prefix>/<list>/<id>`. Extra params become query-string.
  - `dashboardPath(role)` convenience + `isWorkspacePath(pathname)` guard.
- `src/app/[...slug]/page.tsx` — catch-all workspace route:
  - Client component. Unwraps `params` Promise with `React.use()` (Next.js 16 requirement for client components).
  - Hydrates session via `/api/auth/me` (independent of `/` so deep-links work).
  - Auth + role-prefix guard: unauthenticated → `router.replace('/')`; mismatched prefix → `router.replace('/<role>/dashboard')`.
  - URL → store sync effect: on `slug` change (browser back/forward / deep-link / refresh), calls `syncFromUrl(slug)`. Uses a `pushedRef` to skip re-sync when the slug change came from our own `router.push`.
  - Store → URL push effect: on `view`/`params`/`navTick` change, computes the expected URL and calls `router.push` if it doesn't already match.
  - Renders the same AppShell + workspace + AiPanel + GlobalSearch + RoleGuidePanel as the original `/page.tsx` did.
- `src/app/page.tsx` — rewritten as a thin entry:
  - Hydrates session.
  - If unauthenticated → `<LoginScreen/>`.
  - If authenticated → `router.replace(dashboardPath(role))` and renders a brief loader during the redirect.
  - Login flow unchanged: `LoginScreen` calls `setSession`, which fires this redirect effect.

### Store updates (Phase 8 item 19)
- `src/lib/store.ts`:
  - Added `tickets` and `ticket-detail` to `ViewKey` (Phase 2 ticket domain integration).
  - Added `navTick: number` counter. Bumps on every `navigate()` call so subscribers can detect in-app navigations.
  - `navigate()` now bumps `navTick` (so the catch-all route's effect can fire even when navigating to the same view with new params).
  - Added `syncFromUrl(slug)` action — parses `slug` via `pathToView()` and sets `view` + `params` (without bumping navTick — this is for URL-driven updates only).

### AppShell updates (Phase 8 item 19)
- `src/components/shell/AppShell.tsx`:
  - Sidebar nav buttons call `navigate(view)` — the URL push is handled by the catch-all route's effect via the store subscription.
  - `handleLogout` now calls `router.replace('/')` after `logout()` so the user lands on the login screen rather than staying on a stale `/<role>/...` URL.
  - `useRouter` imported and used in `TopBar`.

### Queue UX components (Phase 8 item 20)
- `src/components/workspaces/shared/SavedFilters.tsx`:
  - Generic `<SavedFilters<F>>` component: built-in presets + custom-saved presets persisted to `localStorage[storageKey]`.
  - Preset button highlights when active. Hover tooltip via shadcn `Tooltip`.
  - "Save current" button (visible when `isCustom`) → inline name input → saves to localStorage.
  - Custom presets show with a `Star` icon and a `X` delete button.
  - Exports `PresetFilters<F>` interface, `DEMAND_PRESETS` (the six presets from the plan: My Open Work / Unassigned / Breaching Soon / Waiting Customer / Pending Approval / Accepted Needs Change), `DemandQueueFilters` interface, `filtersEqual()` + `matchPreset()` helpers.
- `src/components/workspaces/shared/QueueControls.tsx`:
  - `<QueueControls>` header: sort dropdown (Age / Priority / SLA Due / Customer / Owner), filter chips with remove buttons, view toggle (table/card), bulk action bar.
  - `SORT_OPTIONS` constant + `SortKey` type.
  - `ViewMode = 'table' | 'card'` type.
  - `FilterChip` interface + `BulkAction` interface.
  - `<AgingBadge createdAt>` — colour-coded age badge (neutral <3d, amber 3-5d, red >5d) with `Clock` icon.
  - `<OverdueSlaIndicator overdue>` — rose "SLA overdue" badge.
  - `<SelectAllCheckbox>` + `<RowCheckbox>` — drop-in checkbox cells for queue tables.
  - Sort helpers: `sortByAge`, `sortByPriority`, `sortByCustomer`, `sortByOwner` (generic over row shape).

### Queue wiring (Phase 8 item 20)
- `src/components/workspaces/scm-worker/DemandQueue.tsx` — rewritten:
  - Wires `SavedFilters` + `QueueControls`.
  - Full filter state: search + status multi-toggle + unassigned/mine/breachingSoon/waitingCustomer/pendingApproval/acceptedNeedsChange switches.
  - Filter chips derived from active filters with one-tap removal.
  - Sort + table/card view toggle.
  - Row checkboxes + bulk "Pick up selected" action (assigns all selected to the current SCM Worker).
  - Aging badge + SLA breach badge on each row.
  - SLA breach detection via `/api/sla-events` (joins to demand.relatedServiceIds).
  - Card view as a 1/2/3-column responsive grid.
- `src/components/workspaces/cm-leader/DemandQueue.tsx` — rewritten:
  - Same SavedFilters + QueueControls pattern.
  - Bulk actions for CM_LEADER: "Assign to…" (opens a worker-picker dialog with workload counts) and "Approve quotes" (bulk POST `/api/demands/[id]/approve-quote`).
  - Worker + customer select filters in addition to the shared presets.
  - Aging badge + SLA breach badge on each row.
  - Card view + table view toggle.
- `src/components/workspaces/customer/DemandList.tsx` — rewritten:
  - Customer-facing subset of presets (excludes internal-only "Unassigned" and "Pending Approval"; rewrites "My Open Work" to mean "all my open demands").
  - SavedFilters + QueueControls + AgingBadge + SLA breach badge.
  - Table + card view toggle.
- `src/components/workspaces/shared/TicketQueue.tsx` — NEW shared queue page for tickets:
  - Drop-in wrapper for SCM_WORKER and CM_LEADER workspaces.
  - Uses the same SavedFilters + QueueControls primitives as the demand queues.
  - Ticket-specific presets: My Open Work / Unassigned / Breaching Soon / Waiting Customer / P1-P2.
  - Priority badge (P1 rose, P2 amber, P3 sky, P4 muted) + AgingBadge + OverdueSlaIndicator on each row.
  - Bulk "Assign to…" action via `/api/tickets/[id]` PATCH.
  - Routes clicks to `navigate('ticket-detail', { id })` (gracefully no-ops if the workspace doesn't yet handle that view).
  - Table + card view toggle.
  - Other agents building the Ticket workspace can adopt this component directly by rendering `<TicketQueue />` in their workspace switch.

### Shared types
- `src/components/shared.tsx`:
  - `Column<T>.header` widened from `string` to `React.ReactNode` so queue tables can render a `<SelectAllCheckbox>` in the header cell. Backwards-compatible (string is still assignable).

## Routing design notes

### URL ⇄ store feedback loop
The catch-all page uses a `pushedRef` to break the cycle:
1. User clicks sidebar nav → `navigate(view)` → store updates + `navTick` bumps.
2. The catch-all's store→URL effect fires → `pushedRef = true` → `router.push(expectedPath)`.
3. URL changes → Next.js re-renders the page with new `slug` prop.
4. The URL→store effect fires → sees `pushedRef === true` → clears the ref and skips re-sync.

When the user hits browser back/forward:
1. URL changes (no `router.push` from us) → Next.js re-renders with new `slug`.
2. The URL→store effect fires → `pushedRef === false` → calls `syncFromUrl(slug)` → store updates.
3. The store→URL effect fires → computes expected path → it already matches `pathname` → no push.

This avoids infinite loops while keeping the URL and store in sync.

### Next.js 16 `params` is a Promise
The catch-all page is a client component (`'use client'`). In Next.js 16, `params` is a Promise and must be unwrapped with `React.use()` (or `await` in a server component) before accessing its properties. The page unwraps it once at the top: `const { slug } = use(params);` — then uses `slug` everywhere (in hooks, render, etc.).

### Detail views reuse list paths
- `demand-detail` → `/demands/<id>` (same segment as the `demands` list)
- `change-detail` → `/changes/<id>`
- `ticket-detail` → `/tickets/<id>`

`pathToView()` uses `DETAIL_VIEWS` to map the URL back to the detail ViewKey when an `id` segment is present. `viewToPath()` appends the `id` segment for the three detail ViewKeys.

## Verification

- `bun run lint` → EXIT 0 (zero errors, zero warnings across all 11 files I created/modified).
- Dev server smoke tests (curl):
  - `GET /` → 200 (renders LoginScreen when unauthenticated)
  - `GET /scm/dashboard` → 200
  - `GET /scm/demands` → 200
  - `GET /cm/dashboard` → 200
  - `GET /cm/approvals` → 200 (plan-specified URL)
  - `GET /customer/dashboard` → 200
  - `GET /customer/demands` → 200
  - `GET /customer/demands/test-id-123` → 200 (deep-link to detail)
  - `GET /owner/dashboard` → 200
  - `GET /owner/services` → 200 (plan-specified URL — corresponds to `portfolio` view)
  - `GET /owner/problems` → 200
- Authenticated smoke test (login as customer, then GET /customer/demands) → 200, page mounts the React shell that fetches data client-side.
- No new errors in `dev.log` after the Next.js 16 `params` Promise fix.

## Coordination notes

- **TicketList/TicketQueue**: The plan and task description assumed a `TicketList` might be built by another agent. None was present in `src/components/workspaces/`, so I created `shared/TicketQueue.tsx` as a self-contained, drop-in queue page. Other agents building the ticket workspace can render `<TicketQueue />` directly in their `ScmWorkerWorkspace`/`CmLeaderWorkspace` switch under the `tickets` view key. The `ticket-detail` ViewKey is wired into the routing + store but no detail component exists yet — future agent work.
- **ViewKey extensions**: I added `tickets` and `ticket-detail` to `ViewKey` and to `VIEW_PATH` / `DETAIL_VIEWS` in `src/lib/routing.ts`. The `reports` and `knowledge` ViewKeys (added by other agents) are already in both maps — confirmed intact.
- **`Column<T>.header` type widening**: Changed from `string` to `React.ReactNode` in `src/components/shared.tsx`. This is fully backwards-compatible (strings are still valid) but allows queue tables to render checkboxes / icon buttons in the header cell. All existing consumers continue to compile.
- **AppShell logout flow**: Now calls `router.replace('/')` after `logout()`. The catch-all page would have redirected to `/` itself once `session` becomes null, but doing it explicitly in `handleLogout` avoids a flash of the workspace loader.
- **Login redirect**: After successful login (in `LoginScreen`), `setSession()` is called → `Home` (`/page.tsx`) re-renders → its `useEffect` sees `session` and calls `router.replace(dashboardPath(role))`. No changes were needed in `LoginScreen.tsx`.
- **Cross-role URL access**: If a logged-in customer hits `/scm/demands`, the catch-all page's auth+role effect calls `router.replace('/customer/dashboard')`. This happens client-side after hydration, so curl sees 200 on the original URL — a real browser will redirect. The page renders a brief "Redirecting to your workspace…" loader during the redirect.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any other agent's API routes or workspace files (other than the queue pages I was explicitly assigned to update).
