# Enterprise Workflow Review And Remediation Plan

Date: 2026-07-18

## Scope

This review verifies the project after most remediation work was added.

User says these areas are still excluded or pending:

- Phase 22: Prepare External Integrations
- Phase 10: Reporting And Analytics
- Phase 11: Testing
- Phase 12: Documentation

This file focuses on what still lacks enterprise-grade quality in workflow, roles, features, and views.

## Verification Summary

### What Is Now Present

The repo now includes many of the backend primitives requested in the earlier plan:

- Prisma migrations exist under `prisma/migrations`.
- Ticket models exist in `prisma/schema.prisma`.
- SLA policy and SLA clock models exist.
- Conversation/comment models exist.
- Attachment model and API exist.
- Knowledge article model and API exist.
- Satisfaction survey model and API exist.
- Permission and role-permission models exist.
- Audit log model and helper exist.
- Notification delivery model and API exist.
- Fonts were changed away from `next/font/google`.
- `next.config.ts` no longer hides TypeScript build errors.
- `npm` scripts were improved for normal dev/build/typecheck flows.

### Verification Results

Commands run:

```powershell
node_modules\.bin\eslint.exe .
node_modules\.bin\tsc.exe --noEmit --pretty false
node node_modules\prisma\build\index.js validate
```

Results:

- ESLint: passed.
- Prisma schema validation: passed.
- TypeScript: failed.

Current TypeScript failure:

```text
.next/dev/types/validator.ts:
Type 'typeof import("D:/CSM/src/app/api/notifications/deliveries/route")'
does not satisfy RouteHandlerConfig<"/api/notifications/deliveries">.

src/app/api/notifications/deliveries/[id]/retry/route.ts:
Cannot find module '../route'
```

Root cause:

- `src/app/api/notifications/deliveries/route.ts` incorrectly contains a dynamic retry `POST` handler that expects `{ params: { id } }`, but that file is the static `/api/notifications/deliveries` route.
- `src/app/api/notifications/deliveries/[id]/retry/route.ts` imports from the wrong relative path.

Fix:

1. Remove the dynamic retry `POST` from `src/app/api/notifications/deliveries/route.ts`.
2. Put the retry logic directly in `src/app/api/notifications/deliveries/[id]/retry/route.ts`.
3. Do not re-export dynamic route handlers from a static route file.
4. Re-run `npm run typecheck`.

Acceptance criteria:

- `npm run typecheck` passes.
- `npm run build` passes.
- Retry endpoint remains available at `/api/notifications/deliveries/[id]/retry`.

## Enterprise Readiness Assessment

Current state:

The app has more enterprise primitives than before, but the workflow maturity is still not enterprise-grade.

Main reason:

Most new capabilities are backend-only or shallowly implemented. Enterprise CSM quality requires complete role-specific operating views, strict access rules, exact workflow transitions, queue ownership, escalation rules, audit coverage, and visible work surfaces.

## Major Remaining Gaps

## 1. Ticket/Case Management Exists In API But Not In Role Workspaces

Evidence:

- `Ticket` types exist in `src/lib/types.ts`.
- Ticket API exists under `src/app/api/tickets`.
- But `src/lib/store.ts` `ViewKey` and `NAV_BY_ROLE` have no `tickets`, `ticket-detail`, `incidents`, `cases`, or `knowledge` views.
- Role workspaces still mainly expose demands, catalog, SLA, changes, handovers, governance, and problems.

Why this blocks enterprise-grade CSM:

A CSM platform cannot be enterprise-grade if incidents/cases exist only as APIs. Users need operational screens:

- Customer: raise case, view my cases, respond, close/reopen, submit CSAT.
- SCM Worker: ticket queue, triage, assign, respond, resolve.
- CM Leader: backlog, aging, priority queue, escalations, reassignment.
- Service Owner: incidents by owned service, breach risk, problem linkage.

Plan:

1. Extend `ViewKey`:

```ts
| 'tickets'
| 'ticket-detail'
| 'submit-ticket'
| 'knowledge'
| 'article-detail'
| 'attachments'
```

2. Add nav items:

- Service Customer: `My Tickets`, `Submit Ticket`, `Knowledge`.
- SCM Worker: `Ticket Queue`, `Knowledge`.
- CM Leader: `Ticket Operations`, `Escalations`, `Knowledge Review`.
- Service Owner: `Service Incidents`, `Known Errors`, `Knowledge`.

