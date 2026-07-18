# Service Owner Enterprise Workflow Specification

Purpose: give next AI one complete plan to upgrade Service Owner workspace to enterprise-grade workflow.

Audience: implementation AI working in `D:\CSM`.

Current Service Owner workspace:

- `src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx`
- `Dashboard.tsx`
- `Portfolio.tsx`
- `SlaPerformance.tsx`
- `Governance.tsx`
- `Problems.tsx`
- `Changes.tsx`
- `DemandDetail.tsx`
- `_hooks.ts`

Current Service Owner navigation:

- Dashboard
- Service Portfolio
- SLA Performance
- Governance Approvals
- Problem Records
- Changes

Enterprise target:

Service Owner must operate as accountable owner for service value, health, risk, commitments, customer impact, SLA, incidents, problems, changes, knowledge, and lifecycle.

## Core Service Owner Responsibility

Service Owner owns:

- Service value.
- Service health.
- SLA commitment.
- Service catalog accuracy.
- Customer impact.
- Major incident/accountability response.
- Problem and known error direction.
- Change risk on owned services.
- Demand commitment approval.
- Service lifecycle planning.
- Knowledge accuracy for owned service.
- Risk and remediation actions.

Service Owner does not replace SCM Worker or CM Leader. Service Owner gives governance direction and accountability decisions for services they own.

## Required Navigation

Update `src/lib/store.ts`.

Add these `ViewKey` values:

```ts
| 'service-health'
| 'service-incidents'
| 'known-errors'
| 'knowledge'
| 'customer-impact'
| 'risk-register'
| 'lifecycle'
| 'owner-audit'
| 'service-detail'
| 'ticket-detail'
| 'article-detail'
```

Replace Service Owner nav with:

```ts
SERVICE_OWNER: [
  { key: 'dashboard', label: 'Command Center', icon: 'LayoutDashboard' },
  { key: 'service-health', label: 'Service Health', icon: 'Activity' },
  { key: 'service-incidents', label: 'Incidents', icon: 'Flame' },
  { key: 'sla', label: 'SLA Performance', icon: 'Gauge' },
  { key: 'governance', label: 'Governance', icon: 'ShieldCheck' },
  { key: 'problems', label: 'Problems', icon: 'Bug' },
  { key: 'known-errors', label: 'Known Errors', icon: 'BookOpen' },
  { key: 'changes', label: 'Changes', icon: 'GitBranch' },
  { key: 'customer-impact', label: 'Customer Impact', icon: 'Users' },
  { key: 'risk-register', label: 'Risk Register', icon: 'TriangleAlert' },
  { key: 'lifecycle', label: 'Lifecycle', icon: 'RefreshCw' },
]
```

Optional admin-only Service Owner views:

- `owner-audit`
- `knowledge`

## Required Workspace Switch

Update `src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx`.

Add imports:

```ts
import ServiceHealth from './ServiceHealth';
import ServiceIncidents from './ServiceIncidents';
import KnownErrors from './KnownErrors';
import CustomerImpact from './CustomerImpact';
import RiskRegister from './RiskRegister';
import Lifecycle from './Lifecycle';
import Knowledge from './Knowledge';
import OwnerAudit from './OwnerAudit';
import ServiceDetail from './ServiceDetail';
import TicketDetail from './TicketDetail';
import ArticleDetail from './ArticleDetail';
```

Add cases:

```tsx
case 'service-health':
  return <ServiceHealth />;
case 'service-incidents':
  return <ServiceIncidents />;
case 'known-errors':
  return <KnownErrors />;
case 'customer-impact':
  return <CustomerImpact />;
case 'risk-register':
  return <RiskRegister />;
case 'lifecycle':
  return <Lifecycle />;
case 'knowledge':
  return <Knowledge />;
case 'owner-audit':
  return <OwnerAudit />;
case 'service-detail':
  return <ServiceDetail id={params.id} />;
case 'ticket-detail':
  return <TicketDetail id={params.id} />;
case 'article-detail':
  return <ArticleDetail id={params.id} />;
```

## Data Scope Rules

Every Service Owner view must show only services where:

```ts
service.serviceOwnerId === session.id
```

Related data:

- Tickets: `ticket.serviceId in ownedServiceIds`
- SLA clocks: `ticket.serviceId in ownedServiceIds`
- SLA events: `slaEvent.serviceId in ownedServiceIds`
- Problems: `problem.serviceId in ownedServiceIds`
- Changes: any `affectedServices.serviceId in ownedServiceIds`
- Demands: any `relatedServices.serviceId in ownedServiceIds`
- Knowledge: `knowledgeArticle.serviceId in ownedServiceIds`
- Surveys: ticket/demand linked to owned service
- Audit logs: entity linked to owned service

Never show all-tenant data in Service Owner views.

## Shared Hook Layer

Extend `src/components/workspaces/service-owner/_hooks.ts`.

Required hooks:

```ts
useOwnerServices()
useOwnerServiceIds()
useOwnerTickets()
useOwnerTicket(id)
useOwnerSlaClocks()
useOwnerSlaEvents()
useOwnerProblems()
useOwnerKnownErrors()
useOwnerChanges()
useOwnerDemands()
useOwnerKnowledge()
useOwnerSurveys()
useOwnerGovernanceDecisions()
useOwnerAuditLogs()
useServiceHealthSummary()
useCustomerImpactSummary()
useRiskRegisterItems()
```

Each hook must use React Query and proper query keys.

Example:

```ts
useQuery({
  queryKey: ['owner-tickets'],
  queryFn: () => apiGet<Ticket[]>('/api/tickets?owner=me'),
})
```

If endpoint lacks `owner=me`, add endpoint support.

## Required API Support

Add or update APIs:

### Tickets

`GET /api/tickets?owner=me`

Returns tickets touching owned services.

Filter support:

- `status`
- `priority`
- `type`
- `serviceId`
- `sla=breached|warning|running`
- `customerId`

### SLA

`GET /api/sla/clocks?owner=me`

Returns clocks for tickets touching owned services.

If no route exists, create:

- `src/app/api/sla/clocks/route.ts`

### Knowledge

`GET /api/knowledge?owner=me`

Returns articles for owned services.

### Surveys

`GET /api/surveys?owner=me`

Returns CSAT for tickets/demands touching owned services.

### Audit

`GET /api/audit?owner=me`

Returns audit logs for owned-service entities.

### Risk Register

Either derive in frontend or create:

`GET /api/service-owner/risk-register`

Risk sources:

- active SLA breach
- repeated warning
- P1/P2 ticket open too long
- high reopen rate
- known error without workaround
- problem without root cause after threshold
- complex/emergency change
- low CSAT
- stale service catalog metadata

## Service Owner Command Center

File:

- `src/components/workspaces/service-owner/Dashboard.tsx`

Upgrade purpose:

Daily executive operating surface. Not passive dashboard.

Required sections:

### 1. Top Action Strip

Cards:

- Owned services
- Active P1/P2 incidents
- SLA breaches
- SLA warnings
- Open problems
- Known errors
- Pending governance decisions
- High-risk changes
- Low CSAT count

Each card clickable to filtered view.

### 2. My Required Actions

List all items where Service Owner must act:

- breach response missing
- accepted demand needing commitment approval
- commitment escalation pending
- known error needing workaround approval
- service catalog review overdue
- emergency change post-review due
- low CSAT needing owner review
- problem decision needed

Each row:

- item type
- service
- customer impact
- age
- risk level
- action button

Actions:

- Record Breach Response
- Approve Commitment
- Escalate Commitment
- Approve Workaround
- Request Remediation Plan
- Mark Catalog Reviewed
- Open Detail

### 3. Service Health Heatmap

Matrix:

- service name
- SLA health
- open P1/P2
- open problems
- open changes
- known errors
- CSAT
- risk score

Click row to `service-detail`.

### 4. Customer Impact Feed

Show impacted customers by owned service:

- active incident count
- active breach count
- tickets waiting
- last customer communication
- CSAT average

### 5. Governance History

Last 10 Service Owner decisions:

- commitment approval
- breach response
- lifecycle direction
- catalog accuracy
- remediation authorization

## Service Health View

New file:

- `src/components/workspaces/service-owner/ServiceHealth.tsx`

Purpose:

Single pane per owned service.

Required UI:

### Filters

- service
- health: green/amber/red
- domain
- SLA class
- status: active/planned/retired

### Service Health Table

Columns:

- Service
- SLA class
- Availability target
- Current health
- Open incidents
- P1/P2 count
- SLA clocks breached
- Warnings due soon
- Problems
- Known errors
- High-risk changes
- CSAT
- Catalog reviewed date

### Service Drilldown

On row click open `ServiceDetail`.

Tabs inside detail:

- Overview
- SLA
- Tickets
- Problems
- Known Errors
- Changes
- Customers
- Knowledge
- Risks
- Audit

## Service Incidents View

New file:

- `src/components/workspaces/service-owner/ServiceIncidents.tsx`

Purpose:

Owner sees incidents/cases affecting owned services.

Required filters:

- service
- priority
- status
- customer
- assigned group
- SLA status
- age

Required queues:

- Active P1/P2
- SLA breached
- Due in next hour
- Waiting customer
- Reopened
- Unassigned
- Major incident candidates

Table columns:

- Ticket number
- Title
- Service
- Customer
- Priority
- Status
- Assigned group/user
- Response SLA
- Resolution SLA
- Age
- Last update

Row click:

- `ticket-detail`

Service Owner actions:

- Watch ticket
- Add internal owner note
- Request update
- Authorize emergency response
- Link to problem
- Open related change

Service Owner cannot directly resolve unless permission says so.

## Ticket Detail For Service Owner

New file:

- `src/components/workspaces/service-owner/TicketDetail.tsx`

Required panels:

- Header: number, title, priority, status, service, customer
- SLA clocks: response and resolution
- Customer impact summary
- Conversation thread
- Internal owner notes
- Attachments
- Related problem/change/demand/knowledge
- Event timeline
- Audit timeline

Allowed actions:

- Add internal comment
- Add customer-visible governance update if permitted
- Request update from assigned worker
- Authorize resources
- Direct emergency change
- Link/create problem
- Link knowledge article
- Record breach response

Disallowed:

- Service Owner should not casually assign or resolve tickets unless permission explicitly allows.

## Known Errors View

New file:

- `src/components/workspaces/service-owner/KnownErrors.tsx`

Purpose:

Manage known errors for owned services.

Required filters:

- service
- status
- has workaround
- customer visible
- linked problem
- stale review

Required table columns:

- Known error ID
- Title
- Service
- Linked problem
- Workaround status
- Customer visibility
- Last reviewed
- Open affected tickets
- Permanent fix/change

Actions:

- Review workaround
- Approve customer visibility
- Request better workaround
- Link to knowledge article
- Direct permanent fix
- Retire known error

Workflow:

```text
Problem root cause identified
Known error proposed
Service Owner reviews workaround
Knowledge article drafted
Service Owner or Knowledge Manager approves publication
Customers/SCM can see workaround
Permanent change linked
Known error retired after fix verified
```

## Knowledge View

New file:

- `src/components/workspaces/service-owner/Knowledge.tsx`

Purpose:

Owned-service knowledge governance.

Required tabs:

- Published
- Drafts
- Review queue
- Known error articles
- Retired

Service Owner actions:

- Review article for owned service
- Approve article accuracy
- Request changes
- Retire stale article
- Link article to service/problem/ticket

Article cards show:

- title
- type
- service
- status
- author
- reviewer
- last updated
- linked tickets/problems
- usefulness score if available

## Customer Impact View

New file:

- `src/components/workspaces/service-owner/CustomerImpact.tsx`

Purpose:

Show which customers are impacted by owned services.

Required views:

### Customer Heatmap

Rows:

- customer org
- owned services used
- active tickets
- active P1/P2
- SLA breaches
- open demands
- low CSAT
- last communication

### Impact Timeline

Timeline of:

- SLA breach
- major incident
- customer communication
- ticket created/resolved
- demand accepted
- change completed

### Customer Detail Drawer

Tabs:

- Services used
- Open tickets
- SLA history
- Demands
- Communications
- CSAT

Service Owner actions:

- Request SCM customer update
- Record owner communication note
- Authorize remediation
- Escalate customer risk

## Risk Register View

New file:

- `src/components/workspaces/service-owner/RiskRegister.tsx`

Purpose:

Enterprise risk board for owned services.

Risk item fields:

- id
- service
- title
- source type: SLA | TICKET | PROBLEM | CHANGE | KNOWLEDGE | CSAT | CATALOG
- severity: LOW | MEDIUM | HIGH | CRITICAL
- likelihood
- impact
- owner
- due date
- status: OPEN | MITIGATING | ACCEPTED | CLOSED
- mitigation plan
- linked entity

