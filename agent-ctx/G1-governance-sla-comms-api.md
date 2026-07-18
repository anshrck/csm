# Task G1 — Governance / SLA Report / Communication API Builder

**Task ID:** G1
**Agent:** Governance / SLA Report / Communication API Builder (fix-iteration)
**Task:** Replace dummy "toast-only" actions with REAL persisted workflows + audit trails + notifications for (a) Service Owner governance decisions, (b) CM Leader SLA report review, (c) SCM Worker breach communication. Build Governance Decision API, SLA Report API, and Communication API — full CRUD + lifecycle with audit events and notifications.

## Context consumed
- Read `worklog.md` foundation contracts + all prior task sections.
- Read `prisma/schema.prisma` (confirmed SlaReport / Communication / GovernanceDecision models and their JSON-string / nullable-Date / plain-String-FK columns).
- Read existing API routes (`demands/route.ts`, `demands/_serialize.ts`, `demands/[id]/approve-quote/route.ts`, `changes/_serialize.ts`, `changes/[id]/close/route.ts`) to mirror style.
- Read `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/types.ts` for the foundation imports.

## Files created (13 total)

### Serialize helpers (3)
1. `src/app/api/sla-reports/_serialize.ts` — `serializeSlaReport(row, userMap)`, `buildUserMap(ids)`, `errorResponse(err)`. Parses `serviceIds` / `serviceCustomerIds` JSON-string columns → string arrays, parses `metricsJson` → object, ISO-converts all dates, resolves `preparedByName` + `reviewedByCmLeaderName` via the bulk `userMap`.
2. `src/app/api/communications/_serialize.ts` — `serializeCommunication(row)`, `errorResponse(err)`. ISO-converts `createdAt`. `authorId`/`authorName` stored alongside on the row so no lookup needed.
3. `src/app/api/governance-decisions/_serialize.ts` — `serializeGovernanceDecision(row)`, `errorResponse(err)`. ISO-converts `followUpDate` + `createdAt`. `decidedById`/`decidedByName` stored alongside.

### SLA Reports API (7)
4. `src/app/api/sla-reports/route.ts` — GET (list, filters: `status`, `preparedBy=me`/`<id>`) + POST (create DRAFT, SCM_WORKER only).
5. `src/app/api/sla-reports/[id]/route.ts` — GET single + PATCH (SCM_WORKER who prepared; status must be DRAFT or RETURNED).
6. `src/app/api/sla-reports/[id]/submit/route.ts` — POST → PENDING_REVIEW (SCM_WORKER who prepared; notifies all CM_LEADER users `SlaReportPendingReview`).
7. `src/app/api/sla-reports/[id]/approve/route.ts` — POST → APPROVED (CM_LEADER only; sets `reviewedByCmLeaderId`, `approvedAt`, `reviewNotes`; notifies preparer `SlaReportApproved`).
8. `src/app/api/sla-reports/[id]/return/route.ts` — POST → RETURNED (CM_LEADER only; body `reviewNotes` required; notifies preparer `SlaReportReturned`; SCM can edit + resubmit).
9. `src/app/api/sla-reports/[id]/issue/route.ts` — POST → ISSUED (SCM_WORKER; requires APPROVED; sets `issuedAt`; notifies every SERVICE_CUSTOMER user in `serviceCustomerIds` JSON with `SlaReportIssued`).

### Communications API (3)
10. `src/app/api/communications/route.ts` — GET (list, filters: `demandId`/`serviceCustomerId`/`serviceId`/`slaEventId`/`direction`) + POST (create; SCM_WORKER or CM_LEADER; sets `authorId`/`authorName` from session; on TO_CUSTOMER notifies customer org SERVICE_CUSTOMER users with `BreachCommunicated` if `slaEventId` set, else `CommunicationReceived`; derives `serviceCustomerId` from `demandId` when not supplied).
11. `src/app/api/communications/[id]/route.ts` — GET single. Same role-scope rules as list.

### Governance Decisions API (3)
12. `src/app/api/governance-decisions/route.ts` — GET (list, filters: `serviceId`/`demandId`/`decisionType`) + POST (create; SERVICE_OWNER only — must own the service; validates decisionType + decision enums + rationale; records DemandEvent COMMENT when demandId present; sets `demand.commitmentNotes` when decision=APPROVED; fans out `CommitmentApproved`/`CommitmentRejected` → SCM + customer, `BreachResponded` → CM_LEADERs, `CommitmentEscalated` → CM_LEADERs + SERVICE_OWNERs).
13. `src/app/api/governance-decisions/[id]/route.ts` — GET single. Same role-scope rules as list.

## Role / scope enforcement summary
- **SlaReport**:
  - SCM_WORKER → own DRAFT/RETURNED + every submitted report (PENDING_REVIEW/APPROVED/RETURNED/ISSUED). Creates/prepares. Patches own DRAFT/RETURNED. Submits → PENDING_REVIEW. Issues APPROVED → ISSUED.
  - CM_LEADER → sees all. Approves PENDING_REVIEW → APPROVED. Returns PENDING_REVIEW → RETURNED.
  - SERVICE_CUSTOMER → only ISSUED reports whose `serviceCustomerIds` includes their `orgNodeId`.
  - SERVICE_OWNER → read-only visibility on all.
