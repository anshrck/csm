# CSM Project Remediation Plan

This plan converts the project review findings into an execution-ready backlog. Follow the phases in order. Do not skip the stabilization phase, because later product work depends on type checking, migrations, and reliable builds.

## Current Project Summary

The app is a Next.js + Prisma customer service management prototype with role-based workspaces for:

- Service Customer
- SCM Worker
- CM Leader
- Service Owner

It already contains demand lifecycle, service catalog, change handover, SLA events, SLA reports, governance decisions, notifications, global search, and an AI panel.

The main weakness is that it behaves more like a governed demand/change demo than a production-quality CSM platform. The following plan fixes that in controlled phases.

## Phase 1: Stabilize The Application

### 1. Fix TypeScript Route Validation

Issue:
`tsc --noEmit` fails because `.next/types/validator.ts` rejects `src/app/api/demands/[id]/request-changes/route.ts`.

Relevant file:

- `src/app/api/demands/[id]/request-changes/route.ts`

Plan:

1. Update the route handler signature to match the app's Next.js 16 generated route handler expectations.
2. Use a broad context type if needed:

```ts
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
}
```

3. If Next still rejects it, align with the exact pattern used by working dynamic routes in the project.
4. Re-run:

```powershell
node node_modules\typescript\bin\tsc --noEmit
```

Acceptance criteria:

- `tsc --noEmit` completes with zero errors.
- The request-changes API still supports `QUOTED -> UNDER_REVIEW`.
- Customer ownership checks still work.

### 2. Remove Build Error Hiding

Issue:
`next.config.ts` has `typescript.ignoreBuildErrors = true`, which allows broken builds to pass.

Relevant file:

- `next.config.ts`

Plan:

1. Remove this block:

```ts
typescript: {
  ignoreBuildErrors: true,
},
```

2. Keep `output: "standalone"` if standalone deployment is still required.
3. Re-run type check and build.

Acceptance criteria:

- Build does not ignore TypeScript errors.
- `next.config.ts` does not mask production issues.

### 3. Fix Offline Production Build Fonts

Issue:
`next build` fails in restricted/offline environments because `src/app/layout.tsx` uses `next/font/google`.

Relevant file:

- `src/app/layout.tsx`

Plan:

1. Remove:

```ts
import { Geist, Geist_Mono } from "next/font/google";
```

2. Remove the `Geist` and `Geist_Mono` constants.
3. Replace the body class with local/system font classes:

```tsx
<body className="font-sans antialiased bg-background text-foreground">
```

4. In `src/app/globals.css`, define a strong system font stack if not already present:

```css
body {
  font-family: Arial, Helvetica, sans-serif;
}

code,
pre,
kbd {
  font-family: "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
}
```

Acceptance criteria:

- `next build` no longer fetches Google Fonts.
- Production build works without network access.

### 4. Fix Package Scripts For Windows And Production

Issue:
`package.json` scripts assume Bun and Unix commands like `cp -r` and `tee`.

Relevant file:

- `package.json`

Plan:

1. Replace Bun-dependent scripts with Node/npm-compatible scripts.
2. Use `next dev`, `next build`, and `next start` directly where possible.
3. Avoid `cp -r`, `tee`, and shell-specific redirection.
4. Suggested scripts:

```json
{
  "dev": "next dev -p 3000",
  "build": "next build",
  "start": "next start -p 3000",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "check": "npm run lint && npm run typecheck && npm run build",
  "db:push": "prisma db push",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:reset": "prisma migrate reset"
}
```

5. If Bun is required by the environment, add separate `bun:*` scripts instead of making default scripts depend on Bun.

Acceptance criteria:

- `npm run lint` works.
- `npm run typecheck` works.
- `npm run build` works.
- Scripts are usable on Windows.

### 5. Fix Broken Text Encoding

Issue:
Many files contain broken characters such as `â€”`, `Â·`, `â€¦`, and `â†’`.