3. Create screens:

- `src/components/workspaces/customer/TicketList.tsx`
- `src/components/workspaces/customer/SubmitTicket.tsx`
- `src/components/workspaces/customer/TicketDetail.tsx`
- `src/components/workspaces/scm-worker/TicketQueue.tsx`
- `src/components/workspaces/scm-worker/TicketDetail.tsx`
- `src/components/workspaces/cm-leader/TicketOperations.tsx`
- `src/components/workspaces/service-owner/ServiceTickets.tsx`
- `src/components/knowledge/KnowledgeSearch.tsx`
- `src/components/knowledge/ArticleDetail.tsx`

Acceptance criteria:

- Ticket workflows are usable from UI for every role.
- Ticket records have detail pages with timeline, SLA clocks, comments, attachments, and actions.
- Global search includes tickets and knowledge articles.

## 2. SCM Ticket Access Is Too Broad

Evidence:

`src/app/api/tickets/route.ts` comments say SCM should see assigned tickets, unassigned queue, and customer orgs they serve, but the implementation says SCM can see all for simplicity.

Enterprise issue:

This leaks customer data across service managers. Enterprise CSM requires precise account/customer assignment boundaries.

Plan:

1. Add a mapping model:

```prisma
model CustomerAssignment {
  id        String @id @default(cuid())
  orgNodeId String
  userId    String
  role      String // SCM_OWNER | BACKUP | ESCALATION_MANAGER
  active    Boolean @default(true)
  createdAt DateTime @default(now())

  @@unique([orgNodeId, userId, role])
  @@index([userId])
  @@index([orgNodeId])
}
```

2. Seed SCM-to-customer assignments.
3. Update ticket list scoping:

SCM Worker can see:

- assignedUserId = session.id
- assignedUserId = null and serviceCustomerId is in assigned customer orgs
- serviceCustomerId is in assigned customer orgs

4. Apply the same scoping to demands, communications, conversations, attachments, and dashboards.

Acceptance criteria:

- SCM Worker cannot see unrelated customer tickets.
- CM Leader can still see all.
- Customer assignment is visible in CM Leader worker management view.

## 3. Ticket State Machine Is Too Loose

Evidence:

Ticket `PATCH` can directly set status to any supplied string. Dedicated routes exist for assign, resolve, close, reopen, but direct patch still allows broad transitions.

Enterprise issue:

Enterprise workflows need controlled transitions, required fields, ownership rules, and audit consistency.

Plan:

1. Create `src/lib/ticket-state.ts`.
2. Define allowed transitions:

```ts
NEW -> TRIAGED
TRIAGED -> ASSIGNED
ASSIGNED -> IN_PROGRESS
IN_PROGRESS -> WAITING_CUSTOMER
WAITING_CUSTOMER -> IN_PROGRESS
IN_PROGRESS -> RESOLVED
RESOLVED -> CLOSED
RESOLVED -> IN_PROGRESS // reopen before close
CLOSED -> IN_PROGRESS // reopen, permission restricted
```

3. Block direct status writes in `PATCH /api/tickets/[id]`.
4. Require dedicated action routes for transitions.
5. Enforce required fields:

- assign requires user or group.
- resolve requires resolutionCode and resolutionNotes.
- close requires `RESOLVED` unless CM Leader override.
- reopen requires reason.
- waiting customer requires customer-visible comment.

Acceptance criteria:

- Invalid ticket transitions return 409.
- Every transition writes `TicketEvent` and `AuditLog`.
- UI only exposes valid next actions.

## 4. Ticket Number Generation Is Race-Prone

Evidence:

`src/app/api/tickets/route.ts` creates ticket number with `db.ticket.count() + 1`.

Enterprise issue:

Concurrent ticket creation can generate duplicate numbers.

Plan:

1. Add a sequence/counter model:

```prisma
model SequenceCounter {
  key   String @id
  value Int
}
```

2. Generate ticket number inside a transaction.
3. Use format such as:

```text
INC-2026-000001
REQ-2026-000001
CSM-2026-000001
```

4. Consider separate prefixes by ticket type.

Acceptance criteria:

- Ticket numbers are unique under concurrent creation.
- Number format supports enterprise reporting.

