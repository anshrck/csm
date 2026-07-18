# CereBree uSMS — Architecture Reference

This document describes the architecture of the CereBree uSMS platform: the
role model, permission model, entity model, key lifecycle state machines, the
SLA engine, the notification flow, the audit log, and the deployment
assumptions. It is the authoritative reference for new contributors; the
worklog (`worklog.md`) captures the build history.

## 1. Roles & accountability

The platform models four roles, each with a distinct accountability layer.
The role is a property of the `User` row (`user.role`); a user has exactly one
role. There is no role-mixing — the design intent is that every actor finds
exactly one governed interface.

### SERVICE_CUSTOMER — Service Customer

- **Workspace**: CSM Portal (`/customer/*`).
- **Accountability**: submit demands on behalf of their organisational unit,
  approve or decline quotes, browse the entitled service catalog, monitor SLA
  performance against their entitlements, complete CSAT surveys.
- **Scope**: only sees their own orgNode's data (demands, tickets,
  notifications, knowledge base). Cannot see other customers' data, internal
  governance decisions, or SCM worker workload.
- **Demo account**: `customer@cerebree.io` (Elena Vance).

### SCM_WORKER — Service Customer Manager

- **Workspace**: CSM Workspace (`/scm/*`).
- **Accountability**: own the demand lifecycle end-to-end. Draft quotes
  (effort, cost, notes), submit them for CM Leader approval, communicate with
  the customer, hand over to Change Enablement once a demand is accepted,
  prepare SLA reports, draft breach communications.
- **Scope**: sees demands assigned to them + unassigned demands (so they can
  self-assign). Sees the full service catalog (read-only) and the SLA event
  feed for their assigned services. Cannot see other SCM workers' assigned
  demands.
- **Demo account**: `scm@cerebree.io` (Priya Anand).

### CM_LEADER — Customer Management Leader

- **Workspace**: CSM Workspace (`/cm/*`).
- **Accountability**: hold the governance gates. Approves quotes (gate from
  `UNDER_REVIEW → QUOTED`), rejects demands with a required reason, assigns
  SCM workers, reviews and approves/returns SLA reports, monitors SCM worker
  workload, reviews the SLA compliance matrix.
- **Scope**: sees the full tenant — every demand, every SCM worker, every SLA
  report, every change. The CM Leader is the only role that can transition a
  demand to `REJECTED`.
- **Demo account**: `cmleader@cerebree.io` (Sofia Reyes).

### SERVICE_OWNER — Service Owner

- **Workspace**: Service Owner Portal (`/owner/*`).
- **Accountability**: structural accountability for service value, quality,
  and SLA commitments on the services they own. Approves service commitments
  (gate from `ACCEPTED → IN_CHANGE`), records breach responses, owns problem
  records on their services, signs off catalog changes affecting their
  services.
- **Scope**: sees everything affecting their owned services — demands on
  those services, SLA events on those services, problems on those services,
  changes affecting those services. Can also see all SLA events tenant-wide
  (oversight responsibility). Cannot see SCM-side governance decisions
  unrelated to their services.
- **Demo account**: `owner@cerebree.io` (Dr. Henrik Sørensen — owns ERP,
  Identity, Backup services).

## 2. Permission model

The platform uses a **layered permission model**:

1. **Role check** (`requireRole(...roles)`) — the coarse-grained gate at the
   top of every route handler. Rejects callers whose role isn't in the
   allowed set with `403 Forbidden`.
2. **Ownership check** — fine-grained, route-specific. Examples: an SCM
   Worker can only PATCH a demand assigned to them; a Service Owner can only
   record governance decisions on services they own; an author can only edit
   their own DRAFT knowledge article.
3. **Centralised permission table** (Phase 6) — the `Permission` and
   `RolePermission` tables map fine-grained permission keys (e.g.
   `demand.approve_quote`, `sla_report.issue`) to roles. The
   `requirePermission(key)` helper in `src/lib/permissions.ts` resolves the
   caller's role against this table. New routes can opt into this granular
   model by calling `requirePermission('my.permission.key')` instead of (or
   in addition to) `requireRole(...)`.

