# Task ID: EWR-A — Enterprise Workflow Review, Backend Enforcement

**Agent**: EWR-A (Backend Enforcement)
**Plan items covered**: #3 (entity-access helper applied), #4 (state machine enforced), #8 (PATCH route fixed + SequenceCounter-based ticket numbers), #9 (audit logging on all transitions)
**Date**: 2026-07-18

## Scope

Apply the entity-access helper, enforce the ticket state machine, fix the ticket PATCH route, add SequenceCounter-based ticket numbers, and add audit logging to every transition. Build the audit-log API surface (list + per-entity).

The entity-access helper (`src/lib/entity-access.ts`) and ticket state machine (`src/lib/ticket-state.ts`) were already in place — this task wired them into every relevant route.

## Files modified (18) + created (2)

### 1. Ticket PATCH route — block direct status writes
- `src/app/api/tickets/[id]/route.ts`
  - GET: replaced the local `canReadTicket` call with `requireEntityAccess(session, 'TICKET', id, 'read')`.
  - PATCH: now rejects `body.status` with `400` and an explanatory error pointing to the dedicated action routes. `requireEntityAccess(..., 'write')` is called before any write. Settable fields now include `resolutionCode` + `resolutionNotes` (alongside the existing title/description/priority/impact/urgency/serviceId/assignedUserId/assignmentGroupId). Audit log action renamed `TICKET_UPDATE` → `TICKET_UPDATED` (per spec).

### 2. State machine enforced in all 8 ticket transition routes
- `src/app/api/tickets/[id]/{triage,assign,progress,waiting,resume,resolve,close,reopen}/route.ts`
  - Each route now: (a) calls `requireEntityAccess(session, 'TICKET', id, 'write')` before any work, (b) reads the current status from the ticket row, (c) looks up the target status via `ACTION_TO_STATUS[actionName]`, (d) calls `validateTransition(current, target, body, session.role)` — returns 409 with the human-readable error if invalid, (e) writes the audit log under the canonical `TICKET_<EVENT>` action name with `before: { status: current }`, `after: { status: target, ... }`.
  - `assign`: now requires `assignedUserId` OR `assignmentGroupId` (state-machine enforced). Status always flips to ASSIGNED.
  - `resolve`: state-machine requires `resolutionCode` + `resolutionNotes` (≥5 chars). The route validates the code against the canonical list up front, normalises, then re-validates via the state machine.
  - `waiting`: state-machine requires a customer-visible `comment` field. The route now also creates a `Comment` row on the ticket's conversation thread (auto-creating the conversation shell if missing) with `visibility: 'CUSTOMER_VISIBLE'`, alongside the `WAITING` TicketEvent.
  - `reopen`: from CLOSED, only `CM_LEADER` or `SERVICE_CUSTOMER` may reopen (gate added up front). State machine requires `reopenReason` when reopening from CLOSED. The route now records the `reopenReason` in the audit log.
  - `close`: state-machine requires the ticket be `RESOLVED` unless `CM_LEADER` overrides.

### 3. SequenceCounter-based ticket numbers
- `src/app/api/tickets/route.ts`
  - Replaced `generateTicketNumber()` (count-based `TKT-XXXX`) with a transactional `db.sequenceCounter.upsert({ where: { key: prefix }, update: { value: { increment: 1 } }, create: { key: prefix, value: 1 } })`. Prefix is type-derived: `INC` (INCIDENT), `REQ` (SERVICE_REQUEST), `CMP` (COMPLAINT), `CSM` (QUESTION + fallback). Number format: `<prefix>-<year>-<6-digit-seq>` (e.g. `INC-2026-000001`).
  - Audit log action renamed `TICKET_CREATE` → `TICKET_CREATED`.
  - Removed the unused `generateTicketNumber` import.