## 5. SLA Engine Is Basic And Not Yet Operational

What exists:

- `SlaPolicy`
- `SlaClock`
- `startSlaClocks`
- `pauseSlaClocks`
- `resumeSlaClocks`
- `meetSlaClock`
- `evaluateRunningClocks`

Remaining enterprise gaps:

- No warning threshold table.
- No business calendar logic.
- No timezone-aware working-hours calculation.
- No scheduled evaluator.
- No response definition beyond assignment.
- No escalation policy.
- No SLA clock UI.
- SLA reports still are not fully based on clock history.

Plan:

1. Add warning and escalation models:

```prisma
model SlaEscalationPolicy {
  id          String @id @default(cuid())
  policyId    String
  thresholdPct Int
  notifyRole  String
  notifyUserId String?
  active      Boolean @default(true)
}
```

2. Implement business-calendar due-date calculation using `BusinessCalendar.rulesJson`.
3. Add a real background evaluator or admin-safe job endpoint with authorization.
4. Define first response as first customer-visible internal response, not assignment.
5. Add SLA clock component in ticket detail:

- Response SLA status
- Resolution SLA status
- Due date
- Time remaining
- Paused time
- Breach reason

6. Add SLA breach escalation:

- Notify assigned worker.
- Notify CM Leader.
- Notify Service Owner for service-owned breaches.
- Create audit event.

Acceptance criteria:

- SLA clocks are visible and trusted by operators.
- SLA warning/breach jobs can run repeatedly without duplicate noise.
- SLA reports can derive compliance from clocks.

## 6. Conversations Do Not Enforce Entity Access

Evidence:

`GET /api/conversations?entityType=&entityId=` lazy-creates conversations for any supplied entity ID and only filters comments for customers. It does not verify that the user can access the target entity before returning or creating the conversation.

Enterprise issue:

This can expose metadata or allow unauthorized conversation creation.

Plan:

1. Create `src/lib/entity-access.ts`.
2. Implement:

```ts
canAccessEntity(session, entityType, entityId, action)
```

3. Use this helper in:

- conversations
- comments
- attachments
- surveys
- audit views
- global search

4. For customer comments:

- Customers can only comment on their own ticket/demand.
- Internal users can add internal or customer-visible comments only if assigned or privileged.

Acceptance criteria:

- Unauthorized entity IDs return 403 or 404.
- Conversation creation requires access to the target entity.

## 7. Attachments Have Placeholder Security And Weak Storage Rules

Evidence:

`src/app/api/attachments/route.ts` contains a `dummy-ticket-456` exception and upload does not generally verify access to the target entity before saving.

Enterprise issue:

Attachments often contain sensitive evidence. They require strict authorization, malware scanning, immutable metadata, and controlled download.

Plan:

1. Remove `dummy-ticket-456`.
2. Use `canAccessEntity`.
3. Add download endpoint:

- `GET /api/attachments/[id]/download`

4. Store files outside web root.
5. Generate opaque storage keys, not `Date.now() + filename`.
6. Add checksum:

```prisma
sha256 String?
```

7. Add virus scan status:

```prisma
scanStatus String // PENDING | CLEAN | INFECTED | FAILED
```

8. Block download unless scan is clean.

Acceptance criteria:

- Unauthorized users cannot upload or view attachments.
- File names are not trusted as storage keys.
- Attachment lifecycle is auditable.

## 8. Permission System Exists But Is Not Broadly Enforced

What exists:

- `Permission`
- `RolePermission`
- `hasPermission`
- `requirePermission`

Problem:

Most routes still use direct role checks or broad `getSession` checks. Permission checks are used only in limited places.

Plan:

1. Define a complete permission catalog:

- `ticket.read.own`
- `ticket.read.assigned`
- `ticket.read.customer_assigned`
- `ticket.read.all`
- `ticket.create`
- `ticket.assign`
- `ticket.resolve`
- `ticket.close`
- `ticket.reopen`
- `comment.internal.create`
- `comment.customer_visible.create`
- `attachment.upload`
- `knowledge.create`
- `knowledge.review`
- `knowledge.publish`
- `sla.evaluate`
- `audit.read`
- `notification.delivery.retry`

2. Add route-level permission checks.
3. Add object-level access checks separately from permission checks.
4. Add an admin/CM Leader permission matrix view later.

