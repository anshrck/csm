# EWR-D — Enterprise Workflow Review: Audit + Delivery + Search + Links

**Task ID**: EWR-D
**Agent**: Enterprise Workflow Review — Audit + Delivery + Search + Links (CM Leader oversight)
**Date**: 2026-07-18
**Covers plan items**: #5 (SLA Clock UI), #9 (EntityLink unification), #10 (Audit Log Viewer), #13 (Notification Delivery Admin), #18 (EntityLink API + UI), #19 (Global Search expansion)

## Summary

Built five new features for the CereBree uSMS platform — three CM Leader oversight views (Audit Log, Delivery Admin, expanded Search) and two shared components (EntityLinks, SlaClockPanel) wired into TicketDetail + DemandDetail pages across all 4 role workspaces. Created 3 new API routes and 4 new UI components. Modified 7 existing files (store/routing wiring, workspace switch, detail-page rendering, search palette rewrite).

## Files Created (7)

### API routes (3)
1. **`src/app/api/entity-links/route.ts`** — GET (list links from/to an entity, with server-side resolution of the "other side" summary) + POST (create link with both-side access check + audit log).
2. **`src/app/api/entity-links/[id]/route.ts`** — DELETE (remove link with both-side write-access check + audit log snapshot).
3. **`src/app/api/search/route.ts`** — GET ?q=<text> searches across demands/tickets/services/knowledge/changes/problems with role-scoping per type. Returns `{results: [{type, id, title, subtitle, url}]}`.

### UI components (4)
4. **`src/components/workspaces/cm-leader/AuditViewer.tsx`** — full audit log viewer with filters (actor select, entity type select, action text contains, date range), custom expandable row layout with before/after JSON payloads, CSV export, and a load-more button.
5. **`src/components/workspaces/cm-leader/DeliveryAdmin.tsx`** — notification delivery queue oversight view with stat cards (PENDING/SENT/FAILED/success rate), per-channel breakdown, filters (status/channel/date range), [Retry] on FAILED deliveries, and [Process Pending] flush button.
6. **`src/components/workspaces/shared/EntityLinks.tsx`** — reusable component to view/create/remove entity links. Fetches both link directions in parallel; renders each link with entity-type badge, link-type badge, title (clickable), [Open] + [Remove] buttons. [Add Link] dialog searches via `/api/search` and supports 7 link types.
7. **`src/components/workspaces/shared/SlaClockPanel.tsx`** — self-contained SLA clock panel that fetches its own clocks by ticketId. Renders one card per clock (RESPONSE + RESOLUTION) with status badge, progress bar, due date, live countdown ("Xh Ym remaining" or "Breached Xh ago"), paused-time total. Auto-refreshes every 60s; countdown re-renders every 30s client-side.

## Files Modified (7)

1. **`src/lib/store.ts`** — added `'audit'` and `'delivery-failures'` to `ViewKey` union; added both to `NAV_BY_ROLE` for CM_LEADER with icons `ScrollText` and `MailCheck`.
2. **`src/lib/routing.ts`** — added `audit: 'audit'` and `'delivery-failures': 'delivery-failures'` to `VIEW_PATH` so the new views are URL-addressable (`/cm/audit`, `/cm/delivery-failures`).
3. **`src/components/workspaces/cm-leader/CmLeaderWorkspace.tsx`** — imported `AuditViewer` + `DeliveryAdmin`; wired `case 'audit'` and `case 'delivery-failures'`.
4. **`src/components/workspaces/shared/TicketDetail.tsx`** — imported `EntityLinks` + `SlaClocksPanel` (alias); removed the old inline `SlaClockPanel` function + `Gauge` import + unused `responseClock`/`resolutionClock` locals; rendered `<SlaClocksPanel ticketId={id} />` and `<EntityLinks entityType="TICKET" entityId={id} />` in the right column.
5. **`src/components/workspaces/shared/DemandDetail.tsx`** (SCM/CM view) — imported `EntityLinks`; rendered `<EntityLinks entityType="DEMAND" entityId={demand.id} />` after the Activity Log section.
6. **`src/components/workspaces/customer/DemandDetail.tsx`** — imported `EntityLinks`; rendered `<EntityLinks entityType="DEMAND" entityId={demand.id} readOnly />` after the Activity Log section (read-only for customers).
7. **`src/components/search/CommandPalette.tsx`** — rewrote to consume `/api/search?q=` as the primary source (debounced via `useDeferredValue`); added Tickets/Knowledge/Communications/Audit Logs groups; added Audit Log + Delivery Admin quick actions for CM_LEADER.

## API Contracts (for downstream agents)

### `/api/audit-logs` (GET) — concurrent agent's canonical shape
- Returns: `AuditLogRow[]` (flat array, NOT an envelope)
- Filters: `actorId`, `entityType`, `entityId`, `action`, `dateFrom`, `dateTo`, `customerOrgId`, `limit` (max 500)
- Role scoping: CM_LEADER=all; SERVICE_OWNER=owned-service entities; SCM_WORKER=assigned-customer-orgs + own actions; SERVICE_CUSTOMER=403
- Note: my UI consumes this flat-array shape.