Relevant areas:

- `src`
- `prisma/seed.ts`
- `worklog.md`
- `agent-ctx`
- uploaded guide text files if used in UI

Plan:

1. Search for common mojibake:

```powershell
rg "â|Â|Ã|�" src prisma worklog.md agent-ctx upload
```

2. Replace broken text with clean ASCII or proper UTF-8.
3. Prefer ASCII in source code comments and UI copy unless the app already requires Unicode.
4. Examples:

- `â€”` -> `-`
- `Â·` -> `·` or `-`
- `â€¦` -> `...`
- `â†’` -> `->`

Acceptance criteria:

- No broken mojibake remains in visible UI strings.
- Seeded demo data displays cleanly.
- Metadata displays cleanly.

## Phase 2: Database And Domain Foundation

### 6. Add Prisma Migrations

Issue:
The project has `schema.prisma` and `seed.ts`, but no migrations directory.

Relevant files:

- `prisma/schema.prisma`
- `prisma/seed.ts`

Plan:

1. Create an initial migration from the current schema:

```powershell
npx prisma migrate dev --name init
```

2. Verify `prisma/migrations` is created.
3. Do not rely only on `prisma db push` for project evolution.
4. Document migration usage in `download/README.md` or a root `README.md`.

Acceptance criteria:

- `prisma/migrations` exists.
- A clean database can be created from migrations.
- Seed script still runs.

### 7. Replace JSON String Relation Fields With Join Tables

Issue:
Several relational concepts are stored as JSON strings, blocking joins, constraints, analytics, and search.

Current fields:

- `Demand.relatedServiceIds`
- `Change.affectedServiceIds`
- `Change.technicalOwnerTasksJson`
- `SlaReport.serviceIds`
- `SlaReport.serviceCustomerIds`
- `SlaReport.metricsJson`

Plan:

1. Add join models:

```prisma
model DemandService {
  id        String @id @default(cuid())
  demandId  String
  serviceId String
  demand    Demand  @relation(fields: [demandId], references: [id], onDelete: Cascade)
  service   Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([demandId, serviceId])
  @@index([serviceId])
}

model ChangeService {
  id        String @id @default(cuid())
  changeId  String
  serviceId String
  change    Change  @relation(fields: [changeId], references: [id], onDelete: Cascade)
  service   Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([changeId, serviceId])
  @@index([serviceId])
}

model SlaReportService {
  id          String @id @default(cuid())
  slaReportId String
  serviceId   String

  @@unique([slaReportId, serviceId])
  @@index([serviceId])
}

model SlaReportCustomer {
  id          String @id @default(cuid())
  slaReportId String
  orgNodeId   String

  @@unique([slaReportId, orgNodeId])
  @@index([orgNodeId])
}
```

2. Add a proper `TechnicalOwnerTask` model instead of `technicalOwnerTasksJson`.
3. Keep old JSON fields temporarily for migration compatibility.
4. Write migration scripts to backfill join tables from JSON strings.
5. Update serializers and API routes to use relations.
6. Remove old JSON fields only after all code uses new tables.

Acceptance criteria:

- Related services are queryable through Prisma relations.
- Service owner scoping no longer requires loading all records and filtering in JavaScript.
- SLA report customers/services are queryable.

### 8. Add First-Class Ticket And Incident Models

Issue:
The app lacks core CSM case/ticket/incident functionality.

Plan:

1. Add models:

```prisma
model Ticket {
  id              String   @id @default(cuid())
  number          String   @unique
  title           String
  description     String
  type            String   // INCIDENT | SERVICE_REQUEST | QUESTION | COMPLAINT
  priority        String   // P1 | P2 | P3 | P4
  impact          String?
  urgency         String?
  status          String   // NEW | TRIAGED | ASSIGNED | IN_PROGRESS | WAITING_CUSTOMER | RESOLVED | CLOSED | CANCELED
  serviceId       String?
  serviceCustomerId String
  requesterId     String
  assignedUserId  String?
  assignmentGroupId String?
  resolutionCode  String?
  resolutionNotes String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  resolvedAt      DateTime?
  closedAt        DateTime?
}

model AssignmentGroup {
  id        String @id @default(cuid())
  name      String
  type      String // SCM | SERVICE_DESK | TECHNICAL | GOVERNANCE
  active    Boolean @default(true)
  createdAt DateTime @default(now())
}
```

