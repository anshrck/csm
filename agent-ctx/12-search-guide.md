# Task 12 — Global Search + Role Guide (Agent: search-guide)

## Task
Build a self-mounting Global Search command palette (Cmd/Ctrl+K) and a self-mounting
Role Guide reference viewer (floating button + Cmd/Ctrl+G). Both are self-contained
client components that mount themselves via a global key listener / floating button
and enhance every workspace without modifying the foundation shell.

## Files Owned (created exclusively by this agent)
- `src/components/guide/guides.ts` — data file exporting `ROLE_GUIDES` (Record<Role, RoleGuide>)
  with concise structured summaries extracted from the 4 Role_Guide_*_v1_0.txt source files.
  Each guide has: title, tagline, layer, and sections (heading + paragraphs/bullets).
- `src/components/guide/RoleGuidePanel.tsx` — default-exported self-mounting role guide viewer.
  Renders a `fixed bottom-6 right-6 z-40` round FAB (BookOpen icon, teal/emerald) and a
  max-w-2xl / max-h-[80vh] Dialog with a role selector (4 tabs) and ScrollArea body.
- `src/components/search/CommandPalette.tsx` — inner cmdk palette used by GlobalSearch.
  Fetches role-scoped entities via `useQueries` + `apiGet`, renders grouped CommandItems
  (Quick actions / Demands / Services / Changes / Problems) with role-appropriate navigation.
- `src/components/search/GlobalSearch.tsx` — default-exported self-mounting Cmd/Ctrl+K palette
  wrapper. Wires navigation, Cogni (setAiOpen), and sign-out (calls /api/auth/logout).

## Self-Mounting Contract (how to integrate)
The orchestrator drops these two components into the page (alongside AppShell + AiPanel):

```tsx
import GlobalSearch from '@/components/search/GlobalSearch';
import RoleGuidePanel from '@/components/guide/RoleGuidePanel';

// inside the authenticated return:
<>
  <AppShell>{workspace}</AppShell>
  <AiPanel />
  <GlobalSearch />      {/* Cmd/Ctrl+K palette */}
  <RoleGuidePanel />    {/* floating book button + Cmd/Ctrl+G */}
</>
```

Both components:
- Are `'use client'` and register their own `keydown` listeners on mount (cleaned up on unmount).
- Render nothing until a session is present (`if (!session) return null`).
- Render their own Dialog overlays (no external trigger required).

## Behavior Summary

### GlobalSearch (Cmd/Ctrl+K)
- Global keydown listener intercepts Cmd/Ctrl+K anywhere, toggles a centered max-w-xl Dialog.
- The Dialog mounts `CommandPalette` only while open (radix portal unmounts content when closed),
  so the role-scoped `useQueries` fetch fires fresh on each open (staleTime 15s for snappy reopen).
