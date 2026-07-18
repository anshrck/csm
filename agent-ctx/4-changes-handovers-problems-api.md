# Task 4 — Changes / Handovers / Problems API

**Agent**: API builder (Task ID 4)
**Scope**: Full change lifecycle, handovers (list + acknowledge), problems (read-only).

## Files owned (all under `src/app/api/`)

| Path | Methods | Purpose |
|---|---|---|
| `changes/_serialize.ts` | — | `serializeChange(c)` + `authError(e)` helpers. |
| `changes/route.ts` | GET, POST | List (filters: status, type, originDemandId, ceWorker=me) + create (REQUESTED). |
| `changes/[id]/route.ts` | GET, PATCH | Single (with services, handovers, originDemand) + editable-field PATCH. |
| `changes/[id]/assess/route.ts` | POST | REQUESTED → ASSESSMENT (requires affectedServiceIds). |
| `changes/[id]/plan/route.ts` | POST | ASSESSMENT → PLANNING (body: implementationPlan, technicalOwnerTasksJson?, complexity?). |
| `changes/[id]/approve/route.ts` | POST | PLANNING → APPROVED (body: approvalNotes?). |
| `changes/[id]/reject/route.ts` | POST | → REJECTED (body: reason). Allowed from any non-terminal state. |
| `changes/[id]/implement/route.ts` | POST | APPROVED → IMPLEMENTATION. |
| `changes/[id]/verify/route.ts` | POST | IMPLEMENTATION → VERIFICATION (body: verificationNotes). |
| `changes/[id]/close/route.ts` | POST | VERIFICATION → CLOSED. Sets closedAt+catalogUpdatedAt. If originDemandId: demand → FULFILLED, DemandEvent FULFILLED, Notification ChangeClosed to demand submitter. |
| `handovers/route.ts` | GET | List (filters: type, unacknowledged=1). |
| `handovers/[id]/acknowledge/route.ts` | POST | Set acknowledgedById + acknowledgedAt. |
| `problems/route.ts` | GET | List (filters: serviceId, status, owner=me). |
| `problems/[id]/route.ts` | GET | Single with service. |

## Auth matrix

| Endpoint | Allowed roles |
|---|---|
| All GET (changes, handovers, problems) | SCM_WORKER, CM_LEADER, SERVICE_OWNER |
| POST /api/changes (create) | SCM_WORKER, CM_LEADER |
| PATCH /api/changes/[id] | SCM_WORKER, CM_LEADER |
| All lifecycle (assess/plan/approve/reject/implement/verify/close) | SCM_WORKER, CM_LEADER |
| POST /api/handovers/[id]/acknowledge | SCM_WORKER, CM_LEADER |

## Key implementation notes

- `affectedServiceIds` and `technicalOwnerTasksJson` are stored as JSON strings in SQLite. They are parsed to arrays/objects on read (via `safeParse` in `_serialize.ts`) and stringified on write.
- Dates from Prisma (`Date` objects) are returned as ISO strings in every response.
- `serializeChange(c)` accepts the Prisma row with an optional `ceWorker: { id, name }` relation and returns the `Change` interface from `@/lib/types` (with `assignedCeWorkerName` filled when present).
- POST `/api/changes` enforces `originDemandId` uniqueness (Prisma `@unique` constraint) and demand existence before insert; returns 409 if a change already exists for the demand.
- POST `/api/changes` creates a `CM_TO_CE` ProcessHandover when `originDemandId` is provided, so the handover shows up in `GET /api/handovers` immediately.
- POST `/close` is the only lifecycle endpoint with side-effects beyond the change row: it marks the origin Demand `FULFILLED` (sets `fulfilledAt`), creates a `FULFILLED` DemandEvent (actorName = caller.name, notes = 'Change closed by CE.'), and creates a `ChangeClosed` notification to the demand submitter. This matches the seed pattern for the FULFILLED demand.
- PATCH refuses to edit CLOSED or REJECTED changes (409).
- Reject is allowed from any non-terminal state (REQUESTED, ASSESSMENT, PLANNING, APPROVED, IMPLEMENTATION, VERIFICATION). Once CLOSED or REJECTED, reject returns 409.

## Lifecycle state machine (enforced)

```
REQUESTED --assess--> ASSESSMENT --plan--> PLANNING --approve--> APPROVED
APPROVED --implement--> IMPLEMENTATION --verify--> VERIFICATION --close--> CLOSED

reject (from any non-terminal state) --> REJECTED (terminal)
```

Each transition validates the current status and returns `409` with a descriptive message on illegal transitions, `404` if the change id doesn't exist.

## Verification performed

- `bunx tsc --noEmit --pretty false` → **zero** errors in any `api/changes|handovers|problems` file.
- `bun run lint` → **zero** errors/warnings in my files. (9 errors + 2 warnings exist elsewhere in AppShell.tsx and workspaces/*, owned by other agents.)
- No tests written (per instructions). `bun run build` not executed (per instructions).

## Notes for downstream agents (workspace builders)

- The `Change` interface in `@/lib/types` is the wire shape returned by all `/api/changes*` endpoints. The single-GET extends it with three extra fields: `services: Service[]`, `handovers: ProcessHandover[]`, `originDemand: { id, title, status, serviceCustomerId, serviceCustomerName } | null`.
- `GET /api/changes?ceWorker=me` returns changes assigned to the caller (useful for the SCM worker's "my changes" view).
- `GET /api/changes?status=APPROVED,IMPLEMENTATION,VERIFICATION` returns the "in-flight" pipeline for the CM leader dashboard.
- `GET /api/handovers?unacknowledged=1` returns pending handovers awaiting CE acknowledgement.
- `GET /api/problems?owner=me` returns problems on services owned by the calling SERVICE_OWNER.
- The handover list response includes `sourceDemandTitle`, `sourceDemandStatus`, `targetChangeTitle`, `targetChangeStatus` (beyond the `ProcessHandover` interface) for rendering without N+1 fetches.
- The problem list/single responses include `serviceName` inline; the single-GET also includes a `service` object with `{ id, name, domain, slaClass, chapter, status }`.
