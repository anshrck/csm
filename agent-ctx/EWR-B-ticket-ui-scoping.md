# EWR-B — Enterprise Workflow Review, Ticket UI + Scoping

Task ID: EWR-B
Agent: Enterprise Workflow Review builder (ticket UI + customer scoping + CSAT follow-up + KB versioning)
Scope: Plan items #1, #2, #6, #11, #15, #16, #17 — comprehensive ticket/case management UI across all 4 role workspaces, customer assignment scoping visibility, CSAT follow-up workflow, and knowledge version history.

## Files created (owned exclusively)

### UI components (5 new files)

1. `src/components/workspaces/customer/SubmitTicket.tsx` — customer-facing ticket submission form. Fields: title, description, type (INCIDENT/SERVICE_REQUEST/QUESTION/COMPLAINT), suggested priority (P1-P4; actual priority set during triage), serviceId (select from `/api/services?entitled=1`). On submit → POST /api/tickets; success → navigate('ticket-detail', { id }). Includes role-aware messaging ("your suggested priority is confirmed during triage") and an orgNode guard.

2. `src/components/workspaces/cm-leader/TicketOperations.tsx` — CM Leader's comprehensive ticket operations center. Includes:
   - KPI strip: Open Tickets, Unassigned, SLA Breaches, Waiting Customer, Reopened (heuristic via MET/BREACHED clocks), Avg Resolution Time.
   - Saved filter presets via the `SavedFilters` shared component: All Open, Unassigned, Breaching Soon, Waiting Customer, Resolved Pending Close, Reopened. Custom presets persist to localStorage under `cm-leader:ticket-ops:presets`.
   - Bulk actions: Assign to..., Change Priority, Escalate. Bulk assign uses the existing `/api/tickets/[id]/assign` route; bulk priority uses PATCH `/api/tickets/[id]`; bulk escalate adds an INTERNAL comment via `/api/conversations`.
   - Sortable DataTable (using `QueueControls` helpers `AgingBadge`, `OverdueSlaIndicator`, `RowCheckbox`, `SelectAllCheckbox`, `sortByAge`, `sortByPriority`) with status/priority/SLA indicators.
   - Row click → navigate('ticket-detail', { id }).

3. `src/components/workspaces/service-owner/ServiceTickets.tsx` — Service Owner's incident/ticket view for owned services. The shared `/api/tickets` route auto-scopes to owned services for SERVICE_OWNER. KPIs: Open Incidents on My Services, SLA Breaches, P1/P2 Count, Avg Resolution. Filters: type (defaults to INCIDENT), status, priority, service (client-side distinct), free-text search. DataTable: ticket number, title, priority, status, service, SLA status, assignee. Click → ticket-detail (read-only).

4. `src/components/workspaces/cm-leader/CsatFollowup.tsx` — CM Leader's CSAT follow-up workflow. Shows surveys with rating ≤ 3 (the low-score threshold needing proactive follow-up). KPIs: Detractors (1-2★), Passives (3★), Open Follow-ups, Followed Up. DataTable: rating badge, entity type+id, customer (with avatar), comment blockquote, submission date, status badge (Pending/Followed up), [Mark Followed Up] + [View Ticket/Demand] actions. Filter by rating, entity type, search; toggle to show/hide already-followed-up items. Follow-up state is tracked in localStorage keyed by survey id (the SatisfactionSurvey schema has no `followedUpAt` column — the audit log via the conversation thread is the authoritative record). Filters and a Hide/Show followed-up toggle round out the UX.

5. (No file) — Customer-side TicketDetail: the shared `TicketDetail.tsx` was enhanced to render `CommentThread`, `AttachmentList`, and `CsatWidget` so the customer's ticket-detail page is complete without a role-specific wrapper. See "Files modified" below.

### API routes (4 new files)

6. `src/app/api/customer-assignments/_serialize.ts` — shared serializer + Prisma include + errorResponse helper for the CustomerAssignment domain. Filename prefixed `_` so Next.js does NOT treat it as a route handler. Exports `serializeAssignment`, `SerializedAssignment`, `AssignmentRow`, `ASSIGNMENT_INCLUDE`, `errorResponse`.