2. Add ticket event/audit model:

```prisma
model TicketEvent {
  id        String   @id @default(cuid())
  ticketId  String
  eventType String
  actorId   String?
  actorName String
  notes     String?
  createdAt DateTime @default(now())
}
```

3. Add API routes:

- `GET/POST /api/tickets`
- `GET/PATCH /api/tickets/[id]`
- `POST /api/tickets/[id]/assign`
- `POST /api/tickets/[id]/resolve`
- `POST /api/tickets/[id]/close`
- `POST /api/tickets/[id]/reopen`

4. Add role scoping:

- Service Customer: only own org tickets.
- SCM Worker: assigned tickets, unassigned queue, and customer orgs they serve.
- CM Leader: all tickets.
- Service Owner: tickets touching owned services.

Acceptance criteria:

- Customers can raise an incident/case separately from a demand.
- Workers can triage, assign, resolve, close, and reopen tickets.
- Every transition writes an audit event.

## Phase 3: SLA Engine

### 9. Add SLA Policy And SLA Clock

Issue:
SLA is currently manually represented by events; there is no enforceable clock.

Plan:

1. Add models:

```prisma
model SlaPolicy {
  id              String @id @default(cuid())
  name            String
  serviceId       String?
  ticketType      String
  priority        String
  responseMins    Int
  resolutionMins  Int
  businessCalendarId String?
  active          Boolean @default(true)
  createdAt       DateTime @default(now())
}

model SlaClock {
  id              String @id @default(cuid())
  ticketId        String
  policyId        String
  type            String // RESPONSE | RESOLUTION
  status          String // RUNNING | PAUSED | MET | BREACHED | CANCELED
  startedAt       DateTime
  dueAt           DateTime
  pausedAt        DateTime?
  totalPausedMins Int @default(0)
  metAt           DateTime?
  breachedAt      DateTime?
}

model BusinessCalendar {
  id        String @id @default(cuid())
  name      String
  timezone  String
  rulesJson String
}
```

2. When a ticket is created, attach response and resolution clocks based on service, ticket type, and priority.
3. Pause SLA when status is `WAITING_CUSTOMER`.
4. Resume SLA when customer responds.
5. Mark response SLA met when first worker response is sent.
6. Mark resolution SLA met when ticket is resolved.
7. Add a scheduled job or API-safe function to detect warnings and breaches.

Acceptance criteria:

- SLA warnings/breaches are calculated, not manually inserted.
- Dashboard counts are derived from live clocks.
- SLA reports are generated from clock history.

### 10. Replace Approximate Dashboard Metrics

Issue:
`/api/stats` includes approximate calculations, such as CM Leader pending approvals based on all `UNDER_REVIEW` demands.

Relevant file:

- `src/app/api/stats/route.ts`

Plan:

1. Replace approximate approval count with exact criteria:

- Demand quote fields present.
- `status = UNDER_REVIEW`.
- `quoteApprovedByCmLeader = false`.
- Quote approval requested event exists or a dedicated approval request model exists.

2. Replace SLA warning/breach counts with `SlaClock` status once Phase 3 exists.
3. Avoid loading all records then filtering in JavaScript where relations can handle it.

Acceptance criteria:

- Dashboard metrics match actual actionable work.
- Service owner stats use relational service ownership queries.

## Phase 4: Communication, Collaboration, And Attachments

### 11. Add Threaded Comments

Issue:
`Communication` is too shallow for real customer service interaction.

Plan:

1. Add models:

```prisma
model Conversation {
  id                String @id @default(cuid())
  entityType        String // TICKET | DEMAND | CHANGE | PROBLEM | SLA_EVENT
  entityId          String
  serviceCustomerId String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model Comment {
  id             String @id @default(cuid())
  conversationId String
  authorId       String
  authorName     String
  visibility     String // CUSTOMER_VISIBLE | INTERNAL
  body           String
  createdAt      DateTime @default(now())
  editedAt        DateTime?
}
```

2. Connect demands, tickets, changes, problems, and SLA events to conversations.
3. Replace one-off communication display with timeline threads.
4. Preserve current `Communication` as outbound message records if needed.

Acceptance criteria:

- Customers and workers can have threaded conversations.
- Internal notes are hidden from customers.
- Threads appear in demand/ticket detail pages.

### 12. Add Attachments

Issue:
No file/evidence support exists.

Plan:

1. Add model:

```prisma
model Attachment {
  id          String @id @default(cuid())
  entityType  String
  entityId    String
  fileName    String
  mimeType    String
  sizeBytes   Int
  storageKey  String
  uploadedById String
  createdAt   DateTime @default(now())
}
```

2. Add upload API route:

- `POST /api/attachments`
- `GET /api/attachments?entityType=&entityId=`
- `DELETE /api/attachments/[id]`

3. Store locally for development, object storage for production.
4. Enforce file size and MIME type restrictions.

Acceptance criteria:

- Users can attach evidence to demands/tickets/problems.
- Attachments respect role scoping.

### 13. Add Customer Satisfaction Feedback

Issue:
No CSAT/NPS feedback after closure.

Plan:

1. Add model:

```prisma
model SatisfactionSurvey {
  id          String @id @default(cuid())
  entityType  String // TICKET | DEMAND
  entityId    String
  customerId  String
  rating      Int
  comment     String?
  createdAt   DateTime @default(now())
}
```

2. Trigger survey notification when a ticket/demand closes.
3. Add customer UI for rating.
4. Add CM Leader dashboard for CSAT trends.

Acceptance criteria:

- Closed records can collect customer satisfaction.
- Leaders can see low-rated cases and trends.

## Phase 5: Knowledge Management

### 14. Add Knowledge Base And Known Error Articles

Issue:
Problem records exist but there is no operational knowledge base.

Plan:

1. Add models:

```prisma
model KnowledgeArticle {
  id          String @id @default(cuid())
  title       String
  body        String
  type        String // HOW_TO | KNOWN_ERROR | FAQ | RUNBOOK
  status      String // DRAFT | REVIEW | PUBLISHED | RETIRED
  serviceId   String?
  authorId    String
  reviewerId  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  publishedAt DateTime?
}
```

2. Link articles to problems, tickets, and service offerings.
3. Add article search in the customer portal and worker workspace.
4. Add review/publish workflow for CM Leader or Service Owner.

Acceptance criteria:

- Known errors become reusable articles.
- Workers can link resolutions to knowledge articles.
- Customers can self-serve published articles.

## Phase 6: Authorization And Audit

### 15. Add Permission Matrix

Issue:
Current authorization is role-only.

Plan:

1. Add models:

```prisma
model Permission {
  id          String @id @default(cuid())
  key         String @unique
  description String
}

model RolePermission {
  id           String @id @default(cuid())
  role         String
  permissionId String

  @@unique([role, permissionId])
}
```

2. Add permissions such as:

- `demand.read.own`
- `demand.read.all`
- `demand.quote.create`
- `demand.quote.approve`
- `ticket.assign`
- `ticket.resolve`
- `sla.report.approve`
- `service.manage`
- `knowledge.publish`

3. Replace many direct `requireRole(...)` checks with a helper:

```ts
await requirePermission("demand.quote.approve");
```

4. Keep role checks only where role identity itself matters.

Acceptance criteria:

- Permissions are centralized.
- Role access can be audited and changed without editing every route.