Every authorization decision that fails is logged via `auditLog()` so the
trail of "who tried to do what and was rejected" is preserved.

## 3. Entity model

The Prisma schema (`prisma/schema.prisma`) defines 20+ models. The major
groupings:

### Identity & org structure
| Model | Purpose |
|---|---|
| `User` | A platform user. Has exactly one `role`. Belongs to an optional `OrgNode`. |
| `OrgNode` | An organisational unit. Type `CUSTOMER_ORG` (a customer) or `INTERNAL`. Self-referential `parentId` for hierarchy. |
| `Permission` | A fine-grained permission key (e.g. `demand.approve_quote`). |
| `RolePermission` | Maps a `role` to a `Permission`. |

### Service catalog
| Model | Purpose |
|---|---|
| `Service` | A managed service. Has a domain (INTERACTION/SUPPORT/DELIVERY/MANAGEMENT), chapter, layer, SLA class (A/B/C/D), and a `serviceOwnerId`. |
| `ServiceOffering` | A requestable offering under a service (e.g. "Module Access Request" under "ERP Platform"). Has a `requestType` and `fulfillmentDays`. |
| `SlaProfile` | The availability + response/resolution targets for a service × SLA class. |
| `Entitlement` | Grants an `OrgNode` access to a `ServiceOffering` (DIRECT or INHERITED scope). |

### Demand pipeline
| Model | Purpose |
|---|---|
| `Demand` | A customer demand. Carries the full lifecycle state machine (NEW → … → CLOSED). |
| `DemandEvent` | An immutable audit event on a demand (CREATED, QUOTED, ACCEPTED, COMMENT, …). |
| `DemandService` | Join table: many-to-many between demands and services. |

### Change enablement
| Model | Purpose |
|---|---|
| `Change` | A change request. Originates from a demand, problem, or standard schedule. |
| `ChangeService` | Join table: many-to-many between changes and services. |
| `ProcessHandover` | Records the formal handover from CM → CE (or PM → CE etc.) with acknowledgement. |
| `TechnicalOwnerTask` | A task assigned to a technical owner as part of a change. |

### SLA & problem management
| Model | Purpose |
|---|---|
| `SlaEvent` | A WARNING / BREACHED / CLOSED_IN_TIME event on a service × customer pair. |
| `SlaPolicy` | Defines the response + resolution targets for a service × ticket type × priority. |
| `SlaClock` | A running timer per ticket (RESPONSE or RESOLUTION) with start/due/pause/breach state. |
| `BusinessCalendar` | Work-hours / holiday rules used by SLA policy calculations. |
| `Problem` | A problem record on a service. Has a status (NEW → KNOWN_ERROR → CLOSED) and an optional `knownErrorId`. |

### Tickets / cases
| Model | Purpose |
|---|---|
| `Ticket` | A customer ticket (incident, service request, question, complaint). |
| `TicketEvent` | An immutable audit event on a ticket. |
| `AssignmentGroup` | A group (SCM / SERVICE_DESK / TECHNICAL / GOVERNANCE) that tickets can be assigned to. |
| `Conversation` | A comment thread attached to any entity (ticket / demand / change / problem / SLA event). |
| `Comment` | A single comment in a conversation. Has `CUSTOMER_VISIBLE` or `INTERNAL` visibility. |
| `Attachment` | A file attached to any entity. |
| `SatisfactionSurvey` | A CSAT rating (1-5) + comment submitted by a customer on a ticket or demand. |

### Knowledge base
| Model | Purpose |
|---|---|
| `KnowledgeArticle` | A knowledge article (HOW_TO / KNOWN_ERROR / FAQ / RUNBOOK). Lifecycle: DRAFT → REVIEW → PUBLISHED → RETIRED. Has an `authorId` and an optional `reviewerId`. |

