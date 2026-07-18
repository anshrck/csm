# EWR-C — Stats Endpoint Split + Dashboard Operationalisation

**Task ID**: EWR-C
**Agent**: Enterprise Workflow Review — Stats + Dashboards
**Plan item**: #12 (split single `/api/stats` into 6 domain-specific endpoints + expand all 4 role dashboards from demand-only to full service operations)

## Summary

- Split the single demand-centric `/api/stats` endpoint into 6 role-scoped, domain-specific endpoints (overview / tickets / demands / sla / workload / customer-health).
- Refactored the original `/api/stats` route to be a backward-compatible aggregator that calls the same underlying compute functions — existing dashboard consumers continue to work without modification.
- Expanded all 4 role dashboards (Customer / SCM Worker / CM Leader / Service Owner) from demand-only to full service operations: tickets, SLA clocks, CSAT, workload, customer health.

## Files created (8)

### `src/app/api/stats/_scope.ts`
Shared role-scope resolver + ready-to-use Prisma `where` clauses for tickets, demands, SLA events, SLA clocks. Re-uses the existing `getAssignedCustomerOrgIds` helper from `@/lib/entity-access` for SCM customer scoping. Each domain's `where` clause follows the contract:
- `SERVICE_CUSTOMER` → own orgNode
- `SCM_WORKER` → assigned-to-me + unassigned + assigned customer orgs (CustomerAssignment)
- `CM_LEADER` → all tenant
- `SERVICE_OWNER` → services they own (or demands touching owned services, filtered client-side because SQLite can't query the JSON-encoded `relatedServiceIds` field server-side)

### `src/app/api/stats/_compute.ts`
Pure data-aggregation layer. Exports 6 compute functions, each taking a resolved `StatsScope` and returning a JSON-serialisable domain payload:
- `computeOverview(scope)` — totalOpenTickets, totalActiveDemands, slaBreaches, slaWarnings, avgCsat, reopenRate, workloadByWorker (top 5; CM_LEADER only).
- `computeTickets(scope)` — byStatus / byPriority / byType (with all enum keys defaulted to 0), unassigned, waitingCustomer, reopened (via TicketEvent REOPENED), avgResolutionMins (from SlaClock RESOLUTION metAt - startedAt), slaBreached (tickets with BREACHED clock), aging buckets (0-1d / 1-3d / 3-7d / 7-14d / 14d+).
- `computeDemands(scope)` — byStatus, pipeline array, pendingApprovals (UNDER_REVIEW with quote fields filled but quoteApprovedByCmLeader=false), awaitingCustomer, inChange, fulfilled, avgCycleDays (createdAt → closedAt for CLOSED demands).
- `computeSla(scope)` — compliancePct (MET / (MET + BREACHED)), activeBreaches (BREACHED clocks), activeWarnings (unresolved WARNING SlaEvents), byService (per-service compliance + breaches + warnings), avgResponseMins, avgResolutionMins.
- `computeWorkload(scope)` — CM_LEADER only; byWorker (workerId, workerName, avatarColor, activeTickets, activeDemands, slaRisk, openP1), byGroup (assignment groups with active ticket counts), unassignedCount, overdueCount. Returns empty arrays for non-CM_LEADER roles (workload oversight requires tenant-wide visibility).
- `computeCustomerHealth(scope)` — byCustomer array with { orgNodeId, orgNodeName, openTickets, activeDemands, slaBreaches, avgCsat, healthScore, health }. healthScore = slaScore * 0.6 + csatScore * 0.4 where slaScore = 100 - min(100, breaches * 10) and csatScore = avgCsat == null ? 75 : avgCsat/5*100. Green ≥80, Amber 60-80, Red <60. SERVICE_OWNER sees only customers consuming their services (tickets + demands scoped to owned services).

### `src/app/api/stats/overview/route.ts`
Thin GET handler that calls `computeOverview`.

### `src/app/api/stats/tickets/route.ts`
Thin GET handler that calls `computeTickets`.

### `src/app/api/stats/demands/route.ts`
Thin GET handler that calls `computeDemands`.

### `src/app/api/stats/sla/route.ts`
Thin GET handler that calls `computeSla`.

### `src/app/api/stats/workload/route.ts`
Thin GET handler that calls `computeWorkload`.

### `src/app/api/stats/customer-health/route.ts`
Thin GET handler that calls `computeCustomerHealth`.

## Files modified (5)

### `src/app/api/stats/route.ts` (rewritten)
The original demand-centric aggregator is now a backward-compatible wrapper that calls the new compute functions in parallel (`computeOverview` + `computeTickets` + `computeDemands` + `computeSla`, plus `computeWorkload` for CM_LEADER) and re-shapes the data into the original `DashboardStatsResponse` contract (so existing UI consumers — Customer Dashboard / CM Leader Dashboard — keep working without modification). New blended overview fields (`totalOpenTickets`, `totalActiveDemands`, `avgCsat`, `reopenRate`) are included as a superset; clients that ignore them are unaffected. The legacy `slaByService` array is synthesised from `SlaStats.byService` (mapping compliance + breaches/warnings → the legacy `{health, events}` shape); `workloadByWorker` maps from the new shape (passing through `activeTickets` / `openP1` as a superset); `recentActivity` + `openChanges` continue to be computed directly because they aren't part of the 6 split endpoints.

### `src/components/workspaces/customer/Dashboard.tsx` (rewritten)
Now fetches from `/api/stats/overview` + `/api/stats/tickets` + `/api/stats` (legacy aggregator for slaByService + recentActivity). New 5-card row: **My Open Tickets · Waiting for My Response · SLA Breached · SLA At Risk · My Active Demands**. New panels:
- **My Open Tickets** — open tickets raised by the customer's org, sorted by SLA due date, with priority dot + SLA status pill (Breached / Due Xh / Met).
- **Waiting for My Response** — tickets in WAITING_CUSTOMER status with [Reply] button.
- **Recent Support Messages** — latest TO_CUSTOMER communications (author avatar + subject + body snippet).
- **Recommended Knowledge** — 3 most recently published knowledge articles (title + snippet + service).
Existing Demand Pipeline, Pending My Action, SLA Health, and Recent Activity panels retained.

### `src/components/workspaces/scm-worker/Dashboard.tsx` (rewritten)
Now fetches from `/api/stats/overview` + `/api/stats/tickets` + `/api/stats/demands`. New 5-card row: **My Assigned Tickets · Unassigned for My Customers · SLA Due Soon · Waiting Customer · Demands Pending Action**. New panels:
- **My Ticket Queue** — tickets assigned to me, sorted by SLA due date.
- **SLA Due Soon** — running SLA clocks with dueAt within the next 2 hours (or already overdue). Each row shows ticket number, priority dot, title, customer, service, clock type, and "Xm left" / "Xm over" badge.
- **Unassigned for My Customers** — unassigned NEW/TRIAGED tickets in the SCM's customer scope with [Take] button (calls PATCH `/api/tickets/[id]/assign`).
Existing My Queue (kanban), My Workload, Unassigned Demands, Awaiting Customer Action, Change Status Feed, and SLA Health Snapshot panels retained.

### `src/components/workspaces/cm-leader/Dashboard.tsx` (rewritten)
Now fetches from `/api/stats/overview` + `/api/stats/tickets` + `/api/stats/demands` + `/api/stats/workload` + `/api/sla-clocks` + `/api/surveys`. New 5-card row: **Breach Risk · Aging Backlog · Workload Imbalance · Quote Approvals · CSAT Follow-ups**. New panels:
- **Breach Risk** — BREACHED + overdue RUNNING SLA clocks across the tenant (sorted by severity).
- **Aging Backlog** — 5 age-bucket tiles (0-1d / 1-3d / 3-7d / 7-14d / 14d+) populated from `/api/stats/tickets.aging`, plus a list of the oldest open tickets beyond the 3-day threshold.
- **Workload by Worker** — `WorkloadBars` widget (from `@/components/widgets`) fed by `/api/stats/workload.byWorker`, plus a 2-stat footer showing unassigned + overdue counts.
- **CSAT Low-Score Follow-ups** — detractor surveys (rating ≤ 3) with star icon, rating, customer name, comment snippet, and entity-type deep-link.
Existing Quote Approval Queue, Unassigned Demands (with worker-picker), Awaiting Customer Action, Change Status Feed, and SLA Health Overview panels retained.

### `src/components/workspaces/service-owner/Dashboard.tsx` (targeted edits — kept existing governance + breach-response + problem-records flows intact)
Now fetches from `/api/stats/tickets` + `/api/stats/sla` + `/api/stats/customer-health` + `/api/changes`. New 6-card row: **Incidents on My Services (with P1/P2 hint) · SLA Breaches by Service · Open Problems · Changes Touching My Services · Customer Sentiment (green/total ratio) · Governance Approvals**. New panels:
- **Incidents on My Services** — 4 priority tiles (P1 / P2 / P3 / P4, color-coded) + a priority-sorted list of open tickets on owned services.
- **SLA Breaches by Service** — per-service breach + warning counts with SlaClass badge + compliance %, sorted worst-first.
- **Customer Sentiment** — per-customer health scorecard (open tickets, active demands, breaches, avg CSAT, health-score badge color-coded green/amber/red).
Existing Breach Notifications → Governance Responses, Service Portfolio Snapshot, Pending Governance Approvals, Open Problems, Active Known Errors, and Breach Response Dialog flows retained.

## Verification

- `bun run lint` → EXIT 0 (zero errors, zero warnings across all 13 files I created/modified).
- End-to-end smoke tests against the running dev server (`bun run dev` :3000), logged in as each of the 4 roles:
  - **All 7 stats endpoints** (`/api/stats` + 6 new split endpoints) return **200 OK** for all 4 roles (customer / scm / cmleader / owner).
  - **All 4 dashboards** return **200 OK** when their role-named routes are hit (`/customer/dashboard`, `/scm/dashboard`, `/cm/dashboard`, `/owner/dashboard`).
  - Verified scoping correctness:
    - `customer` sees only their own orgNode tickets/demands/sla.
    - `scm` sees assigned-to-me + unassigned + assigned customer org tickets (CustomerAssignment-based).
    - `cmleader` sees all tenant data + workload.byWorker is populated (other roles get empty arrays).
    - `owner` sees only tickets/demands on owned services + customer-health limited to customers consuming owned services.
  - Verified the new fields: `avgCsat` (computed from SatisfactionSurvey aggregate), `reopenRate` (reopened / closed), `healthScore` (green/amber/red bucketing), `aging` buckets (0-1d / 1-3d / 3-7d / 7-14d / 14d+).
  - Verified legacy `/api/stats` aggregator still returns the original shape (totalDemands, byStatus, slaWarnings, slaBreaches, pendingApprovals, openChanges, pipeline, slaByService, workloadByWorker, recentActivity) — existing dashboard consumers are unaffected.
- Pushed schema updates with `bun run db:push` (the `CustomerAssignment` table defined in `prisma/schema.prisma` by an earlier enterprise-workflow-review agent had not yet been pushed to the local SQLite database — `getAssignedCustomerOrgIds` was throwing `P2021` until the push ran).

## Smoke-test artifacts left in DB

No new database artifacts created during this work — all smoke tests were read-only GET requests. (The pre-existing demo data from the seed script continues to drive the stats.)

## Coordination notes

- The original `/api/stats` route was rewritten to call the new compute functions, but its response shape is preserved as a superset — existing dashboard consumers (Customer / CM Leader) that haven't yet been migrated to the new split endpoints continue to work. New consumers should prefer the 6 split endpoints for cleaner contracts.
- The 6 new route handlers are thin wrappers around `_compute.ts` functions — no business logic in the route files themselves. Future agents adding new stats should add a compute function + a thin route file rather than embedding logic in the route.
- The `_scope.ts` module is the single source of truth for stats-domain scoping rules. If the entity-access rules change (e.g. SCM ticket visibility narrows), update `_scope.ts` once and all 6 endpoints + the aggregator pick up the change.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any other agent's API routes or workspace files (only the 5 files explicitly assigned to me + the new shared `_scope.ts` / `_compute.ts` / 6 route files).
- Work record written to `/home/z/my-project/agent-ctx/EWR-C.md`.