- Per-role data sources (all GET, fail gracefully to [] if endpoints aren't built yet):
  - SERVICE_CUSTOMER: `/api/demands?mine=1`, `/api/services?entitled=1`
  - SCM_WORKER: `/api/demands?assigned=me`, `/api/demands?unassigned=1`, `/api/services`
  - CM_LEADER: `/api/demands`, `/api/services`, `/api/changes`
  - SERVICE_OWNER: `/api/services?owner=me`, `/api/changes`, `/api/problems?owner=me`
- Groups (cmdk filters automatically via the input): Quick actions first, then Demands,
  Services, Changes, Problems (only those that returned data + apply to the role).
- Each entity CommandItem shows an icon + title + subtitle (customer / domain / type / service)
  + a status chip; custom `value` includes subtitle text so search matches it.
- Navigation:
  - Demand → `navigate('demand-detail', { id })`
  - Service → `navigate('catalog')` (or `'portfolio'` for SERVICE_OWNER)
  - Change → `navigate('changes')`
  - Problem → `navigate('problems')`
- Quick actions (role-appropriate): [Submit a Demand] (customer), [New Demand on behalf]
  (scm), [View SCM Workers] (cm leader), [Open Service Portfolio] (owner), plus shared
  [Go to Dashboard], [Open Cogni] (→ setAiOpen(true)), [Sign out] (→ /api/auth/logout + logout()).
- Footer hint: "type to filter" + "↑↓ navigate · ↵ select · esc close" with kbd-styled chips.
- Loading state shows 4 Skeleton rows; empty state shows "No matches found."

### RoleGuidePanel (FAB + Cmd/Ctrl+G)
- Renders a `fixed bottom-6 right-6 z-40` round primary-colored Button with BookOpen icon.
  Hover scales 1.05, accessible label + title tooltip.
- Global Cmd/Ctrl+G shortcut toggles the dialog (gated: ignored while typing in input/textarea/
  contenteditable so it doesn't fight the user).
- Dialog: max-w-2xl, max-h-[85vh]/80vh, custom header (no default close button — own X button),
  teal-tinted gradient header with title "Role Guide — [Role Name]", subtitle
  "CereBree uSMS · what your role means structurally.", tagline + layer line, and a horizontally
  scrollable role selector (4 segmented buttons; current role marked "Your role", others
  "Cross-role context").
- Body: ScrollArea with structured sections per role — "Who You Are" (paragraphs),
  "Your Accountability" / "Your Authorities" / "Your Limits" / "Governance Gates" / "Touchpoints"
  / "What Good Looks Like" (bullets), each with a small primary dot + heading + content.
- Closing note card: "Based on the uSMS Role Guide Suite v1.0. Summarized for in-app reference…"
- Footer: "esc to close · switch roles above" + "uSMS Role Guide Suite v1.0".
- Defaults to the current user's role on open; resets selection on close so reopening
  returns to the current role.

## Guides Content (guides.ts)
Extracted key sections from each of the 4 Role_Guide_*_v1_0.txt files (~150-300 words per role):
- SERVICE_CUSTOMER: Who You Are, Your Accountability, Your Authorities, What You Cannot Do,
  What Good Looks Like.
- SCM_WORKER: Who You Are, Your Accountability, Your Authorities, Your Limits, What Good Looks Like.
- CM_LEADER: Who You Are, Your Accountability, Your Governance Gates, Your Authorities,
  What Good Looks Like.
- SERVICE_OWNER: Who You Are, Your Accountability, What Service Ownership Is Not, Your Touchpoints,
  What Good Looks Like.

## Design Notes
- Teal/emerald theme throughout (primary color, primary/10 tints, primary dots/bullets).
- No indigo/blue introduced.
- Responsive: palette max-w-xl with subtitle columns hidden on mobile (`hidden sm:inline`);
  guide dialog max-w-2xl with scrollable role selector on small screens.
- Accessibility: ARIA roles (tablist/tab), aria-selected, sr-only DialogTitle/Description for
  the palette (its header is visual), aria-labels on icon buttons, focus-visible rings.
- Uses existing shadcn/ui primitives only (Dialog, ScrollArea, Button, Badge, Skeleton, Command,
  Separator) + lucide-react icons. No new dependencies.

## Verification
- `npx eslint src/components/search/ src/components/guide/` → clean (0 errors, 0 warnings).
- `bunx tsc --noEmit` → no errors in any of my files (pre-existing errors in other agents'
  workspaces/API routes remain, none mine).
- `bun run lint` shows 1 error in AppShell.tsx + 1 warning in CustomerWorkspace.tsx — both
  foundation/other-agent files I must not modify; my files contribute zero issues.

## Integration Notes for Orchestrator
- These components are NOT yet wired into `src/app/page.tsx` (per the contract, I do not modify
  page.tsx). Add `<GlobalSearch/>` and `<RoleGuidePanel/>` to the authenticated return in page.tsx
  (see snippet above).
- Both no-op when there's no session, so they're safe to mount unconditionally after AppShell.
- The palette depends on API routes owned by agents 1-4 (`/api/demands`, `/api/services`,
  `/api/changes`, `/api/problems` with the query params listed above). Until those exist, the
  palette simply shows Quick actions + "No matches found." for entity groups — no crash.

## Stage Summary
COMPLETE. Two self-mounting enhancement components ready to drop into the app shell. Both are
self-contained, theme-consistent, responsive, accessible, and degrade gracefully when backing
API endpoints are absent.