### Governance
| Model | Purpose |
|---|---|
| `SlaReport` | An SLA performance report prepared by an SCM Worker and reviewed/approved by a CM Leader before being issued to the customer. Lifecycle: DRAFT → PENDING_REVIEW → APPROVED → ISSUED (with RETURNED as a side-branch). |
| `SlaReportService` / `SlaReportCustomer` | Join tables linking an SLA report to the services and customer orgs it covers. |
| `Communication` | A customer-facing or internal communication record. Carries `direction` (TO_CUSTOMER / INTERNAL_NOTE), `channel` (PORTAL / EMAIL / MESSAGE), and an optional `slaEventId` link for breach communications. |
| `GovernanceDecision` | A Service Owner's recorded governance decision (commitment approval / escalation / breach response / lifecycle direction / catalog accuracy). |

### Notifications & audit
| Model | Purpose |
|---|---|
| `Notification` | An in-app notification addressed to a single user. Carries a `type`, `title`, `message`, and an `entityRef` deep-link. |
| `NotificationDelivery` | Records delivery attempts to external channels (EMAIL / TEAMS / SLACK). |
| `AuditLog` | An immutable audit entry recording who did what to which entity, with `beforeJson` and `afterJson` snapshots. |

## 4. Demand lifecycle

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
        ▼                                                              │
      NEW ──────────► UNDER_REVIEW ──────────► QUOTED ─────────► ACCEPTED ──► IN_CHANGE ──► FULFILLED ──► CLOSED
                       (SCM drafts      │             │              │            │             │             │
                        quote)          │             │              │            │             │             │
                                        │             │              │            │             │             │
                                  CM Leader      Customer       Customer      Hand to CE     Change      Customer
                                  approves       accepts        declines       (Process       closed      closes
                                  quote          quote          (sets reason)  Handover)                   │
                                        │             │                                                    │
                                        │             └──────────► CLOSED (declined quote)                  │
                                        │                                                                  │
                                        ▼                                                                  │
                                  REJECTED (CM Leader, required reason) ◄──────────────────────────────┘
                                                                                                  (escalation path)

                       NEW ───────► REDIRECTED (SCM redirects to an existing ServiceOffering)
```

### Governance gates

1. **`UNDER_REVIEW → QUOTED`** — gated by the **CM Leader**. The SCM Worker
   drafts the quote (effort, cost, notes), then calls
   `POST /api/demands/[id]/request-approval` to notify all CM Leaders. The
   CM Leader reviews and either calls `POST /api/demands/[id]/approve-quote`
   (sets `quoteApprovedByCmLeader=true`) or
   `POST /api/demands/[id]/return-quote` (sends notes back to the SCM
   Worker for revision). The customer cannot see the quote until the CM
   Leader approves.

2. **`ACCEPTED → IN_CHANGE`** — gated by the **Service Owner**. The customer
   accepts the quote (`POST /api/demands/[id]/accept`); the SCM Worker hands
   the demand to Change Enablement (`POST /api/demands/[id]/hand-to-ce`)
   which creates a `Change` row and a `ProcessHandover` record. The Service
   Owner can record a `GovernanceDecision` with
   `decisionType=COMMITMENT_APPROVAL` either approving the commitment (sets
   `demand.commitmentNotes`) or rejecting it.

Every transition writes a `DemandEvent` row (immutable audit) and fires the
contractually-required `Notification`s (e.g. `DemandCreated` → all CM Leaders,
`DemandQuoted` → customer, `DemandAccepted` → assigned SCM Worker,
`DemandFulfilled` → customer, `DemandRejected` → customer).

## 5. Ticket lifecycle

```
NEW ──► TRIAGED ──► ASSIGNED ──► IN_PROGRESS ──► RESOLVED ──► CLOSED
                          │             │
                          │             ▼
                          │      WAITING_CUSTOMER
                          │             │
                          │             └─► (resumes) IN_PROGRESS
                          │
                          └─► CANCELED