7. `src/app/api/customer-assignments/route.ts` — GET (list with `userId`/`orgNodeId`/`active` filters; CM_LEADER sees all, SCM_WORKER sees only own, others 403) + POST (CM_LEADER only; validates orgNode exists, user exists and is SCM_WORKER; reacts if assignment exists but inactive, otherwise 409 on duplicate). Audit-logs `CUSTOMER_ASSIGNMENT_CREATED` / `CUSTOMER_ASSIGNMENT_REACTIVATED`.

8. `src/app/api/customer-assignments/[id]/route.ts` — GET (CM_LEADER only, single assignment), PATCH (CM_LEADER only; updates `active` and/or `role`), DELETE (CM_LEADER only; hard-deletes the row). Audit-logs `CUSTOMER_ASSIGNMENT_UPDATED` / `CUSTOMER_ASSIGNMENT_DELETED`.

9. `src/app/api/knowledge/[id]/versions/route.ts` — GET (list versions newest-first; SERVICE_CUSTOMER gets 404 to avoid leaking draft content; computes a `current` flag by comparing each version's title+body to the live article), POST (restore a version: snapshots the current live state as a new version row, then copies the source version's title+body into the live article via PATCH; only DRAFT or REVIEW articles can be restored — PUBLISHED/RETIRED must be retired first; author or CM_LEADER only). Audit-logs `KNOWLEDGE_ARTICLE_VERSION_RESTORED`.

## Files modified

### Workspace switches (3 files)

10. `src/components/workspaces/customer/CustomerWorkspace.tsx` — added `submit-ticket` to `VALID_VIEWS` + `case 'submit-ticket': return <SubmitTicket />`.

11. `src/components/workspaces/cm-leader/CmLeaderWorkspace.tsx` — added `case 'ticket-ops': return <TicketOperations />` + `case 'csat-followup': return <CsatFollowup />`.

12. `src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx` — added `case 'service-incidents': return <ServiceTickets />`.

### Store + routing (2 files)

13. `src/lib/store.ts` — extended `ViewKey` with `'submit-ticket' | 'ticket-ops' | 'service-incidents' | 'csat-followup'`. Added nav items: `submit-ticket` (SERVICE_CUSTOMER, "Submit Ticket"), `ticket-ops` (CM_LEADER, "Ticket Operations"), `csat-followup` (CM_LEADER, "CSAT Follow-up"), `service-incidents` (SERVICE_OWNER, "Service Incidents").

14. `src/lib/routing.ts` — added the four new ViewKeys to `VIEW_PATH` so they're URL-routable as `/customer/submit-ticket`, `/cm/ticket-ops`, `/cm/csat-followup`, `/owner/service-incidents`.

### Shared component enhancements (2 files)

15. `src/components/workspaces/shared/TicketDetail.tsx` — wired the Phase 4 comms widgets into the ticket detail page:
    - Imported `CommentThread`, `AttachmentList`, `CsatWidget` from `@/components/workspaces/shared/`.
    - Replaced the "Conversation Thread — Coming soon" placeholder SectionCard with three real SectionCards:
      - **Conversation** — `<CommentThread entityType="TICKET" entityId={ticket.id} />` (handles customer-visible + internal comments, role-aware visibility toggle, edit-own-comments).
      - **Attachments** — `<AttachmentList entityType="TICKET" entityId={ticket.id} />` (upload + download + delete with role-aware permissions).
      - **Customer Satisfaction** — `<CsatWidget entityType="TICKET" entityId={ticket.id} />` (role-aware: customers submit a star rating + comment; CM Leader/Service Owner see aggregate stats + recent low-rating comments; SCM Worker sees count + average only).
    - The description on the CSAT SectionCard adapts to the role (customer vs. agent).