### 4. Entity-access applied to conversations, comments, attachments, surveys
- `src/app/api/conversations/route.ts` — GET + POST now gate via `canAccessEntity`/`requireEntityAccess` on the underlying entity (TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT). Removed the bespoke SERVICE_CUSTOMER ownership check.
- `src/app/api/conversations/[id]/comments/route.ts` — GET + POST gate via the underlying entity of the conversation. Removed the bespoke SERVICE_CUSTOMER ownership check; the entity-access helper covers it.
- `src/app/api/attachments/route.ts` — GET + POST gate via the underlying entity. A new `canAccessAttachmentEntity` helper resolves the underlying entity when the attachment's `entityType` is `COMMENT` (looks up the comment → conversation → underlying entity). The customer-ownership local helper is gone.
- `src/app/api/attachments/[id]/route.ts` — GET + DELETE use the same `canAccessAttachmentEntity` helper. Removed the local `customerOwnsEntity` function.
- `src/app/api/attachments/[id]/download/route.ts` (NEW) — GET streams the file with `Content-Type` (from the row's `mimeType`) and `Content-Disposition: attachment; filename="<ascii-safe>"; filename*=UTF-8''<encoded>` headers (RFC 5987). Access-gated via `canAccessAttachmentEntity`. Returns `410 Gone` if the file is no longer on disk.
- `src/app/api/surveys/route.ts` — GET: per-entity gate added when both `entityType` and `entityId` are supplied. POST: replaced the local `customerOwnsEntity` helper with `canAccessEntity(..., 'write')`.

### 5. SCM scoping with CustomerAssignment
- `src/app/api/tickets/_helpers.ts` (`buildTicketScope`) — for SCM_WORKER, replaced the demand-derived customer list with `db.customerAssignment.findMany({ where: { userId, active: true } })`. Scope is now: `assignedUserId = session.id` OR `(assignedUserId = null AND serviceCustomerId IN assignedCustomerOrgIds)` OR `serviceCustomerId IN assignedCustomerOrgIds`.
- `src/app/api/tickets/_helpers.ts` (`canReadTicket`) — same CustomerAssignment-based scoping for single-ticket reads.
- `src/app/api/demands/route.ts` (GET) — replaced the broad `OR: [{ assignedScmWorkerId: me }, { assignedScmWorkerId: null }]` rule with the precise scoping above using `getAssignedCustomerOrgIds(session.id)`. The `assigned=me` and `unassigned=1` query filters remain supported but now intersect with the CustomerAssignment scope.
- `src/app/api/communications/route.ts` (GET) — replaced the demand-derived customer list with `getAssignedCustomerOrgIds(session.id)`. Scope is now: `serviceCustomerId IN assignedCustomerOrgIds OR authorId = session.id`.

### 6. Audit logging on demand transitions + knowledge lifecycle
Added `auditLog(...)` calls (canonical action names) to:
- `src/app/api/demands/[id]/review/route.ts` — `DEMAND_REVIEW_STARTED`
- `src/app/api/demands/[id]/quote/route.ts` — `DEMAND_QUOTED`
- `src/app/api/demands/[id]/approve-quote/route.ts` — `DEMAND_QUOTE_APPROVED`
- `src/app/api/demands/[id]/accept/route.ts` — `DEMAND_ACCEPTED`
- `src/app/api/demands/[id]/reject/route.ts` — `DEMAND_REJECTED`
- `src/app/api/demands/[id]/redirect/route.ts` — `DEMAND_REDIRECTED`
- `src/app/api/demands/[id]/return-quote/route.ts` — `DEMAND_QUOTE_RETURNED`
- `src/app/api/demands/[id]/request-approval/route.ts` — `DEMAND_QUOTE_APPROVAL_REQUESTED`
- `src/app/api/demands/[id]/hand-to-ce/route.ts` — `DEMAND_HANDED_TO_CE` (audit log fires after the `$transaction` commits, using the captured `changeId` + `handoverId`)
- `src/app/api/demands/[id]/fulfill/route.ts` — `DEMAND_FULFILLED`
- `src/app/api/demands/[id]/close/route.ts` — `DEMAND_CLOSED`
- `src/app/api/knowledge/[id]/submit-review/route.ts` — `KNOWLEDGE_SUBMITTED_REVIEW` (renamed from `KNOWLEDGE_ARTICLE_SUBMITTED_REVIEW`)
- `src/app/api/knowledge/[id]/publish/route.ts` — `KNOWLEDGE_PUBLISHED` (renamed from `KNOWLEDGE_ARTICLE_PUBLISHED`)
- `src/app/api/knowledge/[id]/retire/route.ts` — `KNOWLEDGE_RETIRED` (renamed from `KNOWLEDGE_ARTICLE_RETIRED`)

### 7. Audit log API (NEW)
- `src/app/api/audit-logs/route.ts` (NEW) — GET with filters: `actorId`, `entityType`, `entityId`, `action`, `dateFrom`, `dateTo`, `customerOrgId`, `limit` (default 100, max 500). Role scoping:
  - `CM_LEADER` → all entries.
  - `SERVICE_OWNER` → entries for entities tied to services they own (Tickets / Problems / SlaEvents / KnowledgeArticles / Demands / Changes referencing owned services).
  - `SCM_WORKER` → entries for entities tied to their assigned customer orgs (via `CustomerAssignment`) PLUS their own actions (`actorId = session.id`).
  - `SERVICE_CUSTOMER` → 403 (audit is internal).
  - `before` and `after` JSON columns are parsed and surfaced as objects (with a safe-parse fallback).
- `src/app/api/audit-logs/entity/route.ts` (NEW) — GET `/api/audit-logs/entity?entityType=&entityId=` returns the per-entity audit history. Caller must pass `canAccessEntity(session, normalizedType, entityId, 'read')`. Accepts case-insensitive `entityType` (matches `TICKET`, `Ticket`, `ticket`, and the camel-cased Prisma model name) and ORs the variants in the query.

## End-to-end smoke tests

Run against the live dev server as `cmleader@cerebree.io`:

1. **POST /api/tickets** → ticket created with number `INC-2026-000001` (SequenceCounter format). Audit log entry `TICKET_CREATED` written.
2. **PATCH /api/tickets/[id]** with `{ status: 'CLOSED' }` → `400` with explicit error: *"Direct status changes are forbidden — use the dedicated transition endpoints (/assign, /triage, /progress, /waiting, /resume, /resolve, /close, /reopen)."*
3. **PATCH /api/tickets/[id]** with `{ title: '...' }` → succeeds; `TICKET_UPDATED` audit log written.
4. **POST /api/tickets/[id]/waiting** (from NEW) → `409` *"Invalid transition: NEW -> WAITING_CUSTOMER. Allowed: TRIAGED, CANCELED"* (state machine blocks).
5. **POST /api/tickets/[id]/triage** → status flips to `TRIAGED`; `TICKET_TRIAGED` audit log written.
6. **POST /api/tickets/[id]/assign** with valid SCM user → status flips to `ASSIGNED`; `TICKET_ASSIGNED` audit log written.
7. **POST /api/tickets/[id]/resolve** without `resolutionCode` → `400` (validation up front). With `resolutionNotes` < 5 chars → `409` *"Resolve requires resolutionNotes (at least 5 characters)."* With proper fields → status flips to `RESOLVED`; `TICKET_RESOLVED` audit log written.
8. **POST /api/tickets/[id]/close** (from RESOLVED) → status flips to `CLOSED`; `TICKET_CLOSED` audit log written.
9. **POST /api/tickets/[id]/reopen** from CLOSED without `reopenReason` → `409` *"Reopen from CLOSED requires reopenReason."* With reason → status flips to `IN_PROGRESS`; `TICKET_REOPENED` audit log written.
10. **GET /api/audit-logs/entity?entityType=Ticket&entityId=...&limit=20** → returns the complete lifecycle (7 entries, newest first): `TICKET_REOPENED → TICKET_CLOSED → TICKET_RESOLVED → TICKET_PROGRESS → TICKET_ASSIGNED → TICKET_TRIAGED → TICKET_CREATED`.
11. **GET /api/audit-logs?limit=5** → returns the latest 5 audit entries across the tenant (CM_LEADER scope).
12. **GET /api/audit-logs/entity** as `SERVICE_CUSTOMER` → `403` (audit is internal).

## Verification

- `bun run lint` → EXIT 0 (zero errors, zero warnings across all 20 files I created/modified).
- `npx tsc --noEmit --skipLibCheck` → 0 errors in any of my files. (Pre-existing TS errors in other agents' files: `customer-assignments/[id]/route.ts` missing exports, `stats/route.ts` comparison narrowing, `cm-leader/TicketOperations.tsx` missing `apiPatch` import, `shared/EntityLinks.tsx` never-type narrowing, `shared/KnowledgeManager.tsx` boolean|"" assignment. None of these are mine to fix.)
- Dev server log: no errors during the smoke tests.

## Coordination notes for future agents

- **Ticket PATCH status field**: now blocked. Any frontend that was using `PATCH /api/tickets/[id]` with `{ status: ... }` to flip status must be migrated to call the dedicated action routes. The error response explains where to go.
- **Ticket number format changed**: from `TKT-XXXX` (4-digit, count-based) to `<prefix>-<year>-<6-digit-seq>` (e.g. `INC-2026-000001`). Existing tickets in the DB retain their old `TKT-XXXX` numbers — the schema's `number @unique` constraint is preserved. Frontends that display ticket numbers should be flexible enough to handle both formats during the transition.
- **Audit log action names**: a small set was renamed to match the canonical Enterprise Workflow Review vocabulary (`TICKET_UPDATE` → `TICKET_UPDATED`, `TICKET_CREATE` → `TICKET_CREATED`, `KNOWLEDGE_ARTICLE_*` → `KNOWLEDGE_*`). Frontends or reports that filter by action name should update their filters. Old audit log entries already in the DB keep their old action names.
- **Audit log casing**: the `entityType` column on `AuditLog` is a free-form string. Routes that write audit logs use the Prisma model name (e.g. `"Ticket"`, `"Demand"`). The per-entity audit-logs endpoint (`/api/audit-logs/entity?entityType=`) accepts any casing variant and ORs them in the query — but the `/api/audit-logs` list endpoint does an exact match on `entityType`. Pass the canonical Prisma model name (`Ticket`, `Demand`, `Change`, `Problem`, `SlaEvent`, `KnowledgeArticle`, `Communication`) to filter correctly.
- **Attachment download endpoint**: a new `GET /api/attachments/[id]/download` route exists. Frontends can use it as the `href` for download links (it sets `Content-Disposition: attachment`). The existing `url` field on the attachment serializer still points to the static `/uploads/...` path — the new endpoint is the access-controlled alternative for sensitive files.
- **SCM scoping**: SCM_WORKER role no longer sees *all* unassigned tickets/demands/communications — they see only those tied to their assigned customer orgs (via the `CustomerAssignment` table) plus their own authored items. If a seed/demo SCM worker is missing assignments, run `bun run db:push` again to make sure the seed script populates `CustomerAssignment` rows.
- **Customer assignment seed**: the orchestrator's seed script must include `CustomerAssignment` rows linking SCM workers to the customer orgs they serve. Without those rows, an SCM worker sees nothing in their queue.

## Did NOT do
- Did NOT write tests.
- Did NOT run `bun run build`.
- Did NOT modify the foundation `entity-access.ts` or `ticket-state.ts` (consumed as-is per the contract).
- Did NOT touch the `cm-leader/Workers.tsx` lint error (another agent's file).
- Did NOT touch the TypeScript errors in `customer-assignments/[id]/route.ts`, `stats/route.ts`, `cm-leader/TicketOperations.tsx`, `shared/EntityLinks.tsx`, `shared/KnowledgeManager.tsx` (all other agents' files).
- Did NOT modify any workspace UI file (only API routes + helpers).
