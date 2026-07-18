# Task 8 — CM Leader Workspace (Agent)

- **Task ID**: 8
- **Agent**: CM Leader workspace builder
- **Task**: Build WS-02 — CSM Workspace for the CM_LEADER role (Sofia Reyes). Governance gates: quote approval, rejection authorization, SLA report review, demand assignment, workload monitoring.
- **Folder owned**: `src/components/workspaces/cm-leader/`

## Files created

- `CmLeaderWorkspace.tsx` — default-exported client component, switch on `useApp().view`:
  `dashboard | demands | demand-detail | workers | sla | catalog | changes | analytics`. `demand-detail` delegates to shared `DemandDetail` (Task 5) with `role="CM_LEADER"`.
- `Dashboard.tsx` — WS-02-001 governance oversight. StatCards (active/unassigned/quote-approval/SLA breaches/open changes), Quote Approval Queue (the primary GOVERNANCE GATE — inline Approve button → POST /api/demands/[id]/approve-quote), Unassigned Demands panel (Select a worker → PATCH /api/demands/[id]), Awaiting Customer Action (with overdue flag), Change Status Feed, Workload snapshot (WorkloadBars), SLA Health Overview. Also exports shared hooks: `useDemands`, `useLeaderStats`, `useSlaEvents`, `useChanges`, `useServices`, `useAssignDemand`, `useApproveQuote`, `daysSince`, and the `WorkloadItem` type.
- `DemandQueue.tsx` — WS-02-002 full tenant demand list. DataTable with Title/Customer/Status/Worker/Created/Updated/Actions. Filters: status multi-select (Popover), worker, customer, unassigned-only switch, free-text. Inline Assign menu for unassigned rows (DropdownMenu sorted by ascending load).
- `Workers.tsx` — SCM workload monitoring. WorkloadBars summary + per-worker cards with active count, status breakdown (MiniBarChart), risk count, and an "Early signal" warning for any worker with demands stalling in UNDER_REVIEW > 3 days. Clicking a worker opens a Dialog with their demand list (DataTable).
- `SlmGovernance.tsx` — WS-02-005 + SLA report review. StatCards (overall compliance, active breaches, warnings, pending reviews). Active Breaches DataTable (with Review action), SLA Compliance Matrix (Service × Customer × Class × compliance %), ComplianceDonut panel, SLA Report Review panel (Approve Report → toast), SlaTrendChart (8-week synthesized from slaEvents).
- `Catalog.tsx` — WS-02-004 read-only catalog. StatCards + filterable card grid (search/domain/layer/SLA class). Click a card → Dialog with full details (SLA profile, offerings table, customer value, owners).
- `Changes.tsx` — Tenant-wide change register. StatCards + DataTable with Type/Status/Complexity/Origin/CE Worker/Created/Updated. Filters: status, type, free-text. Row click → detail Dialog (implementation plan, approval notes, verification notes, rejection reason, technical owner tasks).
- `Analytics.tsx` — Strategic view. KPI row (Total Demands, Avg Cycle Time, Rejection Rate, SLA Compliance). MiniBarChart of demand throughput (created vs closed per week × 8 weeks), pipeline distribution, changes by origin, changes by complexity. SlaTrendChart + ComplianceDonut. DemandPipelineLanes at bottom (clickable → demand-detail).

## API consumption

| Endpoint | Used in | Notes |
|---|---|---|
| GET /api/demands | Dashboard, DemandQueue, Workers, SlmGovernance, Analytics | CM_LEADER sees all tenant demands |
| GET /api/stats | Dashboard, Workers | `workloadByWorker` provides worker list for assignment + workload bars |
| GET /api/sla-events | Dashboard, SlmGovernance, Analytics | Used for compliance matrix, trend chart, breaches |
| GET /api/services?status=ALL | Catalog | ALL to include planned/retired for the leader's read-only view |
| GET /api/changes | Dashboard, Changes, Analytics | Tenant-wide change list |
| PATCH /api/demands/[id] | Dashboard, DemandQueue | `{ assignedScmWorkerId }` to assign |
| POST /api/demands/[id]/approve-quote | Dashboard | The CM Leader governance gate |

## Design

- Teal/emerald theme (foundation globals.css hue 165).
- Governance gates made visually prominent: Quote Approval Queue uses amber accent border + "pending" badge, has inline Approve CTA + Review button.
- Active Breaches panel uses rose-tinted badges and a top alert when breaches exist.
- Workload cards highlight risk with an amber border + risk badge; stalling demands get an inline warning box.
- Responsive: grid layouts collapse from 5→3→2→1 columns. Filter bars wrap on mobile.
- Sticky footer handled by AppShell (not this workspace).
- All charts via the shared widgets (Task 10): `WorkloadBars`, `MiniBarChart`, `SlaTrendChart`, `ComplianceDonut`, `DemandPipelineLanes`.

## Verification

- `bun run lint` on `src/components/workspaces/cm-leader/` → exit 0, no errors.
- `tsc --noEmit --skipLibCheck` filtered to cm-leader → no errors.
- Verified all API endpoints respond 200 as cmleader@cerebree.io (login, /api/stats with workloadByWorker, /api/demands 7 rows, /api/sla-events 6 rows, /api/changes 2 rows, /api/services?status=ALL 6 rows, POST /api/demands/[id]/approve-quote 200).
- DemandDetail integration confirmed via signature match with Task 5's `DemandDetail({ id, role }: { id: string; role: 'SCM_WORKER' | 'CM_LEADER' })`.

## Stage Summary

CM Leader workspace COMPLETE. All 8 view screens implemented with clear governance emphasis: prominent Quote Approval gate, SLA breach governance, workload early-signal monitoring, and a strategic Analytics view. Lint and typecheck pass cleanly.