```

- `NEW` → `TRIAGED`: priority + impact + urgency set, SLA policy attached.
- `TRIAGED` → `ASSIGNED`: assigned to a user or assignment group.
- `ASSIGNED` → `IN_PROGRESS`: work starts; SLA response clock pauses if MET,
  SLA resolution clock keeps running.
- `IN_PROGRESS` ↔ `WAITING_CUSTOMER`: pauses SLA clocks (records
  `totalPausedMins`).
- `IN_PROGRESS` → `RESOLVED`: resolution code + notes required; SLA
  resolution clock is MET or BREACHED.
- `RESOLVED` → `CLOSED`: customer confirms or auto-close after grace period.

## 6. SLA engine

The SLA engine has three layers:

1. **`SlaPolicy`** — defines the response + resolution targets (in minutes)
   for a `(serviceId?, ticketType, priority)` tuple. A policy can be scoped
   to a specific service or apply tenant-wide. Each policy references an
   optional `BusinessCalendar` for work-hours-aware due-time calculations.

2. **`SlaClock`** — one per ticket per metric (RESPONSE / RESOLUTION). The
   clock has a `startedAt`, a `dueAt` (= startedAt + targetMins, adjusted
   for paused time), a `status` (RUNNING / PAUSED / MET / BREACHED /
   CANCELED), and accumulates `totalPausedMins`. The `POST /api/sla-clocks/check`
   endpoint sweeps the running clocks and marks any past `dueAt` as
   `BREACHED`, emitting an `SlaEvent` (BREACHED) on the relevant service ×
   customer pair.

3. **`SlaEvent`** — the public-facing signal. WARNING (clock projected to
   breach soon), BREACHED (clock past `dueAt`), CLOSED_IN_TIME (ticket
   resolved before breach). Every event fans out notifications: WARNING →
   assigned SCM Worker + Service Owner; BREACHED → SCM Worker + Service
   Owner + CM Leader (oversight); CLOSED_IN_TIME → no notification (silent
   success).

The `SlaReport` lifecycle (DRAFT → PENDING_REVIEW → APPROVED → ISSUED, with
RETURNED as a side-branch) gives the CM Leader an editorial gate over what
the customer sees: the SCM Worker drafts a periodic SLA report, the CM
Leader reviews + approves + adds review notes, and only then can the SCM
Worker issue the report to the affected customers.

## 7. Notification flow

```
mutation (e.g. demand quoted)
   │
   ├─► auditLog()                      // immutable AuditLog row
   │
   └─► db.notification.createMany()    // one Notification per recipient user
            │
            └─► notification-delivery   // fan-out to external channels
                    │
                    ├─► EMAIL    (NotificationDelivery row, status=SENT/FAILED)
                    ├─► TEAMS
                    └─► SLACK
```

- Every mutation that has a contractual notification obligation (see the
  `Notification.type` comment in `prisma/schema.prisma` for the full list)
  creates one `Notification` row per recipient user. Recipients are resolved
  by role: e.g. `DemandCreated` fans out to all `CM_LEADER` users;
  `CommitmentApproved` fans out to the assigned SCM Worker + every
  `SERVICE_CUSTOMER` user in the demand's customer org.
- The frontend polls `GET /api/notifications?count=1` every 30s for the
  unread count (badge in the topbar) and fetches the full list on drawer
  open.
- `NotificationDelivery` records attempts to push the notification to
  external channels. The delivery worker (in `src/lib/notification-delivery.ts`)
  is pluggable: each channel (EMAIL / TEAMS / SLACK) has its own adapter.

## 8. Audit log

Every mutation that touches a governed entity writes an `AuditLog` row via
the `auditLog()` helper in `src/lib/audit.ts`. The helper:

- Records `actorId` + `actorName` (the calling session, or `system` for
  background jobs).
- Records `action` (e.g. `KNOWLEDGE_ARTICLE_PUBLISHED`,
  `DEMAND_QUOTE_APPROVED`).
- Records `entityType` + `entityId` (e.g. `KnowledgeArticle`, the article
  id).
- Optionally records `before` and `after` snapshots (JSON-stringified) for
  diff-able updates.
- Optionally records `ipAddress` and `userAgent` (forwarded headers when
  available).
- **Never throws** — failures are logged to stderr but don't block the main
  operation. This is intentional: an audit-log failure must not roll back a
  business mutation.

The `GET /api/audit-logs?entityType=...&entityId=...` endpoint (or the
`getAuditHistory()` helper) returns the audit history for any entity, used
by the demand detail screen and the SLA report review panel.

## 9. Knowledge Base lifecycle

```
DRAFT ──► REVIEW ──► PUBLISHED ──► RETIRED
  │         │            ▲
  │         │            │
  │         └─► (CM Leader / Service Owner publishes)
  │
  └─► (author or CM Leader edits title/body/type/serviceId)
