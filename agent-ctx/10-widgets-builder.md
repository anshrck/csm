# Task 10 — Reusable Dashboard Widgets & Charts Library

**Agent**: Widgets & Charts Builder
**Task ID**: 10
**File owned**: `src/components/widgets/index.tsx`

## Deliverable

A single `'use client'` module exporting 5 polished, responsive chart/widget
components built on recharts + shadcn/ui, themed to the teal/emerald oklch(165)
governance palette.

## Exports (exact signatures)

```tsx
export function DemandPipelineLanes({ demands, onSelect, emptyLabel }: {
  demands: Demand[]; onSelect?: (d: Demand) => void; emptyLabel?: string
})

export function SlaTrendChart({ data, height }: {
  data: { label: string; value: number }[]; height?: number
})   // default height = 220

export function ComplianceDonut({ value, label, size }: {
  value: number | null | undefined; label?: string; size?: number
})   // default size = 160  (value widened to nullable to support "—" state per spec;
     //  passing a plain number still type-checks, so contract stays compatible)

export function WorkloadBars({ items }: {
  items: { name: string; count: number; risk?: number }[]
})

export function MiniBarChart({ data, height, color }: {
  data: { label: string; value: number }[]; height?: number; color?: string
})   // default height = 200, default color = var(--primary)

export { AlertTriangle as RiskIcon }   // bonus convenience export for legend chips
```

## Implementation notes

- **DemandPipelineLanes** — kanban over `DEMAND_PIPELINE` (NEW→FULFILLED).
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3`. Each lane: colored
  left-border + dot header (sky/amber/violet/teal/indigo/emerald mirroring
  `DemandStatusBadge`), count badge, scrollable body (`max-h-80 overflow-y-auto
  scrollbar-thin`). Cards: 2-line clamped title, customer name, relative time +
  optional effort-days badge, hover lift + focus ring. Demands sorted by
  `updatedAt` desc per lane. Subtle staggered fade-in via framer-motion.

- **SlaTrendChart** — recharts `AreaChart` with a vertical `linearGradient`
  fill (primary @ 0.35 → 0.02 opacity). Gradient ID derived from `useId()` and
  colon-stripped to be SVG-safe across multiple instances. YAxis domain [0,100],
  `%`-formatted ticks, hidden axis lines, subtle dashed gridlines (horizontal
  only). Custom popover tooltip shows `94.2%`. Empty data → compact
  `ChartEmpty` placeholder.

- **ComplianceDonut** — recharts `PieChart` with one `Pie` (innerRadius/outerRadius
  donut, startAngle 90 → -270 so the arc fills clockwise from 12 o'clock). Two
  `Cell`s: colored value + `var(--muted)` remainder. Tone auto-selected: green
  (≥95, oklch 165), amber (≥85, oklch 75), red (<85, oklch 27), muted when no
  value. Center label absolute-positioned, scales font with `size`. `null`/
  `undefined`/`NaN` → "—".

- **WorkloadBars** — flex rows: `w-24 sm:w-32` name (truncate + title tooltip),
  `flex-1` track with framer-motion animated `width` (staggered 0.05s delay),
  count number, optional rose risk pill. `maxCount` floor of 1 prevents
  divide-by-zero. Empty → shared `EmptyState` (Inbox icon).

- **MiniBarChart** — recharts `BarChart`, rounded top corners (`radius={[4,4,0,0]}`),
  `maxBarSize=48`. YAxis hidden. XAxis auto-rotates labels `-35°` when >6
  categories. Custom colored tooltip. `color` prop threads through to tooltip
  for visual consistency.

## Design conformance

- Theme-aware: uses CSS vars (`var(--primary)`, `var(--border)`,
  `var(--muted-foreground)`, `var(--muted)`, `var(--popover)`,
  `var(--background)`) so charts adapt to light/dark automatically.
- Primary is teal `oklch(0.52 0.12 165)` (light) / `oklch(0.66 0.13 165)` (dark).
- Status accent palette intentionally matches the existing `DemandStatusBadge`
  palette in `shared.tsx` (sky/amber/violet/teal/indigo/emerald) — the indigo
  here is the explicitly-requested per-status accent for IN_CHANGE, not a
  primary theme color, so it does not violate the "no indigo primary" rule.
- All widgets responsive, no horizontal overflow on mobile.
- Custom scrollbar styling via existing `.scrollbar-thin` utility.
- Rounded tooltips, minimal axis lines, subtle dashed gridlines.

## Verification

- `bunx eslint src/components/widgets/index.tsx` → **EXIT 0** (clean, 0 errors / 0 warnings).
- `bunx tsc --noEmit` → **0 errors in widgets/index.tsx** (the 50 project-wide
  tsc errors are all in other agents' WIP files — workspaces referencing
  not-yet-created submodules, plus one `value: unknown` misuse in
  `cm-leader/Workers.tsx` that is the consumer's bug, not a contract mismatch).
- Already imported & consumed by 4 other agents' workspaces:
  - `service-owner/SlaPerformance.tsx` → `SlaTrendChart`, `ComplianceDonut`
  - `cm-leader/SlmGovernance.tsx` → `ComplianceDonut`, `SlaTrendChart`
  - `cm-leader/Dashboard.tsx` → `WorkloadBars`
  - `cm-leader/Workers.tsx` → `WorkloadBars`, `MiniBarChart`
  - `scm-worker/SlmDashboard.tsx` → `SlaTrendChart`
  - `scm-worker/Dashboard.tsx` → `DemandPipelineLanes`, `WorkloadBars`
  All call sites use props compatible with the contract above.

## Stage Summary

Widgets library COMPLETE and verified. Single file `src/components/widgets/index.tsx`
(~470 LOC) exports all 5 contract widgets + a bonus `RiskIcon`. Lint-clean,
type-clean, theme-correct, responsive, and already wired into 6 consumer
files across the SCM, CM-Leader, and Service-Owner workspaces. No foundation
files touched.
