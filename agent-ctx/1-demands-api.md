# Task 1 — Demands API Builder

## Agent
Demands API Builder (Task ID 1)

## Task
Build the complete Demands API — full demand lifecycle with state-machine transitions, role enforcement, event logging, and notifications.

## Files Created (exclusively owned)
- `src/app/api/demands/_serialize.ts` — shared serializer + `DEMAND_INCLUDE` constant + `errorResponse` helper.
- `src/app/api/demands/route.ts` — GET (list with filters + role scoping) + POST (create demand + CREATED event + DemandCreated notification to all CM_LEADER users).
- `src/app/api/demands/[id]/route.ts` — GET (single with full relations, scoping enforced) + PATCH (update assignedScmWorkerId / estimatedEffortDays / estimatedCost / quoteNotes / commitmentNotes).
- `src/app/api/demands/[id]/review/route.ts` — POST: NEW → UNDER_REVIEW. Auto-assigns to caller (SCM) if unassigned. SCM_WORKER/CM_LEADER.
- `src/app/api/demands/[id]/approve-quote/route.ts` — POST: CM_LEADER-only gate. Sets quoteApprovedByCmLeader=true + quoteApprovedAt=now. Emits QUOTE_APPROVED.
- `src/app/api/demands/[id]/quote/route.ts` — POST: UNDER_REVIEW → QUOTED. Requires quoteApprovedByCmLeader (else 403). Body: estimatedEffortDays (required), estimatedCost?, quoteNotes?. Emits QUOTED + notifies customer.
- `src/app/api/demands/[id]/accept/route.ts` — POST: QUOTED → ACCEPTED. Caller must be SERVICE_CUSTOMER owning this demand. Emits ACCEPTED + notifies assigned SCM worker.
- `src/app/api/demands/[id]/reject/route.ts` — POST: UNDER_REVIEW|QUOTED → REJECTED. Body: { reason } (required). SCM/CM only. Emits REJECTED + notifies customer.
- `src/app/api/demands/[id]/redirect/route.ts` — POST: UNDER_REVIEW → REDIRECTED. Body: { offeringId, reason? }. SCM/CM only. Emits REDIRECTED + notifies customer.
- `src/app/api/demands/[id]/hand-to-ce/route.ts` — POST: ACCEPTED → IN_CHANGE. Atomically (via $transaction) creates Change (NORMAL/DEMAND/REQUESTED) + ProcessHandover (CM_TO_CE) + updates demand. Emits HANDED_TO_CE.
- `src/app/api/demands/[id]/fulfill/route.ts` — POST: IN_CHANGE → FULFILLED. Requires linked change.status='CLOSED' (else 409). Emits FULFILLED + notifies customer.
- `src/app/api/demands/[id]/close/route.ts` — POST: FULFILLED → CLOSED (no reason needed, customer/SCM/CM), OR QUOTED → CLOSED (customer-only decline, reason required). Emits CLOSED.

## Contracts Followed
- `import { db } from '@/lib/db'`
- `import { getSession, requireRole } from '@/lib/auth'`
- `export const runtime = 'nodejs';` at top of every route
- `relatedServiceIds` stored as JSON string in DB, parsed on read, returned as array in API responses
- Dates returned as ISO strings via `.toISOString()`
- `NextResponse.json(...)` with proper status codes; errors as `{ error: 'msg' }`
- All transitions emit a `DemandEvent` with actorId, actorName, and a meaningful note
- Notifications created on: DemandCreated (→ all CM_LEADER users), DemandQuoted (→ customer), DemandAccepted (→ assigned SCM), DemandRejected (→ customer), DemandFulfilled (→ customer), and redirect (→ customer)

## Scoping Rules Implemented
- SERVICE_CUSTOMER: only sees their own orgNode's demands (serviceCustomerId === caller.orgNodeId). For accept: must own the demand. For close QUOTED path: customer-only.
- SCM_WORKER: sees assigned-to-me OR unassigned (in list view). Per-demand: must be assigned or unassigned. To act on transitions: must be assigned (or claim by being the actor in /review).
- CM_LEADER: sees all tenant demands. Can act on any transition (governance gate).
- SERVICE_OWNER: read-only access to all demands (no transitions).

## Verification
Ran full end-to-end lifecycle test against the seeded DB:
1. SCM creates demand → 201 + CREATED event + DemandCreated notif to CM_LEADER ✓
2. POST /review → NEW→UNDER_REVIEW + REVIEW_STARTED + auto-assign ✓
3. POST /quote (no approval) → 403 ✓ (gate enforced)
4. CM_LEADER POST /approve-quote → quoteApprovedByCmLeader=true + QUOTE_APPROVED ✓
5. POST /quote (after approval) → QUOTED + QUOTED event + DemandQuoted to customer ✓
6. Customer POST /accept → ACCEPTED + ACCEPTED event + DemandAccepted to SCM ✓
7. POST /hand-to-ce → IN_CHANGE + Change created + ProcessHandover created + HANDED_TO_CE ✓
8. POST /fulfill (before change closed) → 409 ✓ (gate enforced)
9. (closed change in DB) POST /fulfill → FULFILLED + DemandFulfilled to customer ✓
10. Customer POST /close → CLOSED + CLOSED event ✓
11. POST /close on QUOTED with reason → CLOSED + rejectionReason set ✓ (decline path)
12. POST /close on QUOTED without reason → 400 ✓ (validation)
13. POST /reject → REJECTED + DemandRejected to customer ✓
14. POST /redirect → REDIRECTED + redirectedToOfferingId set ✓
15. Customer GET /api/demands → only sees their own orgNode's demands (6 demands, all "Finance Division") ✓

Lint: `bunx eslint src/app/api/demands` → 0 errors, 0 warnings.
TypeCheck: `bunx tsc --noEmit` → 0 errors in demands files.

## Notes for Other Agents
- The shared serializer in `src/app/api/demands/_serialize.ts` can be imported by other API routes (e.g. Changes API that wants to include the origin demand):
  ```ts
  import { serializeDemand, DEMAND_INCLUDE, errorResponse, type DemandWithRelations } from '@/app/api/demands/_serialize';
  ```
- The Change created by `/hand-to-ce` has type='NORMAL', status='REQUESTED', originType='DEMAND', originDemandId=<demand.id>. The Changes API (Task 4) can pick it up from there.
- ProcessHandover rows are created with type='CM_TO_CE', sourceDemandId, targetChangeId. The Handovers API (Task 3) can list them.
- Customer-side decline of a quote uses POST /api/demands/[id]/close with a reason; this sets demand.rejectionReason and status='CLOSED'. (NOT /reject — that's the SCM/CM governance action.)
- Closing a Change does NOT automatically move the demand to FULFILLED in my implementation — the SCM worker must call POST /fulfill explicitly (which enforces change.status='CLOSED'). If the Changes API (Task 4) wants auto-fulfill on Change close, it can call into the demand update logic directly — but I'd recommend keeping the explicit fulfill step so SCM stays in control.
