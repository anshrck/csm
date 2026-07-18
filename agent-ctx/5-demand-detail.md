# Task 5 — Demand Detail Work Surface (CSM-side, WS-02-003)

**Agent**: Demand Detail Work Surface builder
**Task ID**: 5
**File owned**: `src/components/workspaces/shared/DemandDetail.tsx`
**Status**: COMPLETE — lint-clean and type-clean.

## What was built

A shared, role-aware Demand Detail work surface used by both the SCM Worker and CM Leader workspaces. Single default export matching the exact contract:

```tsx
export default function DemandDetail({ id, role }: { id: string; role: 'SCM_WORKER' | 'CM_LEADER' })
```

## Layout

1. Back button → `navigate('demands')`.
2. `PageHeader` (title = demand.title, description = customer · submitted date · SCM worker) with `DemandStatusBadge` action.
3. `DemandPipelineTimeline` inside a SectionCard.
4. Two-column grid (`lg:grid-cols-3`, main = col-span-2, side = col-span-1, `items-start`).
5. Main column sections (all SectionCard):
   - Outcome callout (terminal REJECTED/REDIRECTED).
   - Customer Input (description + businessJustification + desiredTimeline, read-only).
   - Catalog Check Panel (UNDER_REVIEW only) — info callout + Redirect / Proceed-to-Quote buttons for SCM.
   - Assessment & Quote Draft (UNDER_REVIEW only) — editable for SCM (effort/cost/quoteNotes + Save Quote Draft button), read-only for CM with governance gate callout.
   - Quote (QUOTED+ read-only) — full quote details with KeyValue grid + approval/quotation/acceptance dates.
   - Commitment (ACCEPTED+ if commitmentNotes).
   - Linked Change Request (IN_CHANGE/FULFILLED) — change preview + open-change-record button.
   - Activity Log via shared `ActivityLog` component.
6. Side column:
   - Demand Meta (customer, submitter, assigned SCM worker with avatar + workload hint for CM).
   - Related Services (parallel-fetched per relatedServiceIds with SlaClassBadge).
   - Governance Actions (sticky on lg) — StatusCallout + role-gated action buttons.

## Role-gated actions

| Status | SCM_WORKER | CM_LEADER |
|---|---|---|
| NEW | Assign to Me · Start Review | Assign Worker… · Start Review |
| UNDER_REVIEW (no approval) | Save Quote Draft (in form) · Redirect · Reject | Approve Quote · Reject |
| UNDER_REVIEW (approved) | Submit Quote to Customer · Redirect · Reject | (success callout) · Reject |
| QUOTED | (info: awaiting customer) | (info: awaiting customer) |
| ACCEPTED | Create Change & Hand to CE… | (info: awaiting SCM) |
| IN_CHANGE | Mark Fulfilled (enabled iff change CLOSED) | Mark Fulfilled (enabled iff change CLOSED) |
| FULFILLED | Close Demand… | Close Demand… |
| REJECTED/REDIRECTED/CLOSED | (terminal) | (terminal) |

## Mutations & data fetching

- `useQuery(['demand', id])` → `GET /api/demands/[id]`.
- `useQueries` over `relatedServiceIds` → `GET /api/services/[id]` (parallel, best-effort).
- `useQuery(['offerings'])` lazy-enabled when Redirect dialog opens → `GET /api/offerings`.
- `useQuery(['scm-workers'])` for CM_LEADER (workload hints + assign dialog) → `GET /api/workers/scm`.
- Mutations: `assignMutation` (PATCH), `startReviewMutation` (POST /review), `saveQuoteMutation` (PATCH), `approveQuoteMutation` (POST /approve-quote), `submitQuoteMutation` (POST /quote), `rejectMutation` (POST /reject), `redirectMutation` (POST /redirect), `handToCeMutation` (POST /hand-to-ce), `fulfillMutation` (POST /fulfill), `closeMutation` (POST /close). All invalidate `['demand', id]` + `['demands']` on success and emit toast feedback.

## Form-state design

The `AssessmentFieldsSection` sub-component holds its own `effort` / `cost` / `quoteNotes` state via lazy `useState` initializers. The parent remounts it via `key={demand.id}`, so the form re-initializes cleanly when the demand changes — without any `useEffect` (which would violate the project's `react-hooks/set-state-in-effect` lint rule). Dialog inputs are reset in their open-trigger handlers (also no setState-in-effect).

## Verification

- `bunx eslint src/components/workspaces/shared/DemandDetail.tsx` → 0 errors, 0 warnings.
- `bunx tsc --noEmit --skipLibCheck` for DemandDetail.tsx → 0 errors.
- No foundation files modified.
- Only file created: `src/components/workspaces/shared/DemandDetail.tsx`.

## Import contract for downstream agents (Tasks 6 & 7)

```tsx
import DemandDetail from '@/components/workspaces/shared/DemandDetail';
// In workspace switch:
case 'demand-detail':
  return <DemandDetail id={params.id} role={session.role === 'CM_LEADER' ? 'CM_LEADER' : 'SCM_WORKER'} />;
```

## API endpoints consumed (other agents own these)

- `GET /api/demands/[id]` — must return Demand with `events[]`, `change` (id, title, type, status, complexity, implementationPlan), `serviceCustomerName`, `submittedByName`, `assignedScmWorkerName`, `relatedServiceIds` (parsed array).
- `PATCH /api/demands/[id]` — accepts `{ assignedScmWorkerId, estimatedEffortDays, estimatedCost, quoteNotes }`.
- `POST /api/demands/[id]/{review,approve-quote,quote,reject,redirect,hand-to-ce,fulfill,close}`.
  - `/redirect` body: `{ offeringId, reason? }`
  - `/reject` body: `{ reason }`
  - `/hand-to-ce` body: `{ affectedServiceIds, implementationPlan? }`
  - `/close` body: `{ note? }`
- `GET /api/services/[id]` — Service.
- `GET /api/offerings` — ServiceOffering[] (with optional `serviceName`).
- `GET /api/workers/scm` — `[{ id, name, title, avatarColor, openDemandCount }]`.

All endpoints should be auth-gated per the role scoping rules in worklog.md.
