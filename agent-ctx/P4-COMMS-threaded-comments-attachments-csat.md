# P4-COMMS — Threaded Comments + Attachments + CSAT APIs

Task ID: P4-COMMS
Agent: Phase 4 comms builder
Scope: Plan items 11–13 — Threaded Comments API, Attachments API, Customer Satisfaction (CSAT) API + shared UI widgets.

## Files created (owned exclusively)

### API routes

1. `src/app/api/conversations/_serialize.ts` — shared serializers, `CONVERSATION_INCLUDE`, `errorResponse`, `VALID_ENTITY_TYPES`, `asEntityType`. Surfaces `Comment` + `Conversation` types + author display info (avatarColor, role, title) so the UI never needs a second round-trip.
2. `src/app/api/conversations/route.ts` — GET (find by `entityType`+`entityId`, optional `createIfMissing=1` upsert; returns an empty shell with `id=null` when none exists) + POST (explicit create, upserts if a conversation already exists). SERVICE_CUSTOMER scoping enforces ownership of the underlying entity via `resolveServiceCustomerId` (handles TICKET, DEMAND, CHANGE→originDemand, SLA_EVENT). Comments array is filtered to `CUSTOMER_VISIBLE` for SERVICE_CUSTOMER before serialization.
3. `src/app/api/conversations/[id]/comments/route.ts` — GET (role-scoped: SERVICE_CUSTOMER only sees CUSTOMER_VISIBLE; SERVICE_CUSTOMER can't read conversations outside their orgNode) + POST (validates body+visibility; SERVICE_CUSTOMER cannot post INTERNAL; bumps `conversation.updatedAt`; creates `COMMENT_CREATED` audit log; fans out `CommunicationReceived` notifications to the customer org's SERVICE_CUSTOMER users when an internal role posts a CUSTOMER_VISIBLE comment). Returns the full refreshed conversation so callers can update in one shot.
4. `src/app/api/conversations/comments/[id]/route.ts` — PATCH (author-only edit; sets `body` + `editedAt=now()`; visibility cannot be changed; `COMMENT_EDITED` audit log with before/after).
5. `src/app/api/attachments/_serialize.ts` — shared serializers, `ATTACHMENT_INCLUDE`, `MAX_FILE_BYTES` (10 MB), `isAllowedMime` (image/*, application/pdf, text/*, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.*), `buildStorageKey` (`uploads/yyyy-mm/<ts>-<rand>-<safe-name>`), `formatBytes`, `asAttachmentEntityType`. The serializer exposes a `url` field (`/${storageKey}`) for direct download.
6. `src/app/api/attachments/route.ts` — GET (list with `entityType`+`entityId` filter; SERVICE_CUSTOMER ownership gate on the underlying entity) + POST (multipart/form-data upload: `entityType`, `entityId`, `file`; enforces 10 MB max + allowed MIME types; writes file to `public/uploads/yyyy-mm/`; inserts Attachment row with `storageKey` = relative path; `ATTACHMENT_UPLOADED` audit log).
7. `src/app/api/attachments/[id]/route.ts` — GET (metadata; SERVICE_CUSTOMER ownership gate) + DELETE (uploader OR CM_LEADER only; best-effort `fs.unlink`; `ATTACHMENT_DELETED` audit log with before snapshot).
8. `src/app/api/surveys/_serialize.ts` — shared serializers, `SURVEY_INCLUDE`, `asSurveyEntityType` (TICKET|DEMAND only), `serializeSurvey` (joins customer display name), `errorResponse`.
9. `src/app/api/surveys/route.ts` — GET (filter by `entityType`/`entityId`/`customerId`; role-scoped: SERVICE_CUSTOMER sees only own surveys; CM_LEADER sees all; SERVICE_OWNER sees surveys for entities tied to services they own via JSON column parsing for demands + Prisma relation for tickets; SCM_WORKER sees surveys for demands assigned to them) + POST (SERVICE_CUSTOMER only; validates rating is integer 1–5; ownership check on the underlying entity; unique constraint on `[entityType, entityId, customerId]` returns 409; `SURVEY_CREATED` audit log; if `rating <= 2`, fans out a `CommitmentEscalated` low-rating alert notification to all CM_LEADER users).
10. `src/app/api/surveys/stats/route.ts` — GET (CM_LEADER + SERVICE_OWNER only; returns `count`, `average`, `distribution` ({1..5}), `trend` (per ISO-week-start), `byEntityType` (TICKET/DEMAND breakdown), `lowRatingCount`, `detractorCount`, `promoterCount`, `nps`; SERVICE_OWNER scope mirrors the GET /api/surveys role scoping).

### UI components (under `src/components/workspaces/shared/`)

11. `CommentThread.tsx` — props `{ entityType, entityId, customerScope?, className? }`. Fetches GET /api/conversations, displays threaded comments with `UserAvatar` + author name/title + visibility badge (INTERNAL = amber Lock badge; CUSTOMER_VISIBLE = muted Eye badge), `RelativeTime` timestamp, edited indicator. Input box at the bottom with a CUSTOMER_VISIBLE/INTERNAL toggle (visible only to SCM/CM/Owner — customers always post CUSTOMER_VISIBLE). Edit button on own comments (inline `Textarea` + Save/Cancel). Auto-refreshes every 5s via `refetchInterval`. First comment POST auto-creates the conversation shell via POST /api/conversations. Framer-motion entrance animations + custom scrollbar-thin list. Toast on errors.
12. `AttachmentList.tsx` — props `{ entityType, entityId, className? }`. Lists attachments with file icon (image/PDF/spreadsheet/generic), name (download link), size, MIME, uploader (`UserAvatar` + name), `RelativeTime`. Upload button → hidden file input (multiple, accepts image/*,application/pdf,text/*,.xls,.xlsx,.doc,.docx,.ppt,.pptx). Delete button visible only to uploader or CM_LEADER (with confirm dialog). Download button (anchor with `download` attribute). Auto-refreshes every 10s. Framer-motion entrance + scrollbar-thin.
13. `CsatWidget.tsx` — props `{ entityType, entityId, className? }`. Renders role-appropriate UI:
    - **SERVICE_CUSTOMER**: star rating selector (1–5, hover preview), optional comment `Textarea`, Submit button. After submission, shows read-only "thanks" card with their rating + comment + timestamp. 409 conflict handler invalidates and shows existing survey. Low-rating copy escalates to CM Leader.
    - **CM_LEADER / SERVICE_OWNER**: average rating (big numeric + star icons), 3 KPI tiles (Promoters / Detractors / NPS), 5-bar distribution chart (color-coded green/amber/red), recent low-rating comments section (rating ≤ 2, last 3). Empty state when no responses.
    - **SCM_WORKER**: read-only summary card (count + average) — individual comments are hidden to protect customer identity.

## Verification

- `bunx eslint src/app/api/conversations src/app/api/attachments src/app/api/surveys src/components/workspaces/shared/CommentThread.tsx src/components/workspaces/shared/AttachmentList.tsx src/components/workspaces/shared/CsatWidget.tsx` → EXIT 0 (0 errors, 0 warnings).
- `bunx tsc --noEmit --skipLibCheck` → 0 errors in any new file (all 13 project-wide TS errors are in other agents' files: `src/app/api/tickets/_serialize.ts`, `src/app/api/sla-clocks/route.ts`, `src/lib/notifications.ts`, `src/lib/notification-delivery.ts`).
- `bun run lint` → only 1 pre-existing error in `src/app/api/tickets/_serialize.ts` (owned by another agent). My files are lint-clean.
- End-to-end API smoke-test via curl (sandbox dev server on :3000):
  - GET /api/conversations (unauthenticated) → 401 ✓
  - GET /api/conversations?entityType=DEMAND&entityId=own → `{id:null, comments:[]}` empty shell ✓
  - POST /api/conversations → 201 with new conversation ✓
  - POST /api/conversations/[id]/comments (CUSTOMER_VISIBLE as customer) → 201 with full conversation ✓
  - POST /api/conversations/[id]/comments (INTERNAL as customer) → 403 "Forbidden — customers can only post CUSTOMER_VISIBLE comments" ✓
  - POST /api/conversations/[id]/comments (INTERNAL as CM leader) → 201 ✓
  - GET /api/conversations/[id]/comments (as customer) → only CUSTOMER_VISIBLE comments ✓
  - GET /api/conversations/[id]/comments (as CM leader) → all comments ✓
  - GET /api/conversations?entityType=DEMAND&entityId=NOT_THEIRS (as customer) → 403 ✓
  - PATCH /api/conversations/comments/[id] (author) → 200 with editedAt set ✓
  - PATCH /api/conversations/comments/[id] (non-author) → 403 "Forbidden — only the author may edit a comment" ✓
  - POST /api/attachments (multipart text file as customer) → 201 with `storageKey` + `url` ✓ (file landed in public/uploads/2026-07/)
  - GET /api/attachments?entityType=DEMAND&entityId=own → list with uploader relation ✓
  - GET /api/attachments/[id] → metadata ✓
  - DELETE /api/attachments/[id] (as uploader) → 200 `{ok:true}` + file removed from disk ✓
  - DELETE /api/attachments/[id] (already deleted) → 404 ✓
  - POST /api/attachments (application/zip) → 400 INVALID_FILE ✓
  - POST /api/attachments (12 MB text/plain) → 413 INVALID_FILE — exceeds 10 MB ✓
  - POST /api/surveys (rating 5 as customer) → 201 ✓
  - POST /api/surveys (rating 7 as customer) → 400 INVALID_RATING ✓
  - POST /api/surveys (duplicate) → 409 CONFLICT ✓
  - POST /api/surveys (rating 1 as customer, second demand) → 201; CM Leader received "Detractor alert — 1★ CSAT rating" notification ✓
  - GET /api/surveys?entityType=DEMAND&entityId=own (as customer) → own survey ✓
  - GET /api/surveys/stats (as customer) → 403 ✓
  - GET /api/surveys/stats (as CM Leader) → `{count, average, distribution, trend, byEntityType, lowRatingCount, detractorCount, promoterCount, nps}` ✓
- Dev server compiles cleanly — no errors in `dev.log`.

## Smoke-test artifacts left in the database

During smoke-testing I created (visible in the demo UI; reasonable demo data):
- 1 Conversation on demand `cmrqc76ht002drkihxteeqime` (Finance Division's procurement portal demand).
- 2 Comments on that conversation: 1 CUSTOMER_VISIBLE from Elena Vance (edited), 1 INTERNAL from Sofia Reyes (CM Leader).
- 2 SatisfactionSurvey records: 5★ from Elena on `cmrqc76ht002drkihxteeqime`, 1★ from Elena on `cmrqc76hz002nrkihfdue04z9` (with comment "Took way too long, very disappointed").
- 1 CommitmentEscalated notification to the CM Leader pool (Sofia) for the 1★ rating.

A future agent may want to clean these up via a re-seed if a pristine demo state is needed.

## Coordination notes for future agents

- **Foundation files respected**: I did NOT modify any foundation file or any other agent's files. All new code lives under `src/app/api/{conversations,attachments,surveys}/` and `src/components/workspaces/shared/{CommentThread,AttachmentList,CsatWidget}.tsx`.
- **`public/uploads/`** directory is now created and used for attachment storage. The Caddyfile / Next.js public folder mapping already serves it at `/<storageKey>` URLs. No gateway changes needed.
- **Notification type reuse**: I reused `CommitmentEscalated` for low-rating alerts (semantic overlap — both signal "needs leadership attention"). If a future agent adds a dedicated `LowCSATRating` notification type, the call site is at `src/app/api/surveys/route.ts` lines ~190–210.
- **Audit actions used**: `CONVERSATION_CREATED`, `COMMENT_CREATED`, `COMMENT_EDITED`, `ATTACHMENT_UPLOADED`, `ATTACHMENT_DELETED`, `SURVEY_CREATED`. These will appear in any future audit-history viewer.
- **CSAT for tickets**: The `Ticket` model exists in the schema (Phase 2). My survey routes accept `entityType=TICKET` and validate ticket ownership for SERVICE_CUSTOMER via `ticket.serviceCustomerId === session.orgNodeId`. SERVICE_OWNER scope resolves ticket ownership via `ticket.serviceId ∈ ownedServiceIds`. Once a Ticket detail page exists, `CsatWidget entityType="TICKET" entityId={ticket.id}` will work without changes.
- **Cross-customer visibility**: SERVICE_CUSTOMER cannot read conversations or attachments on entities owned by other org nodes (403 / 404). They cannot edit other users' comments (403). They cannot post INTERNAL comments (403). They cannot see other customers' surveys (filtered to `customerId = session.id`).
- **Drop-in usage on detail pages**: 
  - Demand detail: `<CommentThread entityType="DEMAND" entityId={demand.id} />`, `<AttachmentList entityType="DEMAND" entityId={demand.id} />`, `<CsatWidget entityType="DEMAND" entityId={demand.id} />`.
  - Ticket detail (when built): same with `entityType="TICKET"`.
  - Change detail (internal only): `<CommentThread entityType="CHANGE" entityId={change.id} />` — customers can't access (no serviceCustomerId resolution path).
  - Comment-thread attachments: `<AttachmentList entityType="COMMENT" entityId={comment.id} />` — supported for completeness but not yet wired into the CommentThread UI.