If no DB model exists, derive risk items from current data first.

Later add:

```prisma
model ServiceRisk {
  id          String @id @default(cuid())
  serviceId   String
  title       String
  sourceType  String
  sourceId    String?
  severity    String
  likelihood  String?
  impact      String?
  ownerId     String?
  status      String
  mitigation  String?
  dueDate     DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Risk creation rules:

- active P1 breach = CRITICAL
- P2 breach older than threshold = HIGH
- known error without workaround = HIGH
- problem open over 7 days without root cause = MEDIUM/HIGH
- emergency change post-review due = HIGH
- CSAT <= 2 = HIGH
- catalog stale over 90 days = MEDIUM

Actions:

- accept risk
- create mitigation
- link change
- request update
- close risk

## Lifecycle View

New file:

- `src/components/workspaces/service-owner/Lifecycle.tsx`

Purpose:

Manage service lifecycle and roadmap.

Sections:

### Lifecycle Board

Columns:

- Planned
- Active
- Under Review
- Retirement Candidate
- Retired

Each service card:

- service name
- SLA class
- customer count
- ticket trend
- problem count
- CSAT
- last catalog review
- next review due

### Lifecycle Actions

- request catalog update
- mark reviewed
- propose retirement
- set replacement guidance
- record lifecycle direction
- link roadmap item

### Required Governance Decisions

Use `GovernanceDecision`:

- `decisionType = LIFECYCLE_DIRECTION`
- decisions:
  - `APPROVED`
  - `ESCALATED`
  - `REMEDIATION_AUTHORIZED`

## Governance View Upgrade

File:

- `src/components/workspaces/service-owner/Governance.tsx`

Keep current commitment approvals and breach responses.

Add tabs:

- Commitment Approvals
- Breach Responses
- Lifecycle Decisions
- Catalog Accuracy
- Escalations
- Decision History

Add exact states:

Commitment:

```text
Accepted demand on owned service
Service Owner reviews commitment
Approve commitment OR escalate
Decision recorded
CM Leader and SCM notified
Demand can move to change only after required owner decision if policy requires
```

Breach:

```text
SLA breach on owned service
Owner sees breach in dashboard and SLA view
Owner records response
Response includes decision, rationale, resources, follow-up owner/date
CM Leader notified
Audit log written
Risk item created or updated
```

Catalog:

```text
Service metadata stale or change proposes catalog update
Owner reviews catalog accuracy
Owner approves/request changes
Decision recorded
Catalog review date updated
```

Escalation:

```text
Commitment/risk exceeds owner authority
Owner escalates to Governance Owner
CM Leader notified
Escalation remains open until decision/resolution
```

## SLA Performance Upgrade

File:

- `src/components/workspaces/service-owner/SlaPerformance.tsx`

Current view uses SLA events. Upgrade to SLA clocks.

Add sections:

- Active SLA clocks by service
- Breached clocks
- Due soon clocks
- Response compliance
- Resolution compliance
- Breach response status
- Problem linkage
- Customer communication status

Each breach row:

- service
- ticket
- customer
- SLA type
- due date
- breached at
- assigned user/group
- problem linked?
- owner response recorded?

Actions:

- record breach response
- open ticket
- open problem
- open change
- create risk

## Problems View Upgrade

File:

- `src/components/workspaces/service-owner/Problems.tsx`

Add owner actions:

- request root cause update
- approve known error classification
- approve workaround publication
- direct change required
- link knowledge article
- create risk

Add tabs:

- Active Problems
- Root Cause Pending
- Decision Needed
- Known Errors
- Linked To Change
- Closed

Problem detail add:

- linked tickets
- linked SLA breaches
- linked changes
- linked knowledge article
- workaround review
- owner decision history

## Changes View Upgrade

File:

- `src/components/workspaces/service-owner/Changes.tsx`

Service Owner must see only changes touching owned services.

Add categories:

- Emergency changes
- Complex changes
- Changes pending approval
- In implementation
- Verification/cutover
- Post implementation review due
- Catalog update required

Service Owner actions:

- review risk
- authorize resources
- request rollback readiness
- record post-implementation owner review
- verify customer impact plan
- link risk

## Portfolio View Upgrade

File:

- `src/components/workspaces/service-owner/Portfolio.tsx`

Current dialog too catalog-centric.

Upgrade detail tabs:

- Overview
- Health
- SLA clocks
- Incidents
- Customers
- Problems
- Known errors
- Changes
- Knowledge
- Lifecycle
- Audit

Add catalog review action:

- Mark catalog accurate
- Request catalog update
- Record catalog accuracy governance decision

Add fields:

- lastReviewedAt
- nextReviewDue
- lifecycleStage
- customerCount
- activeTicketCount
- activeBreachCount
- riskScore

If schema lacks fields, derive or add migration.

## Service Detail View

New file:

- `src/components/workspaces/service-owner/ServiceDetail.tsx`

Route:

- `navigate('service-detail', { id: service.id })`

This becomes primary drilldown.

Header:

- service name
- SLA class
- status
- health
- risk score
- owner
- technical owner

Tabs:

1. Summary
2. Health
3. Tickets
4. SLA
5. Customers
6. Problems
7. Known Errors
8. Changes
9. Knowledge
10. Lifecycle
11. Audit

Each tab must fetch scoped data by `serviceId`.

## Audit View

New file:

- `src/components/workspaces/service-owner/OwnerAudit.tsx`

Service Owner sees audit for owned service entities only.

Filters:

- service
- entity type
- actor
- action
- date range

Rows:

- timestamp
- actor
- action
- entity
- before/after diff summary

Actions:

- open entity
- export later in reporting phase

## Required Components

Create shared owner components:

- `OwnerActionCard.tsx`
- `ServiceHealthBadge.tsx`
- `RiskScoreBadge.tsx`
- `SlaClockBadge.tsx`
- `CustomerImpactBadge.tsx`
- `OwnerDecisionDialog.tsx`
- `BreachResponseDialog.tsx`
- `CatalogReviewDialog.tsx`
- `RiskDrawer.tsx`
- `ServiceDetailTabs.tsx`
- `TicketMiniTable.tsx`
- `KnowledgeArticleCard.tsx`

Location:

- `src/components/workspaces/service-owner/_components/`

## Data Types To Add

Update `src/lib/types.ts`.

Add:

```ts
export interface SlaClock {
  id: string;
  ticketId: string;
  policyId: string;
  type: 'RESPONSE' | 'RESOLUTION';
  status: 'RUNNING' | 'PAUSED' | 'MET' | 'BREACHED' | 'CANCELED';
  startedAt: string;
  dueAt: string;
  pausedAt: string | null;
  totalPausedMins: number;
  metAt: string | null;
  breachedAt: string | null;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  body: string;
  type: 'HOW_TO' | 'KNOWN_ERROR' | 'FAQ' | 'RUNBOOK';
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'RETIRED';
  serviceId: string | null;
  serviceName?: string | null;
  authorId: string;
  authorName?: string;
  reviewerId: string | null;
  reviewerName?: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface OwnerRiskItem {
  id: string;
  serviceId: string;
  serviceName: string;
  title: string;
  sourceType: string;
  sourceId: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'MITIGATING' | 'ACCEPTED' | 'CLOSED';
  mitigation: string | null;
  dueDate: string | null;
}

export interface CustomerImpactSummary {
  customerId: string;
  customerName: string;
  serviceIds: string[];
  activeTickets: number;
  p1p2Tickets: number;
  activeBreaches: number;
  openDemands: number;
  averageCsat: number | null;
  lastCommunicationAt: string | null;
}
```

## Decision Dialogs

All Service Owner decisions must require rationale.

Common fields:

- decision type
- decision
- rationale
- resources authorized
- follow-up owner
- follow-up date
- linked entity

Use `POST /api/governance-decisions`.

Decision types:

- `COMMITMENT_APPROVAL`
- `COMMITMENT_ESCALATION`
- `BREACH_RESPONSE`
- `LIFECYCLE_DIRECTION`
- `CATALOG_ACCURACY`
- `RISK_ACCEPTANCE`
- `REMEDIATION_DIRECTION`
- `KNOWLEDGE_APPROVAL`

If API enum validation blocks new types, update validation.

## Notifications Required

Service Owner actions must notify:

### Commitment approved

Notify:

- assigned SCM Worker
- CM Leader
- customer requester if customer-visible

### Breach response recorded

Notify:

- CM Leader
- assigned SCM Worker for impacted customer
- Service Owner themselves only if follow-up assigned

### Escalation

Notify:

- CM Leader
- Governance Owner/System Admin role if exists
- all Service Owners only if enterprise-wide risk

### Knowledge approved

Notify:

- article author
- SCM Workers assigned to impacted customers if customer-visible

### Catalog accuracy issue

Notify:

- CM Leader
- catalog/service admin if exists

## Audit Required

Every Service Owner action must write `AuditLog`.

Actions:

- `OWNER_COMMITMENT_APPROVED`
- `OWNER_COMMITMENT_ESCALATED`
- `OWNER_BREACH_RESPONSE_RECORDED`
- `OWNER_REMEDIATION_AUTHORIZED`
- `OWNER_EMERGENCY_CHANGE_DIRECTED`
- `OWNER_KNOWN_ERROR_APPROVED`
- `OWNER_KNOWLEDGE_APPROVED`
- `OWNER_CATALOG_REVIEWED`
- `OWNER_RISK_ACCEPTED`
- `OWNER_LIFECYCLE_DIRECTION_RECORDED`

## Role And Permission Rules

Service Owner permissions needed:

- `service.owner.dashboard.read`
- `service.owner.health.read`
- `service.owner.tickets.read`
- `service.owner.sla.read`
- `service.owner.problems.read`
- `service.owner.changes.read`
- `service.owner.knowledge.read`
- `service.owner.knowledge.approve`
- `service.owner.risk.manage`
- `service.owner.governance.decide`
- `service.owner.audit.read`

Object check always required:

- service must be owned by session user
- ticket must touch owned service
- problem must touch owned service
- change must affect owned service
- demand must relate to owned service
- article must belong to owned service

## UI Quality Requirements

Do:

- dense enterprise dashboard
- action-first sections
- clear risk levels
- tabbed detail pages
- compact tables
- filters and saved filter defaults
- drilldowns everywhere
- no decorative marketing sections
- no nested cards inside cards
- no huge hero copy

Avoid:

- passive statistics only
- toast-only actions
- fake placeholders
- unscoped all-tenant data
- UI text explaining how app works
- overlarge cards
- one-note color palette

## Acceptance Criteria

Service Owner upgrade done when:

- Navigation includes Service Health, Incidents, Known Errors, Customer Impact, Risk Register, Lifecycle.
- Command Center shows required owner actions, not only metrics.
- Service Owner can drill into any owned service.
- Service Owner can see tickets/incidents on owned services.
- Service Owner can see SLA clocks and breach response status.
- Service Owner can record breach response with rationale and follow-up.
- Service Owner can approve/escalate commitments.
- Service Owner can govern known errors and knowledge for owned services.
- Service Owner can see customer impact by customer org.
- Service Owner can manage/derive risk register.
- Service Owner can review lifecycle and catalog accuracy.
- All views are scoped to owned services.
- All owner decisions create governance decision, notification, and audit log.
- Typecheck passes.
- Build passes.

## Implementation Order

1. Fix `ViewKey` and Service Owner nav.
2. Add missing API filters: `owner=me`, `serviceId`, SLA clocks.
3. Extend `_hooks.ts`.
4. Create shared owner components.
5. Build `ServiceHealth`.
6. Build `ServiceIncidents`.
7. Build `TicketDetail`.
8. Build `KnownErrors`.
9. Build `Knowledge`.
10. Build `CustomerImpact`.
11. Build `RiskRegister`.
12. Build `Lifecycle`.
13. Build `ServiceDetail`.
14. Upgrade `Dashboard`.
15. Upgrade `Governance`.
16. Upgrade `SlaPerformance`.
17. Upgrade `Problems`.
18. Upgrade `Changes`.
19. Add owner audit if API exists.
20. Add notifications and audit calls for owner actions.
21. Run verification.

## Verification Commands

```powershell
npm run lint
npm run typecheck
npm run build
npx prisma validate
```

Also manually verify:

- login as `owner@cerebree.io`
- each new nav item opens
- no forbidden all-tenant records appear
- owned service drilldown works
- ticket detail opens
- breach response records decision
- known error view shows only owned service problems/articles
- customer impact uses owned services only
- risk register derives sensible risk items

