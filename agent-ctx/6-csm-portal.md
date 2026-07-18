# Task 6 — CSM Portal (Service Customer Workspace)

**Agent**: customer-workspace-builder
**Task**: Build the Service Customer workspace (WS-01 — CSM Portal) — submit demands, approve/decline quotes, track demand status, browse catalog, view SLA performance.

## Plan

6 screens + 1 switcher:
- `CustomerWorkspace.tsx` — switcher with role-valid view guard
- `Dashboard.tsx` — WS-01-001
- `DemandList.tsx` — WS-01-003
- `DemandDetail.tsx` — WS-01-004 (customer accept/decline/close)
- `SubmitDemand.tsx` — WS-01-002
- `Catalog.tsx` — WS-01-005
- `SlaPerformance.tsx` — WS-01-006

## Decisions

- **Widgets**: Built inline with recharts rather than depending on Task 10's `@/components/widgets` to keep this workspace self-contained (the widgets folder didn't exist at start; defensive against parallel-build races). Task 10's widgets can still be swapped in later if desired.
- **Theme**: teal/emerald per globals.css (primary oklch 165 hue). No indigo/blue primary.
- **Layout**: AppShell already wraps content in `max-w-7xl px-4 py-6` — components do NOT add their own max-width wrapper or footer.
- **APIs**: Calling endpoints as specified in the task contract. They will be built by agents 1-4. Defensive `useQuery` error handling so the UI degrades gracefully if an endpoint is missing.
- **Demand state machine**: customer-side actions = ACCEPT quote (QUOTED→ACCEPTED), DECLINE quote (QUOTED→REJECTED via /close {reason}), CLOSE fulfilled (FULFILLED→CLOSED).

## Work Log (in progress)

- Read worklog.md, types.ts, store.ts, api.ts, shared.tsx, AppShell.tsx, schema.prisma, seed.ts.
- Verified dev server running, recharts/sonner/tanstack-query installed.
- Building all 6 screens + switcher.

## Final Status — COMPLETE

7 files built in `src/components/workspaces/customer/`:
- CustomerWorkspace.tsx (47 lines) — switcher + role-valid view guard
- Dashboard.tsx (475 lines) — WS-01-001
- DemandList.tsx (189 lines) — WS-01-003
- DemandDetail.tsx (522 lines) — WS-01-004 (customer view)
- SubmitDemand.tsx (289 lines) — WS-01-002
- Catalog.tsx (357 lines) — WS-01-005
- SlaPerformance.tsx (437 lines) — WS-01-006

Total: ~2316 lines.

## Quality gates
- ESLint (customer folder only): exit 0, 0 errors, 0 warnings.
- TypeScript (tsc --noEmit): 0 errors in customer workspace files.
- Dev server: compiling cleanly.

## Notes for other agents
- The remaining `bun run lint` error is in `src/components/shell/AppShell.tsx:256` (orchestrator's foundation file — DO NOT MODIFY per contract).
- I did NOT depend on `@/components/widgets` (Task 10). Built inline `PipelineLanes` and recharts trend chart to stay self-contained. If Task 10 ships widgets later, they can be swapped in.
- Customer-side demand actions: accept (QUOTED→ACCEPTED), decline via /close {reason} (QUOTED→CLOSED, reason stashed in rejectionReason), close fulfilled (FULFILLED→CLOSED).
- The decline-via-close path produces a CLOSED demand with rejectionReason set — my DemandDetail surfaces this as a "Quote declined" alert (distinct from the "Demand rejected" alert for REJECTED status).