Acceptance criteria:

- Every mutating route has explicit permission enforcement.
- Every read route has object-level scope enforcement.

## 9. Audit Log Is Not Universal

What exists:

- `AuditLog` model.
- `writeAuditLog` helper.
- Ticket creation uses audit.

Remaining gap:

Most important mutations do not consistently write audit logs.

Plan:

1. Add audit calls to:

- all ticket transitions
- demand transitions
- change transitions
- knowledge publish/review
- comment creation/edit
- attachment upload/delete
- SLA evaluate/breach
- notification delivery retry
- permission changes

2. Add an audit viewer for CM Leader/admin users.
3. Add filters:

- actor
- entity type
- action
- date range
- customer org

Acceptance criteria:

- Every business-critical mutation has audit history.
- Audit logs are viewable by authorized roles.

## 10. Knowledge Base Exists But Workflow And Views Are Missing

What exists:

- Knowledge article model.
- `GET/POST /api/knowledge`.
- `GET/PATCH /api/knowledge/[id]`.

Enterprise gaps:

- No article authoring view.
- No review queue.
- No publish/retire workflow UI.
- No linkage UI from tickets/problems.
- No customer self-service knowledge view.
- No article usefulness feedback.
- No version history.

Plan:

1. Add Knowledge workspace:

- Customer: published search only.
- SCM Worker: search and suggest articles.
- CM Leader: review/publish queue.
- Service Owner: owned-service knowledge and known errors.

2. Add article workflow:

```text
DRAFT -> REVIEW -> PUBLISHED -> RETIRED
REVIEW -> DRAFT
```

3. Add version model:

```prisma
model KnowledgeArticleVersion {
  id        String @id @default(cuid())
  articleId String
  title     String
  body      String
  version   Int
  createdById String
  createdAt DateTime @default(now())
}
```

Acceptance criteria:

- Knowledge is usable by customers and workers.
- Known errors can be linked from problems and tickets.

## 11. CSAT Exists But Is Not Integrated Into Customer Experience

What exists:

- `SatisfactionSurvey`
- `/api/surveys`
- ticket close creates a CSAT notification.

Enterprise gaps:

- No UI to submit survey from notification.
- No duplicate prevention.
- No org/service scoped CSAT analytics.
- Customer can only survey their own requester ID, not necessarily org-level authorized users.

Plan:

1. Add unique constraint:

```prisma
@@unique([entityType, entityId, customerId])
```

2. Add survey UI component.
3. Add CSAT section to customer dashboard.
4. Add low-score follow-up workflow for CM Leader.
5. Add service owner view for service-level CSAT.

Acceptance criteria:

- Customers can submit CSAT from the app.
- Duplicate surveys are prevented.
- Leaders can act on low CSAT.

## 12. Dashboards Still Center On Demands, Not Enterprise Service Operations

Evidence:

`/api/stats` still returns `totalDemands`, `pipeline`, `recentActivity` from `DemandEvent`, and only one `averageCsat`.

Enterprise issue:

A mature CSM dashboard must show blended operations:

- Tickets by priority/status/SLA.
- Demand pipeline.
- Breach risk.
- Aging queues.
- Reopen rate.
- CSAT by service/customer.
- Workload by agent/group.
- Problem backlog.
- Change risk.

Plan:

1. Split stats by domain:

- `/api/stats/overview`
- `/api/stats/tickets`
- `/api/stats/demands`
- `/api/stats/sla`
- `/api/stats/workload`
- `/api/stats/customer-health`

2. Add role-specific dashboard cards:

Customer:

- Open tickets
- Waiting on me
- SLA breached/at risk
- My demands
- Knowledge recommendations

SCM Worker:

- My assigned tickets
- Unassigned tickets for my customers
- SLA due soon
- Waiting customer
- Demands pending action

CM Leader:

- Breach risk
- Aging backlog
- Workload by worker/group
- Quote approvals
- CSAT low-score follow-ups

Service Owner:

- Incidents by owned service
- SLA breaches by service
- Problems/known errors
- Changes touching owned service
- Customer sentiment

Acceptance criteria:

- Dashboards guide daily work, not only report counts.

## 13. Notification Delivery Is Mocked And Currently Breaks Typecheck

What exists:

- `NotificationDelivery`.
- `createDeliveries`.
- `processDelivery`.
- Delivery retry API.

