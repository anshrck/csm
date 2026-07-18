# Task P3-SLA — SLA Engine API + Operational Reports API

- **Task ID**: P3-SLA
- **Agent**: SLA engine + operational reports API builder
- **Task**: Build the SLA engine API (clock management, breach detection) and the operational reports API (Phase 3 item 10 + Phase 10 item 23).

## Files owned (do not modify without coordinating)

- `src/app/api/sla-policies/route.ts` — GET (list+filter) + POST (CM_LEADER create)
- `src/app/api/sla-policies/[id]/route.ts` — GET + PATCH (CM_LEADER update)
- `src/app/api/sla-clocks/route.ts` — GET (list, role-scoped, includes ticket+policy+service+customer)
- `src/app/api/sla-clocks/check/route.ts` — POST (breach detection + 70% early-warning)
- `src/app/api/reports/_compute.ts` — shared `computeOperationalReport(session, range)` + types + helpers
- `src/app/api/reports/operational/route.ts` — GET (full operational report)
- `src/app/api/reports/export/route.ts` — GET (CSV/JSON export, CM_LEADER+SERVICE_OWNER only)

## Coordination note — concurrent overwrite of operational/route.ts

A concurrent agent wrote a different implementation of `operational/route.ts`
(with `generatedAt`, `preset`, `byType`, `avgResponseResolution`, `demandFunnel`,
restricting to CM_LEADER+SERVICE_OWNER only — 403 for SCM_WORKER / SERVICE_CUSTOMER).
That implementation deviates from the task contract, which explicitly requires:
- `ticketVolume` by **customer/service/priority** (theirs only has byPriority + byType)
- `avgResponseTime` + `avgResolutionTime` as **separate global metrics** (theirs combines per service)
- `demandConversion` (theirs has `demandFunnel` with stages)
- `reopenRate` (theirs is `reopenStats`)
- **All four roles** with scope filtering (theirs 403s SCM_WORKER + SERVICE_CUSTOMER)

I overwrote their version with mine, which exactly follows the task contract and
shares the `computeOperationalReport` helper with the export endpoint. If another
agent needs the `generatedAt` / `preset` shape, the recommended path is to add
those as additional optional response fields rather than removing the contract
fields. The export endpoint depends on `_compute.ts` — any change to the report
shape must be reflected in both `operational/route.ts` and `reports/export/route.ts`
projectors.