```

- **DRAFT** — only the author + CM Leader can see/edit. Service Customers
  cannot see drafts.
- **REVIEW** — author calls `POST /api/knowledge/[id]/submit-review`; all CM
  Leader users receive a `QuoteApprovalRequested` notification (reused for
  knowledge review requests).
- **PUBLISHED** — CM Leader or Service Owner calls
  `POST /api/knowledge/[id]/publish`; sets `reviewerId` and `publishedAt`.
  The article becomes visible to Service Customers.
- **RETIRED** — CM Leader or Service Owner calls
  `POST /api/knowledge/[id]/retire`; the article disappears from the
  customer-facing search but remains in the database for audit history.

Published/retired articles cannot be edited in place — the editorial model
requires a new revision (retire the old, publish the new) so the published
corpus is immutable.

## 10. Deployment assumptions

- **Single-instance deployment** is the default. The in-process login rate
  limiter, the in-memory `loginAttempts` map, and the dev watchdog assume a
  single Node.js process. For multi-instance deployments, replace the
  in-memory state with a shared store (Redis recommended).
- **SQLite for dev**, **PostgreSQL for production**. The Prisma schema uses
  only portable types — no SQLite-specific extensions — so swapping the
  `DATABASE_URL` and re-running `prisma migrate deploy` is sufficient.
- **Standalone Next.js output**. `next build` produces a self-contained
  `.next/` directory that `next start` serves. No external worker process is
  required for the core platform; the `mini-services/watchdog/` folder
  contains a dev-only auto-restart supervisor that is NOT needed in
  production.
- **Reverse proxy with TLS termination**. The app sets `secure: true` on
  session cookies when `NODE_ENV=production`. A reverse proxy (Caddy, nginx,
  Cloudflare) must terminate TLS so the cookie attribute is respected.
- **No background job runner**. SLA breach detection is triggered by the
  `POST /api/sla-clocks/check` endpoint, which the frontend calls on a
  polling interval. For production, replace this with a cron job or a
  queue-based worker.
- **AI assistant is server-side only**. The Cogni assistant uses
  `z-ai-web-dev-sdk` from within `src/app/api/ai/route.ts`. The SDK must
  never be imported in a client component (it carries server-side credentials).

## 11. Cross-cutting conventions

- **Route handlers** all start with `export const runtime = 'nodejs';`. The
  `edge` runtime is incompatible with Prisma's SQLite client.
- **Serialization** is centralised per-resource in `_serialize.ts` files
  (e.g. `src/app/api/demands/_serialize.ts`). Every route handler returns
  the serialized shape; the Prisma row shape is never leaked to the client.
- **JSON-string columns** (e.g. `Demand.relatedServiceIds`,
  `Change.affectedServiceIds`) are parsed on read and stringified on write
  inside the serializer. The frontend always sees a real array.
- **Error responses** use a small set of canonical messages: `UNAUTHORIZED`
  → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, `CONFLICT` → 409,
  `INVALID_*` → 400. The `errorResponse()` helper in each `_serialize.ts`
  translates thrown errors to JSON responses.
- **Client-side data fetching** uses TanStack Query with stable query keys
  of the form `['resource', filter1, filter2, …]`. Mutations invalidate the
  relevant query keys on success.
- **Navigation** is URL-driven (see `src/lib/routing.ts`). Every view has a
  URL; browser back/forward works; deep-links work. The Zustand store holds
  the in-memory view + params and syncs with the URL via the catch-all
  route in `src/app/page.tsx`.
- **Styling** uses the shadcn/ui New York variant over Tailwind CSS 4. The
  theme is teal/emerald (primary hue ~165). No indigo or blue is used
  unless explicitly required.