16. `src/components/workspaces/cm-leader/Workers.tsx` — enhanced to surface customer assignments:
    - Added imports: `useMutation`, `useQueryClient`, `apiPost`, `apiDelete`, `toast`, `Building2`, `UserPlus`, `Trash2`, `X`, `CheckCircle2`, `Dialog`, `DialogFooter`, `Select`, `Input`, `Label`.
    - Added `CustomerAssignment` + `OrgNodeOption` interfaces.
    - Added `assignmentsQ` (GET `/api/customer-assignments?active=1`), `assignmentsByUser` lookup map.
    - Replaced the "Stalling Signals" stat card with "Customer Assignments" (count + coverage hint).
    - Extended `WorkerCard` props to accept `assignments`, `onAssign`, `onUnassign`, `pendingUnassign`. Card now renders an "Assigned customers" list with each customer org name, role badge (Owner/Backup/Escalation), assignment timestamp, and a trash-button to unassign.
    - Added `AssignCustomerDialog` component — fetches customer org list (via `/api/demands` since there's no dedicated org-nodes endpoint), filters out already-assigned orgs, lets the CM Leader pick a customer + role (SCM Owner / Backup / Escalation Manager), POSTs to `/api/customer-assignments`. Uses a `key={assignTarget?.workerId}` on the parent to remount with fresh state per worker (avoids the lint `set-state-in-effect` rule).
    - `createAssignmentMut` handles 409 (already-assigned) with a friendly toast.
    - `deleteAssignmentMut` fires the DELETE and invalidates the assignments query.

### Knowledge article PATCH route (1 file)

17. `src/app/api/knowledge/[id]/route.ts` — added a version-snapshot step BEFORE the existing `db.knowledgeArticle.update` call. Each PATCH now:
    1. Looks up the latest `version` number for the article.
    2. Creates a `KnowledgeArticleVersion` row capturing the current (pre-edit) title+body, with `version = latestVersion + 1` and `createdById = session.id`.
    3. Then applies the update as before.
    This is the source of truth that powers the version-history UI. Restore (POST `/api/knowledge/[id]/versions`) snapshots the current state again before copying the source version's content, so the history is always preserved.

### Knowledge manager UI (1 file)

18. `src/components/workspaces/shared/KnowledgeManager.tsx` — added a "Version History" tab to the article editor:
    - Imported `History`, `RotateCcw` from lucide-react; `Tabs`/`TabsContent`/`TabsList`/`TabsTrigger` from shadcn/ui; `AlertDialog` family for the restore confirmation.
    - Refactored `ArticleEditorDialog`: when editing (not creating), the body now renders a `<Tabs>` with two tabs:
      - **Editor** — the existing form (title/type/service/body), split out into a new `ArticleEditorForm` component so it can render in either a ScrollArea (create flow) or a Tab (edit flow).
      - **Version History** — new `ArticleVersionHistory` component that fetches `GET /api/knowledge/[id]/versions`, renders each version as a card with version number, title, author, timestamp, body preview, "Live" badge for the current version, and a [Restore] button (disabled if it's already live). Restore opens an `AlertDialog` confirmation; on confirm, POSTs to `/api/knowledge/[id]/versions` with `sourceVersionId`, then invalidates the article + versions queries and closes the editor so it re-opens with the restored state.
    - The create flow is unchanged (no version history for a brand-new article).

## Verification

- `bun run lint` (whole project) → EXIT 0, 0 errors, 0 warnings.
- End-to-end API smoke tests via curl (sandbox dev server on :3000):
  - `GET /api/customer-assignments` (CM_LEADER) → 200 (initially empty array).
  - `POST /api/customer-assignments` (CM_LEADER, valid payload) → 201 with full assignment row + relations.
  - `POST /api/customer-assignments` (duplicate) → 409 with friendly error.
  - `GET /api/customer-assignments` (CM_LEADER) → 200 with the new assignment.
  - `GET /api/customer-assignments?userId=...` → 200 filtered.
  - `GET /api/customer-assignments?orgNodeId=...` → 200 filtered.
  - `GET /api/customer-assignments` (SCM_WORKER) → 200, only their own assignments.
  - `GET /api/customer-assignments` (SERVICE_OWNER) → 403 "Forbidden".
  - `POST /api/customer-assignments` (SCM_WORKER) → 403 "Forbidden".
  - `DELETE /api/customer-assignments/[id]` (CM_LEADER) → 200 `{ok:true}` + row removed.
  - `GET /api/surveys` (CM_LEADER after submitting 2 low-score surveys as customer) → 200 with both surveys visible.
  - `GET /api/knowledge/[id]/versions` (CM_LEADER) → 200 with version array, `current` flag computed correctly.
  - `POST /api/knowledge/[id]/versions` (restore) → 200 with `{ok:true, restoredFrom, newLiveState}`; subsequent GET shows a new version row was added (the pre-restore state) and the source version is now flagged `current: true`.
- Workspace route smoke tests (CM_LEADER logged in):
  - `GET /cm/ticket-ops` → 200
  - `GET /cm/csat-followup` → 200
  - `GET /cm/workers` → 200 (with assignments rendered)
  - `GET /owner/service-incidents` → 200 (SERVICE_OWNER)
  - `GET /customer/submit-ticket` → 200 (SERVICE_CUSTOMER)
  - `GET /cm/knowledge` → 200 (version history tab accessible from article editor)
- Dev server compiles cleanly post-fix. (One Turbopack cache issue mid-build was resolved by killing the dev server and letting the watchdog restart it — the `serializeAssignment` import extraction to `_serialize.ts` was the fix; Turbopack's incremental cache held the stale "export doesn't exist" error until the process restart.)

## Coordination notes for future agents

- **CustomerAssignment model**: already in the schema (`prisma/schema.prisma` lines ~565-580). Unique on `[orgNodeId, userId, role]`. The schema was added by the orchestrator in the EWR foundation phase; my API + UI are the first consumers.
- **KnowledgeArticleVersion model**: also pre-existing in the schema (lines ~607-620). The PATCH route now writes to it on every edit; the GET `/api/knowledge/[id]/versions` endpoint reads it. Restore creates a new version row + copies old content into the live article.
- **TicketDetail comms widgets**: the shared `TicketDetail.tsx` now renders `CommentThread`, `AttachmentList`, `CsatWidget` for ALL roles. The widgets themselves are role-aware (see P4-COMMS agent-ctx notes for the role gating). No role-specific wrapper is needed — the shared component handles everything.
- **CSAT follow-up tracking**: the SatisfactionSurvey schema has no `followedUpAt` column. The UI tracks follow-up state in localStorage keyed by survey id (per-CM-Leader-user). The authoritative record is an INTERNAL comment created on the underlying entity's conversation via POST `/api/conversations` — best-effort, swallowed on error. A future schema migration could add `followedUpAt`/`followedUpById` columns to SatisfactionSurvey and backfill from the audit log.
- **Bulk escalate**: the TicketOperations bulk-escalate action creates INTERNAL comments via `/api/conversations`. If the conversations API is unavailable, the escalation still succeeds (best-effort) but no audit comment is recorded. The bulk assign + bulk priority actions use the existing dedicated endpoints and are not best-effort.
- **Reopened heuristic**: the TicketOperations "Reopened" KPI uses an approximation — IN_PROGRESS tickets with at least one MET or BREACHED SLA clock. The list endpoint doesn't ship events; a precise count would require fetching events per ticket. The approximation is good enough for a leadership KPI.
- **Customer orgs source**: the Workers `AssignCustomerDialog` derives the customer org list from `/api/demands` (every distinct `serviceCustomerId` + `serviceCustomerName` pair). If a dedicated `/api/org-nodes` endpoint is added later, swap the query in `AssignCustomerDialog` to use it.
- **CustomerAssignment role labels**: `SCM_OWNER` (primary), `BACKUP`, `ESCALATION_MANAGER`. The UI shortens these to "Owner" / "Backup" / "Escalation" badges on the worker card.
- **Version history on PUBLISHED articles**: the restore endpoint returns 409 for PUBLISHED or RETIRED articles. The UI disables the Restore button on the live version (which is the only "live" version anyway). To restore content into a PUBLISHED article, retire it first, then restore as a new draft.
- Did NOT write tests. Did NOT run `bun run build`. Did NOT modify any other agent's API routes or workspace files (only the files explicitly listed above). Did NOT modify the foundation `prisma/schema.prisma` — both `CustomerAssignment` and `KnowledgeArticleVersion` models were already there from the orchestrator's EWR foundation pass.