Problems:

- TypeScript currently fails on delivery routes.
- Delivery is simulated with random failure.
- No user-facing delivery admin view.
- Delivery creation is not consistently called for all notifications.

Plan:

1. Fix route structure first.
2. Replace random mock behavior with deterministic adapter interface:

```ts
interface DeliveryAdapter {
  send(deliveryId: string): Promise<void>;
}
```

3. Keep mock adapter for local dev, but make it deterministic.
4. Add delivery log screen for CM Leader/admin.
5. Ensure all notification creation paths call `createDeliveries`.

Acceptance criteria:

- Typecheck passes.
- Delivery behavior is predictable.
- Failed deliveries can be retried from UI.

## 14. Role Model Still Missing Enterprise Roles

Current roles:

- SERVICE_CUSTOMER
- SCM_WORKER
- CM_LEADER
- SERVICE_OWNER

Enterprise CSM usually needs more role separation:

- Service Desk Agent
- Technical Resolver
- Assignment Group Manager
- Problem Manager
- Change Manager / Change Approver
- Knowledge Manager
- SLA Manager
- Customer Admin
- System Admin
- Auditor / Read-only Compliance

Plan:

1. Decide whether to keep four top-level personas and add permissions/groups, or add explicit roles.
2. Minimum recommended addition:

- SERVICE_DESK_AGENT
- TECHNICAL_RESOLVER
- KNOWLEDGE_MANAGER
- SYSTEM_ADMIN
- AUDITOR

3. Add assignment groups for technical resolver ownership.
4. Add views by role or permission:

- Resolver queue
- Knowledge review
- Admin settings
- Audit log
- Customer administration

Acceptance criteria:

- Operational responsibilities are not overloaded onto SCM Worker and CM Leader.

## 15. Customer Portal Still Does Not Feel Like Full Customer Service

Current customer nav:

- Dashboard
- My Demands
- Submit Demand
- Service Catalog
- SLA Performance

Missing customer views:

- My Tickets / Incidents
- Submit Ticket / Report Issue
- Conversation inbox
- Attachments
- Knowledge/self-service
- Surveys/feedback
- Notifications deep links
- My services/subscriptions
- Planned maintenance / service notices

Plan:

1. Add customer views:

- `tickets`
- `submit-ticket`
- `ticket-detail`
- `knowledge`
- `feedback`
- `service-health`

2. Add customer dashboard cards:

- My open tickets
- Waiting for my response
- Recent support messages
- Services with active incidents
- Recommended knowledge

Acceptance criteria:

- Customer can complete support workflows without internal-user screens.

## 16. CM Leader Workspace Needs True Operations Control

Current CM Leader nav:

- Dashboard
- Demand Queue
- SCM Workers
- SLM Governance
- Service Catalog
- Changes
- Analytics

Missing:

- Ticket operations center
- Assignment control
- Escalation center
- SLA breach command center
- Low CSAT follow-up
- Audit log
- Knowledge review queue
- Delivery failure queue

Plan:

1. Add views:

- `ticket-ops`
- `escalations`
- `audit`
- `knowledge-review`
- `delivery-failures`
- `csat-followup`

2. Add bulk actions:

- assign/reassign
- escalate
- change priority
- request update
- approve knowledge

Acceptance criteria:

- CM Leader can run the operation from the app.

## 17. Service Owner Workspace Needs Service Health, Not Just Governance

Current Service Owner nav:

- Dashboard
- Service Portfolio
- SLA Performance
- Governance Approvals
- Problem Records
- Changes

Missing:

- Owned-service incident queue
- Service health page
- Known error / knowledge ownership
- Customer impact view
- Commitments and lifecycle roadmap
- Service risk register

Plan:

1. Add views:

- `service-health`
- `service-incidents`
- `known-errors`
- `risk-register`
- `customer-impact`

2. Connect Service Owner to ticket/SLA/problem/knowledge data by owned service.

Acceptance criteria:

- Service Owner sees operational health, not just governance records.

## 18. Demand And Ticket Workflows Are Not Unified

Problem:

Demands and tickets now coexist but are not clearly related.

Enterprise expectation:

Customers should not need to understand internal categories too much. The system should guide whether something is:

- incident
- service request
- demand/enhancement
- complaint
- question

