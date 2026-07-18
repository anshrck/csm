# Role Specification — Service Customer (`SERVICE_CUSTOMER`)

> **Document status:** Implementation Source of Truth
> **Target codebase:** CereBree uSMS / CSM (`Next.js + Prisma`)
> **Implementation rule:** The AI/engineer MUST verify every referenced file and model before editing. It MUST NOT invent endpoints, fields, roles, or workflow states.
> **Security rule:** UI hiding is not authorization. Every power defined here MUST be enforced server-side and scoped at record level.


## 1. Role purpose

An external customer/contact who requests and consumes services. This role represents the customer's authorized view into their own organizational account. It is not an internal support role.

## 2. Scope boundary

Default scope: `OWN_ORG`.

The user may access only records where `serviceCustomerId == session.orgNodeId`, plus published catalog and knowledge content available to that organization. No tenant-wide fallback is permitted.

## 3. Target visibility

### May see

- Own organization dashboard and service health summary intended for customers.
- Demands submitted by the user or belonging to their organization.
- Tickets belonging to their organization.
- Customer-visible ticket/demand events and communications.
- Quotes issued to their organization.
- Accepted commitments, customer-facing SLA targets and issued SLA reports.
- Services and offerings entitled/published to their organization.
- Published knowledge articles.
- Own attachments and customer-visible attachments on accessible records.
- Change progress only when it affects their subscribed service and is marked customer-visible.

### Must never see

- Internal notes, internal communication, worker discussion or assignment rationale.
- Other customers, organizations, demands, tickets, contacts or attachments.
- Internal audit logs, delivery queues, notification internals or authorization logs.
- Internal cost, margin, effort breakdown, risk scoring or approval commentary.
- Draft knowledge, draft SLA reports or unapproved quotes.
- Service-owner governance decisions unless explicitly published as a customer commitment.

## 4. Target powers

| Resource | Allowed powers | Conditions |
|---|---|---|
| Demand | create, read, add customer comment, attach, withdraw, accept quote, reject quote with reason, confirm fulfilment, close, request reopen | Own organization; action must be valid for state |
| Ticket | create, read, add customer comment, attach, confirm resolution, close, reopen | Own organization; reopen only within configured window |
| Quote | read, accept, reject | Must be approved and issued; cannot edit commercial fields |
| Service catalog | read, request | Only active/published/entitled offerings |
| SLA | read customer-facing targets and issued reports; dispute report | No draft/internal metrics |
| Knowledge | read published; mark helpful/unhelpful | No create/edit/publish |
| Profile/contact | edit permitted profile fields | Cannot grant own privileges or move org |

## 5. Workflow powers

### Demand

- `NEW`: creator may edit customer-owned input fields or withdraw.
- `UNDER_REVIEW`: may answer questions and add attachments; cannot change scope silently.
- `QUOTED`: may accept or reject issued quote.
- `ACCEPTED` / `IN_CHANGE`: read progress and communicate; cannot force transition.
- `FULFILLED`: confirm fulfilment, report issue, or close.
- `CLOSED`: read; request reopen when policy permits.
- `REJECTED` / `REDIRECTED`: read reason and submit a new demand.

### Ticket

- Create in initial state.
- Add customer comments while active.
- Confirm resolution or reopen; cannot set internal assignment, priority, SLA clock or resolution code.

## 6. Protected fields

Customer MUST NOT set or modify:

`assignedScmWorkerId`, `assignedUserId`, internal priority, SLA breach status, internal notes, quote approval flags, approver IDs, estimated internal effort, internal cost/margin, governance decision, service owner, technical owner, lifecycle stage, audit metadata, resolution timestamps.

## 7. Current-code upgrade points

- Replace broad organization access with explicit customer-visible field projection in demand/ticket/communication serializers.
- Ensure `src/lib/entity-access.ts` validates organization scope for every customer-readable entity.
- Split `communication.read.own` into customer-visible vs internal communication permissions.
- Validate quote is approved and issued before customer acceptance.
- Add server-side state validation for close/reopen/withdraw.
- Ensure search, attachments, audit-entity endpoints and AI context use exactly the same scope.

## 8. Required permission keys

```text
demand.read.own_org
demand.create.own_org
demand.update.customer_fields
demand.withdraw.own_org
demand.quote.respond.own_org
demand.fulfilment.confirm.own_org
demand.close.own_org
demand.reopen.request.own_org
ticket.read.own_org
ticket.create.own_org
ticket.comment.customer
ticket.resolve.confirm.own_org
ticket.close.own_org
ticket.reopen.own_org
catalog.read.entitled
catalog.request.entitled
sla.read.customer
sla.report.read.issued
sla.report.dispute
knowledge.read.published
attachment.read.customer_visible
attachment.upload.own_org
communication.read.customer_visible
communication.create.customer
```

## 9. Acceptance tests

- Customer A cannot access Customer B records by ID, search, attachment URL, AI query, export, or linked entity.
- Customer cannot view an internal comment even when it belongs to their ticket.
- Customer cannot accept an unapproved/unissued quote.
- Customer cannot modify assignment, priority, SLA, owner, approval or audit fields through crafted JSON.
- Customer can reopen only an eligible closed/resolved record and a reason is recorded.
- UI actions exactly match successful backend actions.

## 10. Definition of done

This role is complete only when the account boundary and customer-visible data projection are enforced on every read and write path.


## External reference baseline

This specification adapts—not blindly copies—the following official ServiceNow patterns:

1. ServiceNow CSM separates **internal agent/manager roles** from **external customer roles**.
2. A customer service agent creates, views, edits, and works cases with customers and subject-matter experts.
3. A customer service manager adds responsibility for managing agents/groups and overriding agent actions.
4. Customer portal roles are scoped to the user's account, child accounts, own cases, or account cases depending on authority.
5. A Service Owner is accountable for the service; day-to-day management and delegated editing can be assigned separately.
6. Access must evaluate role, rule conditions, record scope, and field-level restrictions—not role name alone.

Authoritative references:
- ServiceNow, **Customer Service Management roles**: https://www.servicenow.com/docs/r/roles-by-product/roles_customerservicemanagement.html
- ServiceNow, **Roles installed with Customer Service Management**: https://www.servicenow.com/docs/r/customer-service-management/r_RolesInstalledWithCustomerService.html
- ServiceNow, **Assign roles to CSM users**: https://www.servicenow.com/docs/r/customer-service-management/assign-csm-roles.html
- ServiceNow, **Customer Service Portal user roles**: https://www.servicenow.com/docs/r/customer-service-management/r_CustomerServicePortalUserRoles.html
- ServiceNow, **Create a service offering**: https://www.servicenow.com/docs/r/it-service-management/service-builder/create-edit-service-offering.html
- ServiceNow, **Explore Access Control Lists**: https://www.servicenow.com/docs/r/platform-security/access-control/exploring-access-control-list.html