### 16. Add Audit Log For All Mutations

Issue:
Demand has events, but other writes are not consistently audited.

Plan:

1. Add model:

```prisma
model AuditLog {
  id         String @id @default(cuid())
  actorId    String?
  actorName  String
  action     String
  entityType String
  entityId   String
  beforeJson String?
  afterJson  String?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())
}
```

2. Create a helper:

```ts
await auditLog({
  actor: session,
  action: "DEMAND_QUOTE_APPROVED",
  entityType: "Demand",
  entityId: demand.id,
  before,
  after,
});
```

3. Use the helper in every POST/PATCH/DELETE route.

Acceptance criteria:

- All important mutations are audit logged.
- CM Leader/Admin can inspect audit history.

## Phase 7: Security Hardening

### 17. Harden Login And Sessions

Issue:
Login has no rate limiting, lockout, password reset, MFA, or revocation.

Plan:

1. Require `SESSION_SECRET` in production. Do not allow fallback secret in production.
2. Add session expiry validation based on the cookie timestamp.
3. Add server-side session table if revocation is required.
4. Add login rate limiting by email and IP.
5. Add failed-login lockout policy.
6. Remove demo quick-login in production.
7. Add password reset or integrate SSO.

Acceptance criteria:

- Production cannot boot with fallback session secret.
- Brute-force login attempts are blocked.
- Demo credentials are not exposed in production UI.

### 18. Add Input Validation With Zod

Issue:
Many routes manually parse `body: any`.

Plan:

1. Add Zod schemas per route.
2. Validate request bodies and query params.
3. Return consistent 400 errors with field-level messages.
4. Replace `any` in API routes where practical.

Acceptance criteria:

- Invalid payloads return clear validation errors.
- API routes avoid unsafe `any` parsing.

## Phase 8: UX And Navigation

### 19. Add URL-Based Routing

Issue:
Workspace navigation is held in Zustand only. Deep links and browser history are weak.

Relevant file:

- `src/lib/store.ts`

Plan:

1. Add real routes:

- `/customer/dashboard`
- `/customer/demands`
- `/customer/demands/[id]`
- `/scm/demands`
- `/cm/approvals`
- `/owner/services`

2. Keep Zustand for UI state only, not primary navigation.
3. Update global search to navigate to URLs.

Acceptance criteria:

- Refreshing a detail page preserves location.
- Browser back/forward works.
- Notifications can deep-link to target records.

### 20. Improve Queue And Work Management UX

Issue:
The app has queues, but not mature work management.

Plan:

1. Add saved filters:

- My open work
- Unassigned
- Breaching soon
- Waiting customer
- Pending approval
- Accepted needs change

2. Add sorting by age, priority, SLA due time, customer, owner.
3. Add bulk assignment for CM Leader.
4. Add aging badges and overdue indicators.
5. Add workload balancing view.

Acceptance criteria:

- SCM and CM Leader can work from actionable queues.
- High-risk items are visible without manual filtering.

## Phase 9: Notifications And Integrations

### 21. Add Real Notification Delivery

Issue:
Notifications are in-app only.

Plan:

1. Keep `Notification` for in-app notification.
2. Add `NotificationDelivery` model:

```prisma
model NotificationDelivery {
  id             String @id @default(cuid())
  notificationId String
  channel        String // EMAIL | TEAMS | SLACK | PORTAL
  status         String // PENDING | SENT | FAILED
  error          String?
  sentAt         DateTime?
  createdAt      DateTime @default(now())
}
```

3. Add delivery worker/service.
4. Add user notification preferences.
5. Add retry policy.

Acceptance criteria:

- Notifications can be delivered externally.
- Failed delivery is visible and retryable.

### 22. Prepare External Integrations

Plan:

1. Add integration configuration model.
2. Prioritize:

- Email inbound/outbound
- Teams/Slack notifications
- Calendar for change windows
- Identity provider/SSO
- External ITSM connector if needed