- **Communication**:
  - SCM_WORKER → comms they authored + comms on their assigned demands + comms on customers referenced by their assigned demands.
  - CM_LEADER → all.
  - SERVICE_CUSTOMER → only TO_CUSTOMER comms for their `orgNodeId`.
  - SERVICE_OWNER → read-only visibility on all.
- **GovernanceDecision**:
  - SERVICE_OWNER → creates for services they own (`service.serviceOwnerId === caller.id`). Sees only decisions on their owned services.
  - CM_LEADER → sees all.
  - SCM_WORKER → sees decisions whose `demandId` is one of their assigned demands.
  - SERVICE_CUSTOMER → 403 (internal governance only).

## Audit + notification events emitted
- **SlaReport lifecycle**: status field on every transition, `reviewedByCmLeaderId`/`approvedAt` on approve, `reviewNotes` on return, `issuedAt` on issue. Notifications: `SlaReportPendingReview` (CM_LEADERs), `SlaReportApproved` (preparer), `SlaReportReturned` (preparer), `SlaReportIssued` (customer users).
- **Communication**: the Communication row itself IS the audit record. `BreachCommunicated` notification when TO_CUSTOMER + slaEventId; `CommunicationReceived` when TO_CUSTOMER without slaEventId.
- **GovernanceDecision**: the GovernanceDecision row IS the audit record. Plus a `DemandEvent` (eventType `COMMENT`) when `demandId` present, so the demand activity log shows the governance action. Plus the three contract notification fan-outs.

## Verification
- `bunx eslint src/app/api/sla-reports src/app/api/communications src/app/api/governance-decisions` → **EXIT 0**, 0 errors / 0 warnings.
- `bunx tsc --noEmit` → **zero errors** in any of the 13 new files (all remaining project TS errors are in unrelated `examples/`, `mini-services/`, `skills/` directories).
- `bun run lint` (whole project) → **EXIT 0**.
- Dev server: started a fresh `bun run dev` instance; the sandbox's network-namespace quirk blocked cross-shell `curl` to `localhost:3000` (same quirk other agents documented earlier), so runtime verification was via lint + tsc on my files per the established pattern.

## Constraints honoured
- `export const runtime = 'nodejs';` at the top of every route file.
- `import { db } from '@/lib/db'`, `import { getSession, requireRole } from '@/lib/auth'`.
- NextResponse.json with proper status (400 / 401 / 403 / 404 / 409 / 201 / 200).
- Dates → ISO strings. JSON array columns → parse on read, stringify on write.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any foundation file. Did NOT modify any other agent's files.

## Integration notes for downstream frontend agents
Frontend workspaces (Tasks 6/7/8/9 SCM/CM-Leader/Service-Owner) can now wire their previously toast-only action buttons to these endpoints:

- **SCM Worker `SlmDashboard.tsx`** breach-communication dialog → `POST /api/communications` with `{ slaEventId, serviceId, serviceCustomerId, direction: 'TO_CUSTOMER', channel: 'PORTAL', subject, body }`. On 201, invalidate `['communications', { slaEventId }]` and `['sla-events']`.
- **CM Leader `SlmGovernance.tsx`** "[Approve Report]" / "[Return Report]" buttons → `POST /api/sla-reports/[id]/approve` (body `{ reviewNotes }`) or `POST /api/sla-reports/[id]/return` (body `{ reviewNotes }` — required). Also expose a "Create Report" → `POST /api/sla-reports` and a "Submit for Review" → `POST /api/sla-reports/[id]/submit`. Invalidate `['sla-reports']` and `['sla-report', id]` on every mutation.
- **Service Owner `Governance.tsx`** "[Approve]" / "[Escalate]" buttons → `POST /api/governance-decisions` with `{ serviceId, demandId, decisionType: 'COMMITMENT_APPROVAL', decision: 'APPROVED' | 'ESCALATED', rationale }`. On 201, invalidate `['governance-decisions', { demandId }]` and `['demand', demandId]` (since the demand activity log + commitmentNotes may have changed).

Recommended query keys:
- `['sla-reports']`, `['sla-report', id]`
- `['communications', { demandId | serviceCustomerId | slaEventId }]`, `['communication', id]`
- `['governance-decisions', { serviceId | demandId | decisionType }]`, `['governance-decision', id]`

## Files owned by this task (do not modify without coordinating)
- `src/app/api/sla-reports/_serialize.ts`
- `src/app/api/sla-reports/route.ts`
- `src/app/api/sla-reports/[id]/route.ts`
- `src/app/api/sla-reports/[id]/submit/route.ts`
- `src/app/api/sla-reports/[id]/approve/route.ts`
- `src/app/api/sla-reports/[id]/return/route.ts`
- `src/app/api/sla-reports/[id]/issue/route.ts`
- `src/app/api/communications/_serialize.ts`
- `src/app/api/communications/route.ts`
- `src/app/api/communications/[id]/route.ts`
- `src/app/api/governance-decisions/_serialize.ts`
- `src/app/api/governance-decisions/route.ts`
- `src/app/api/governance-decisions/[id]/route.ts`