### `/api/entity-links` (GET / POST)
- GET: `?fromType=TICKET&fromId=abc[&toType=DEMAND&toId=xyz][&linkType=RELATES_TO]` → returns `EntityLinkRow[]` with each row including a server-resolved `summary` object for the "other side" (title/subtitle/url) and an `accessible` boolean.
- POST body: `{fromType, fromId, toType, toId, linkType}` → 201 created (or 200 if idempotent reuse). Both-side access check (write). Audit log: `ENTITY_LINK_CREATED`.
- Valid entity types: TICKET, DEMAND, CHANGE, PROBLEM, SLA_EVENT, KNOWLEDGE_ARTICLE, SLA_REPORT, GOVERNANCE_DECISION, COMMUNICATION.
- Valid link types: CAUSED_BY, RELATES_TO, CONVERTED_TO, FULFILLED_BY, DUPLICATES, BLOCKS, DEPENDS_ON.

### `/api/entity-links/[id]` (DELETE)
- Both-side write-access check. Audit log: `ENTITY_LINK_DELETED` with pre-deletion snapshot in `before`.

### `/api/search` (GET)
- `?q=<text>` (min 2 chars) → `{results: [{type, id, title, subtitle, url}]}`.
- Searches 6 entity types in parallel; role-scoped per type.
- Caps: 8 per type, 60 total.
- `url` is a relative `/<role-prefix>/<view-path>[/<id>]` string the client can navigate to.

## UI / UX Decisions

- **Custom row layout over DataTable** for AuditViewer + DeliveryAdmin — both need richer per-row content (expandable JSON payloads, retry buttons, error blocks) that don't fit cleanly in a strict column grid. Used a `ScrollArea` with `max-h-[calc(100vh-380px)]` to keep the list scrollable inside the workspace.
- **Tone-coded badges** throughout: action badges (green=CREATE, sky=UPDATE, amber=CLOSE, rose=DELETE/BREACH), entity-type badges (sky=Ticket, teal=Demand, violet=Change, rose=Problem, amber=SLA, emerald=Knowledge), link-type badges (rose=CAUSED_BY/BLOCKS, sky=RELATES_TO, etc.).
- **Live countdown** in SlaClockPanel via a `useNow(30_000)` hook — re-renders every 30s without re-fetching from the server. Server data is refreshed every 60s via `refetchInterval`.
- **Two-direction fetch** in EntityLinks — fetches both `?fromType=...&fromId=...` and `?toType=...&toId=...` in parallel, then merges + dedupes by link ID. Each merged row is tagged with `direction: 'from' | 'to'` so the UI can show a "(reverse link)" hint when the link was created from the other side.
- **Read-only mode** for customer-facing EntityLinks — passes `readOnly` prop to hide [Add Link] and [Remove] buttons; customers see but cannot modify links.

## Verification

- `bun run lint` → EXIT 0 (0 errors, 0 warnings across the entire project).
- `bunx tsc --noEmit --skipLibCheck` → 0 errors in any of my new/modified files. The 3 remaining TS errors are pre-existing in other agents' files (`stats/route.ts:174`, `TicketOperations.tsx:593`, `KnowledgeManager.tsx:878`).
- End-to-end smoke tests via curl as cmleader@cerebree.io:
  - GET /api/search?q=access → 200 with multi-type results
  - GET /api/audit-logs?limit=3 → 200 with array
  - GET /api/entity-links?fromType=DEMAND&fromId=nonexistent → 200 with []
  - POST /api/entity-links → 201 (then cleaned up via DELETE)
  - DELETE /api/entity-links/{id} → 200 with {ok:true}
  - GET /api/sla-clocks?ticketId=... → 200 with serialized clocks
  - GET /api/notification-deliveries?stats=1 → 200 with stats
  - GET /cm/audit → 200 (page renders)
  - GET /cm/delivery-failures → 200 (page renders)
- Dev server log shows clean 200s on all new routes; no compile errors.

## Coordination Notes for Downstream Agents

- The `/api/audit-logs/route.ts` file was concurrently authored by a parallel agent. Their final shape is a flat array (not the `{rows, cursor, total}` envelope). My UI consumes the flat-array shape. If you change the route, update AuditViewer.tsx + CommandPalette.tsx accordingly.
- CM_LEADER bypasses `canAccessEntity` by design — EntityLinks created by CM_LEADER are not validated for entity existence on both sides. For SCM_WORKER/SERVICE_OWNER/SERVICE_CUSTOMER, the access check properly validates both sides. If you need stricter validation for CM_LEADER, add an explicit existence check in the POST handler.
- The `EntityLink` model already existed in the schema (added by the foundation). The schema supports 7 link types in my API (`CAUSED_BY`, `RELATES_TO`, `CONVERTED_TO`, `FULFILLED_BY`, `DUPLICATES`, `BLOCKS`, `DEPENDS_ON`) — broader than the 4 documented in the schema comment.
- The `/api/search` endpoint is the canonical cross-entity search. The CommandPalette uses it as the primary source; the old multi-endpoint useQueries pattern was removed.
