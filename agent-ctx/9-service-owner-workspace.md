# Task 9 — Service Owner Workspace

**Agent**: Service Owner Workspace Builder
**Task ID**: 9
**Task**: Build the Service Owner workspace — accountability dashboard, portfolio, SLA performance, governance approvals, problem records, and changes affecting owned services.

## Files Delivered

All files in `src/components/workspaces/service-owner/`:

| File | Purpose |
|---|---|
| `ServiceOwnerWorkspace.tsx` | Default-exported client component switching on `view` |
| `Dashboard.tsx` | Accountability command center — stat cards, breach alerts, portfolio snapshot, governance queue, problems, known errors |
| `Portfolio.tsx` | Service portfolio DataTable + catalog accuracy banner + detail Dialog with tabs (Overview, SLA, Offerings, Activity) |
| `SlaPerformance.tsx` | SLA performance with ComplianceDonut, SlaTrendChart, per-service DataTable, breach timeline with PM context |
| `Governance.tsx` | Pending commitment approvals (Approve/Escalate toasts), catalog change proposals, Change Board items, escalation chain viz |
| `Problems.tsx` | Problem DataTable + summary tiles + detail Dialog (root cause, impact, decision, workaround) |
| `Changes.tsx` | Changes DataTable + summary tiles + detail Dialog (implementation plan, technical owner tasks, verification) |
| `DemandDetail.tsx` | Read-only demand summary for governance context (meta + pipeline timeline + activity log) |
| `_hooks.ts` | Shared TanStack Query hooks + deriveHealth/serviceCompliance/synthesiseTrend helpers |

## API Dependencies (all verified present)

- `GET /api/services?owner=me` — services owned by caller
- `GET /api/services/[id]` — service detail (used in Portfolio dialog)
- `GET /api/sla-events` — all tenant events (filtered client-side by myServiceIds)
- `GET /api/problems?owner=me` — problems on my services
- `GET /api/changes` — all changes (filtered to changes whose affectedServiceIds intersect my services)
- `GET /api/demands?status=ACCEPTED` — accepted demands (filtered to demands on my services)
- `GET /api/demands/[id]` — demand detail (read-only view)

## Widget Dependencies (Task 10, verified present at compile time)

- `SlaTrendChart({ data: {label,value}[], height? })` — used in SlaPerformance
- `ComplianceDonut({ value, label?, size? })` — used in SlaPerformance

## Design Highlights

- **Teal/emerald theme** — matches foundation oklch 165 hue primary.
- **Governance command center feel** — destructive Alert components for breach notifications, prominent "REQUIRES YOUR RESPONSE" hint, escalation chain visualization in Governance view.
- **Color-coded status badges** — problem status (NEW/UNDER_INVESTIGATION/ROOT_CAUSE_IDENTIFIED/DECISION/KNOWN_ERROR/LINKED_TO_CHANGE/CLOSED), change type (STANDARD/NORMAL/EMERGENCY), change status (existing ChangeStatusBadge), demand status (existing DemandStatusBadge), SLA class (existing SlaClassBadge), SLA health (existing SlaHealthBadge).
- **Responsive** — all grids collapse to single column on mobile; tables hide non-essential columns at sm/md/lg breakpoints; mobile-friendly touch targets.
- **Sticky footer** — handled by AppShell (mt-auto).
- **Custom scrollbars** — `scrollbar-thin` class on long lists.

## Demo Account

`owner@cerebree.io` / `demo1234` — Dr. Henrik Sørensen, Service Owner — Core Platform.

Owns 3 services:
- Enterprise Resource Planning (ERP) — Class A, 1 active warning
- Identity & Access Management — Class A, 1 active breach + 1 active warning
- Backup & Recovery — Class B, 1 active breach

Sees:
- 2 active SLA breaches (Identity P1 resolution + Backup RTO) — both surface in Dashboard breach panel + SlaPerformance breach timeline
- 1 open problem (Recurring SSO timeout under peak morning load) — surfaces in Problems view
- 1 ACCEPTED demand awaiting commitment approval (Privileged access review workflow automation) — surfaces in Governance view
- 1 change in IMPLEMENTATION affecting Identity service — surfaces in Changes view

## Quality Gates

- TypeScript: clean (`npx tsc --noEmit --skipLibCheck` shows zero service-owner errors).
- ESLint: clean (the only remaining project lint error is in `AppShell.tsx` — orchestrator's foundation file, not mine).
- `noUnusedLocals`: clean across all 8 service-owner files.
- Dev server: compiles successfully, no errors.

## Notes for Other Agents

- The Service interface in `@/lib/types` exposes `createdAt` but not `updatedAt`. The Prisma schema has `updatedAt @updatedAt` but the API serializer does not surface it. My Portfolio view uses `createdAt` as the catalog "last reviewed" indicator — if a future agent extends the Service serializer to include `updatedAt`, the Portfolio view can be trivially switched over.
- The Demand interface has no `slaClass` field; I derive the "proposed SLA class" in Governance from the related service's slaClass (the demand's relatedServiceIds intersected with my owned services).
- `Approve` / `Escalate` actions in Governance use `toast` only — no real endpoint. If a future agent adds `POST /api/demands/[id]/commit` or similar, the handlers can be wired up.