Acceptance criteria:

- Integration secrets are not stored in plain text.
- Integration failures are logged.

## Phase 10: Reporting And Analytics

### 23. Add Operational Reports

Issue:
Current analytics are basic.

Plan:

1. Add reports:

- Ticket volume by customer/service/priority
- SLA compliance by service/customer
- Average response/resolution time
- Backlog aging
- Reopen rate
- CSAT trend
- Worker workload
- Demand conversion to change

2. Add export API:

- CSV export
- JSON export

3. Add date range filters.

Acceptance criteria:

- CM Leader can use reports for operations review.
- Service Owner can see service health and trends.

## Phase 11: Testing

### 24. Add Unit Tests For State Machines

Plan:

1. Extract demand, change, ticket, and SLA transition rules into testable modules.
2. Test valid transitions.
3. Test invalid transitions.
4. Test role/permission constraints.

Acceptance criteria:

- State machine tests pass.
- Invalid workflow transitions are blocked.

### 25. Add API Integration Tests

Plan:

1. Use a test database.
2. Seed minimal users and services.
3. Test key workflows:

- Customer creates ticket.
- SCM assigns and responds.
- SLA response clock is met.
- Ticket resolves and closes.
- Demand quote approval path.
- Customer requests quote changes.
- Change handover path.

Acceptance criteria:

- API tests can run without a manually started dev server.
- Tests do not depend on Bun unless Bun is explicitly part of the project standard.

### 26. Add Playwright E2E Tests

Plan:

1. Add Playwright.
2. Test role login.
3. Test customer demand submission.
4. Test SCM review and quote draft.
5. Test CM approval.
6. Test customer accept/request changes.
7. Test notification drawer.

Acceptance criteria:

- Main user journeys are covered end to end.
- Screens render correctly on desktop and mobile.

## Phase 12: Documentation

### 27. Add Project README

Plan:

1. Create or update root `README.md`.
2. Include:

- Project purpose
- Tech stack
- Setup
- Environment variables
- Database migration
- Seed
- Dev server
- Build
- Test
- Demo accounts
- Production warnings

Acceptance criteria:

- New developer can run the app from README only.

### 28. Add Architecture Documentation

Plan:

1. Add `docs/architecture.md`.
2. Document:

- Roles
- Permission model
- Entity model
- Demand lifecycle
- Ticket lifecycle
- SLA engine
- Notification flow
- Deployment assumptions

Acceptance criteria:

- Architecture is understandable without reading all source code.

## Recommended Execution Order

Run the work in this exact order:

1. Fix typecheck and build.
2. Remove build error hiding.
3. Fix fonts and scripts.
4. Fix encoding.
5. Add migrations.
6. Add audit log.
7. Add permission model.
8. Replace JSON relation fields with join tables.
9. Add ticket/case/incident domain.
10. Add SLA policy and clock engine.
11. Add threaded comments and attachments.
12. Add CSAT.
13. Add knowledge base.
14. Add URL routing.
15. Improve queues and dashboards.
16. Add notification delivery.
17. Add reports.
18. Add unit, API, and E2E tests.
19. Complete README and architecture docs.

## Verification Commands

Use these after each phase:

```powershell
npm run lint
npm run typecheck
npm run build
npx prisma validate
npx prisma migrate status
```

If tests are added:

```powershell
npm run test
npm run test:e2e
```

## Definition Of Done

The project can be considered a good-quality CSM foundation when:

- Production build passes without network-only font dependencies.
- TypeScript errors are not ignored.
- Database schema is migration-controlled.
- Core work is based on tickets/cases/incidents, not only demands.
- SLA compliance is calculated by clocks and policies.
- Communications are threaded with customer/internal visibility.
- Attachments, audit logs, permissions, and CSAT exist.
- Role workspaces operate from actionable queues.
- Important workflows have automated tests.
- README and architecture docs explain setup and system behavior.
