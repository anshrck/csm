# Role Specification — Service Customer Manager / Worker (`SCM_WORKER`)

> **Document status:** Implementation Source of Truth
> **Target codebase:** CereBree uSMS / CSM (`Next.js + Prisma`)
> **Implementation rule:** The AI/engineer MUST verify every referenced file and model before editing. It MUST NOT invent endpoints, fields, roles, or workflow states.
> **Security rule:** UI hiding is not authorization. Every power defined here MUST be enforced server-side and scoped at record level.


## 1. Role purpose

An internal frontline CSM agent responsible for assigned customers and assigned work. The worker coordinates demand assessment, case handling, customer communication, quote preparation, SLA report preparation and operational follow-through. It is not an approval or tenant-administration role.

## 2. Scope boundary

Default scope: `ASSIGNED + ASSIGNED_CUSTOMERS`.

A worker may access a record only when at least one explicit relation exists:

- assigned directly to the record;
- assigned to the customer organization through `CustomerAssignment`;
- member of the assignment group responsible for the record;
- temporary delegated assignment that is active and auditable.

No tenant-wide read access merely because the role is `SCM_WORKER`.

## 3. Target visibility

### May see

- Assigned customer portfolio, contacts needed for service delivery, entitlements and active services.
- Assigned demands, tickets, related changes/problems and handovers necessary to perform work.
- Customer-visible and internal working communications for scoped records.
- SLA events and reports for assigned customers.
- Published knowledge and internal knowledge permitted to agents.
- Own workload, queues, tasks, due dates and escalations.
- Governance decisions relevant to assigned work, read-only.

### Must not see

- Unassigned customers and unrelated tenant work.
- Manager-only workforce analytics, private performance data or disciplinary information.
- Service Owner private portfolio/risk decisions unrelated to assigned work.
- Approval controls for own quote/report/change.
- Security configuration, role assignments or permission administration.

## 4. Target powers

| Resource | Allowed powers | Conditions |
|---|---|---|
| Demand | create on behalf of customer, assess, classify, request information, recommend redirect/reject, prepare quote, submit quote, coordinate fulfilment, propose close | Scoped record; cannot approve own quote/rejection |
| Ticket | create, triage, update, assign within authorized group, investigate, communicate, resolve, propose close, reopen | Scoped record; priority overrides limited by policy |
| Quote | draft, edit before submission, submit for approval, revise after rejection | Cannot approve or issue without approval |
| SLA report | prepare, validate source data, submit for review, issue after approval | Cannot approve own report |
| Change | create/coordinate from demand or problem, assess business/customer impact, add plan input, track implementation | Cannot be sole technical/change approver |
| Knowledge | create, edit own draft, submit for review | Cannot publish/retire unless separately authorized |
| Communication | send customer communication, internal notes, request response | Scoped records; visibility classification required |
| Escalation | escalate to CM Leader or Service Owner | Mandatory reason and severity |

## 5. Workflow powers

### Demand

- May move `NEW -> UNDER_REVIEW` after assignment and required validation.
- May prepare quote but only `CM_LEADER` can approve it.
- May recommend `REJECTED` or `REDIRECTED`; authorization must follow configured policy.
- May coordinate `ACCEPTED -> IN_CHANGE` when required handover exists.
- May mark `FULFILLED` with evidence; customer/leader closure rules remain separate.

### Ticket

- May triage and resolve assigned/scoped tickets.
- Assignment outside own authorized group requires CM Leader power.
- Major priority changes require reason; critical override requires leader approval or emergency policy.
- Resolution requires code, notes, evidence and customer-visible summary.

## 6. Protected actions

Worker MUST NOT:

- approve a quote, SLA report, commitment or governance decision they created;
- override another worker's completed action without leader authority;
- change service ownership, lifecycle stage or portfolio status;
- alter audit records or notification delivery history;
- grant roles/permissions;
- access unrelated records through search, links, exports, AI or attachments;
- delete operational records to hide history.

## 7. Current-code upgrade points

- Replace current `demand.read.all` and `ticket.read.all` for worker with assigned scopes.
- Review all APIs using `requireRole('SCM_WORKER', ...)`; add permission + record + state checks.
- Correct change endpoints where worker can currently assess, plan, approve, implement, verify, reject and close through broad role gates; split powers and enforce maker-checker.
- Require visibility type for every communication (`CUSTOMER_VISIBLE` or `INTERNAL`).
- Restrict assignment to allowed groups/customers.
- Add structured escalation rather than using status edits as escalation.

## 8. Required permission keys

```text
customer.read.assigned
demand.read.assigned
demand.create.for_assigned_customer
demand.assess.assigned
demand.quote.draft.assigned
demand.quote.submit.assigned
demand.reject.recommend.assigned
demand.redirect.recommend.assigned
demand.fulfilment.mark.assigned
demand.close.propose.assigned
ticket.read.assigned
ticket.create.for_assigned_customer
ticket.triage.assigned
ticket.update.assigned
ticket.assign.within_group
ticket.resolve.assigned
ticket.reopen.assigned
sla.event.read.assigned
sla.report.prepare.assigned
sla.report.submit.assigned
sla.report.issue.approved
change.read.related
change.create.related
change.assess.customer_impact
handover.create.assigned
handover.acknowledge.assigned
communication.read.scoped
communication.create.scoped
knowledge.create
knowledge.update.own_draft
knowledge.submit_review
escalation.create.scoped
```

## 9. Acceptance tests

- Worker cannot open an unassigned customer record by ID or search.
- Worker assigned to Customer A can access Customer A's scoped records but not Customer B.
- Worker can draft and submit a quote but cannot approve it, including through a generic PATCH.
- Worker cannot approve/verify/close a change when maker-checker policy forbids it.
- Assignment outside authorized group is denied.
- Every escalation, override request and customer communication is audited.

## 10. Definition of done

The worker can fully perform frontline CSM work for assigned scope without receiving manager, owner, or tenant-wide authority.


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
