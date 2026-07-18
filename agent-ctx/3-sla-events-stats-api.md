# Task 3 — SLA Events API + Stats/Dashboard API

- **Task ID**: 3
- **Agent**: API builder (sla-events + stats)
- **Task**: Build the SLA Events API (`GET /api/sla-events`) and the Stats/Dashboard API (`GET /api/stats`).

## Files Created (exclusive ownership)

- `src/app/api/sla-events/route.ts` — GET list endpoint
- `src/app/api/stats/route.ts` — GET dashboard stats endpoint

## Implementation Notes

### `GET /api/sla-events`
- `export const runtime = 'nodejs';` at the top.
- Auth via `getSession()` → returns `401` if no session.
- Query params supported: `serviceId`, `customerId` (orgNode), `type` (WARNING|BREACHED|CLOSED_IN_TIME), `active=1` (resolvedAt is null).
- Role scoping:
  - `SERVICE_CUSTOMER` — restricted to `serviceCustomerId === session.orgNodeId`. Returns `[]` if no orgNode.
  - `SCM_WORKER`, `CM_LEADER`, `SERVICE_OWNER` — see all tenant events (per task contract simplification).
- For non-customer roles, the `customerId` query param acts as an explicit filter.
- Joins `Service` for `serviceName`. Orders by `createdAt desc`, capped at 200 rows.
- Computes a per-service `health` hint (`green|amber|red`) across the result set and attaches it to each row (extends `SlaEvent` with `health: SlaHealth`). Red wins over amber.
- Dates serialized with `.toISOString()`; `resolvedAt` is `null` when absent.

### `GET /api/stats`
- `export const runtime = 'nodejs';` at the top.
- Auth via `getSession()` → returns `401` if no session.
- Returns a single JSON object with all the dashboard fields required by the contract:
  - `totalDemands`, `byStatus` (Record<string, number>), `slaWarnings`, `slaBreaches`, `pendingApprovals`, `openChanges`
  - `pipeline`: array of `{ status, count }` for NEW / UNDER_REVIEW / QUOTED / ACCEPTED / IN_CHANGE / FULFILLED
  - `slaByService`: array of `{ serviceId, serviceName, slaClass, health, events }` (top 10, sorted red → amber → green, then by active-event count desc)
  - `workloadByWorker` (CM_LEADER only): array of `{ workerId, workerName, activeDemands, slaRisk }` for SCM workers — built from two batched queries (one for active demands, one for active breaches) instead of N+1
  - `recentActivity`: last 8 in-scope `DemandEvent` records with `{ id, demandId, demandTitle, eventType, actorName, createdAt }`
- Scoping:
  - `SERVICE_CUSTOMER` — demands/SLA events for their `orgNodeId`; pendingApprovals = QUOTED demands in scope; openChanges = open changes whose origin demand is in scope.
  - `SCM_WORKER` — demands assigned to them OR unassigned (`OR` clause); SLA events across the tenant; pendingApprovals = 0 (no explicit semantics for SCM workers in spec).
  - `CM_LEADER` — all tenant data; pendingApprovals = UNDER_REVIEW demands (approximation per spec); workloadByWorker computed.
  - `SERVICE_OWNER` — services they own (`serviceOwnerId = caller.id`); demands touching those services (filtered in code via `relatedServiceIds` JSON parse); SLA events for owned services; openChanges = open changes whose `affectedServiceIds` JSON overlaps owned services; pendingApprovals = ACCEPTED demands in scope.
- Helper `parseServiceIds()` safely parses the JSON-encoded service id arrays stored on `Demand.relatedServiceIds` and `Change.affectedServiceIds`.
- `emptyStats()` factory used for early-exit when scope is empty (e.g., customer with no orgNode, service owner with no owned services).
- All Prisma queries are scoped to avoid N+1: workloadByWorker uses a single fetch for active worker demands + a single fetch for active breaches, aggregated in code.

## Verification

- **`bun run lint`** — both files report zero ESLint errors. (Pre-existing errors in `AppShell.tsx` and `CustomerWorkspace.tsx` are owned by other agents and were left untouched.)
- **`bunx tsc --noEmit`** — both files compile with zero TypeScript errors. (Pre-existing errors in other agents' files were observed but not touched.)
- Dev server starts cleanly and reports `Ready in 3s`. (Direct curl from a separate shell to `localhost:3000` failed with connection-refused — sandbox network-namespace quirk between shell sessions, not a code issue. The server is healthy in `dev.log`.)

## API Response Shape Examples

### `GET /api/sla-events` (one element)
```json
{
  "id": "evt_...",
  "serviceId": "svc_...",
  "serviceName": "Identity & Access Management",
  "serviceCustomerId": "org_...",
  "eventType": "BREACHED",
  "message": "P1 resolution SLA breached on incident INC-1031…",
  "createdAt": "2025-07-14T09:12:33.000Z",
  "resolvedAt": null,
  "health": "red"
}
```

### `GET /api/stats` (CM_LEADER view)
```json
{
  "totalDemands": 8,
  "byStatus": { "NEW": 1, "UNDER_REVIEW": 1, "QUOTED": 1, "ACCEPTED": 1, "IN_CHANGE": 1, "FULFILLED": 1, "CLOSED": 1, "REJECTED": 1 },
  "slaWarnings": 2,
  "slaBreaches": 2,
  "pendingApprovals": 1,
  "openChanges": 1,
  "pipeline": [
    { "status": "NEW", "count": 1 },
    { "status": "UNDER_REVIEW", "count": 1 },
    { "status": "QUOTED", "count": 1 },
    { "status": "ACCEPTED", "count": 1 },
    { "status": "IN_CHANGE", "count": 1 },
    { "status": "FULFILLED", "count": 1 }
  ],
  "slaByService": [
    { "serviceId": "svc_...", "serviceName": "Identity & Access Management", "slaClass": "A", "health": "red", "events": 2 },
    { "serviceId": "svc_...", "serviceName": "Enterprise Resource Planning (ERP)", "slaClass": "A", "health": "amber", "events": 1 }
  ],
  "workloadByWorker": [
    { "workerId": "usr_...", "workerName": "Priya Anand", "activeDemands": 3, "slaRisk": 1 },
    { "workerId": "usr_...", "workerName": "Tomas Berg", "activeDemands": 2, "slaRisk": 0 }
  ],
  "recentActivity": [
    { "id": "ev_...", "demandId": "dem_...", "demandTitle": "Procurement self-service portal module", "eventType": "CREATED", "actorName": "Elena Vance", "createdAt": "2025-07-17T09:12:33.000Z" }
  ]
}
```

## Stage Summary

Both endpoints are complete, type-safe, role-scoped, and lint-clean. They conform to the foundation contracts: `runtime = 'nodejs'`, `getSession`/`requireRole` from `@/lib/auth`, `db` from `@/lib/db`, ISO-string dates, `NextResponse.json` with proper status codes. No foundation files were modified. Ready for the dashboard UI agents (Tasks 5–9) to consume.