Plan:

1. Add intake classification:

```text
Customer request -> guided intake -> Ticket or Demand
```

2. Add conversion paths:

- Ticket -> Demand
- Ticket -> Problem
- Ticket -> Change
- Demand -> Ticket if actually support issue

3. Add relation model:

```prisma
model EntityLink {
  id         String @id @default(cuid())
  fromType   String
  fromId     String
  toType     String
  toId       String
  linkType   String // CAUSED_BY | RELATES_TO | CONVERTED_TO | FULFILLED_BY
  createdAt  DateTime @default(now())
}
```

Acceptance criteria:

- Related operational records are visible in each detail page.
- Intake can route requests to the correct workflow.

## 19. Global Search Is Not Enterprise Complete

Current state:

Global search includes demands, services, changes, and problems. It does not meaningfully expose tickets, knowledge, attachments, conversations, or audit logs.

Plan:

1. Add tickets to all relevant role search configs.
2. Add knowledge articles.
3. Add search result action routing to detail views.
4. Add server-side search endpoint instead of loading many lists client-side.

Acceptance criteria:

- Search works across core operational records with proper scoping.

## 20. URL Routing Is Still Query-State Based, Not Real App Routing

Current state:

Navigation uses Zustand and query string `?view=...`.

Enterprise issue:

This is better than pure memory state, but still not proper URL routing. It limits deep linking, route permissions, breadcrumbs, browser history, SEO-like app structure, and monitorable routes.

Plan:

1. Add route groups:

```text
/customer/tickets
/customer/tickets/[id]
/customer/demands/[id]
/scm/tickets
/scm/tickets/[id]
/cm/operations/tickets
/owner/services/[id]/health
```

2. Keep Zustand only for transient UI state.
3. Notifications should link to real URLs.

Acceptance criteria:

- Refreshing any detail page works.
- Browser back/forward is reliable.
- Notification links open exact records.

## 21. External Integrations Are Still Pending

User already excluded this item, but for enterprise readiness it remains important.

Needed later:

- Email inbound/outbound.
- Teams/Slack notifications.
- SSO/identity provider.
- Calendar/change windows.
- External monitoring ingestion for incidents/SLA.
- External ITSM integration if this system coexists with another service desk.

Do not treat the current mock notification delivery as enterprise integration.

## 22. Reporting, Testing, And Documentation Are Still Pending

User already excluded these phases, but they remain enterprise blockers.

Minimum later requirements:

- Reporting and analytics dashboards.
- API integration tests.
- Role workflow E2E tests.
- SLA engine tests.
- Security/access control tests.
- README and architecture documentation.
- Operational runbooks.

## Updated Priority Order

Do the next work in this order:

1. Fix TypeScript failure in notification delivery routes.
2. Add ticket/case views into role navigation and workspaces.
3. Add strict entity access helper and apply it to tickets, conversations, attachments, surveys, and search.
4. Replace loose ticket `PATCH` status changes with state-machine action routes.
5. Add customer assignment model for SCM scoping.
6. Add ticket queues and detail views with comments, attachments, SLA clocks, and actions.
7. Add knowledge views and review/publish workflow UI.
8. Add CSAT submission UI and low-score follow-up workflow.
9. Expand dashboards from demand-only to service operations.
10. Add audit log coverage and audit viewer.
11. Improve notification delivery routing and admin view.
12. Add enterprise roles or permission-backed role views.
13. Add real URL routes.
14. Then proceed with external integrations, reporting, tests, and documentation.

## Definition Of Enterprise-Grade Workflow

The app can be considered enterprise-grade for workflow only when:

- Every major backend entity has role-appropriate views.
- Customers can raise, track, converse, attach files, close, reopen, and rate service work.
- SCM Workers operate from scoped queues, not broad all-tenant visibility.
- CM Leaders can manage workload, escalations, SLA risk, approvals, and quality.
- Service Owners can see service health, incidents, problems, known errors, changes, and customer impact.
- Tickets, demands, changes, problems, knowledge, SLA clocks, comments, attachments, and surveys are connected.
- State transitions are controlled by workflow rules.
- Permissions and entity access are consistently enforced.
- Audits exist for all important actions.
- Dashboards show actionable work, risk, aging, SLA breach exposure, and quality.
- Typecheck and build pass without ignored errors.
