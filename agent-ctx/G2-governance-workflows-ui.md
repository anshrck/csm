# Task G2 — Governance workflows UI wiring (COMPLETE)

**Task ID:** G2
**Agent:** Governance workflows UI wiring (fix-iteration)
**Status:** COMPLETE

## Goal
Replace dummy "toast-only" governance placeholders with REAL persisted workflows + dialogs + query invalidation across the Service Owner, CM Leader, SCM Worker, and shared Demand Detail workspaces.

## Files created (8 new API routes)
1. `src/app/api/sla-reports/route.ts` — GET (filters: status, preparedBy) + POST (create DRAFT, auto-gathers metrics from sla-events)
2. `src/app/api/sla-reports/[id]/submit/route.ts` — POST → PENDING_REVIEW (notifies CM Leaders)
3. `src/app/api/sla-reports/[id]/approve/route.ts` — POST → APPROVED (CM Leader; notifies preparer)
4. `src/app/api/sla-reports/[id]/return/route.ts` — POST → RETURNED (CM Leader; reviewNotes required; notifies preparer)
5. `src/app/api/sla-reports/[id]/issue/route.ts` — POST → ISSUED (requires APPROVED; notifies customers)
6. `src/app/api/communications/route.ts` — GET (filters) + POST (SCM/CM; notifies customers for TO_CUSTOMER)
7. `src/app/api/governance-decisions/route.ts` — GET (filters; SERVICE_OWNER scoped to owned services) + POST (validates + notifies CM Leaders)
8. `src/app/api/demands/[id]/request-approval/route.ts` — POST (SCM; validates UNDER_REVIEW + quote fields; COMMENT event + CM Leader notifications; idempotent)
9. `src/app/api/demands/[id]/return-quote/route.ts` — POST (CM Leader; resets approval flag; COMMENT event + SCM notification)

## Files modified (5 UI files)
1. `src/components/workspaces/service-owner/Governance.tsx` — Real Approve/Escalate dialogs + Governance Decision History section
2. `src/components/workspaces/service-owner/Dashboard.tsx` — Real Breach Response dialog with "Governance response recorded" indicator
3. `src/components/workspaces/cm-leader/SlmGovernance.tsx` — Real SLA Reports section with tabbed grouping + Review/Return dialogs
4. `src/components/workspaces/scm-worker/SlmDashboard.tsx` — Real Communicate dialog + Recent Communications panel + Prepare/Submit/Issue SLA Report flow
5. `src/components/workspaces/shared/DemandDetail.tsx` — Request Approval (SCM) + Return for Revision (CM Leader) dialogs + "Pending CM Leader Approval" status indicator

## Verification
- `bun run lint` → EXIT 0
- `npx tsc --noEmit --skipLibCheck` → zero errors in any file I touched
- End-to-end API smoke test via curl: all 9 endpoints return correct status codes (200/201) with correct payloads, persist rows, emit audit events, fan out notifications
- All 3 role workspace pages render via the dev server (GET / returns 200 with no compile errors)

## Coordination notes
- **G1 also worked in parallel** on the same APIs. Their `_serialize.ts` files + single-endpoint routes (`/api/sla-reports/[id]/route.ts`, `/api/communications/[id]/route.ts`, `/api/governance-decisions/[id]/route.ts`) are intact. My list/lifecycle routes are also intact. The two sets are functionally compatible (frontend only consumes the list endpoints).
- Demo data created during smoke-testing: 1 SLA report (ISSUED), 1 demand (UNDER_REVIEW, returned for revision), 1 governance decision (COMMITMENT_APPROVAL), 1 communication (TO_CUSTOMER). Visible in UI — re-seed if pristine demo state needed.

## Status: COMPLETE ✅
