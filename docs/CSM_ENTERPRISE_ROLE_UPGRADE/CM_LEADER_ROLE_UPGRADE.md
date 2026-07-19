# Role Specification — Customer Management Leader (`CM_LEADER`)

> **Document status:** Implementation Source of Truth
> **Target codebase:** CereBree uSMS / CSM (`Next.js + Prisma`)
> **Implementation rule:** The AI/engineer MUST verify every referenced file and model before editing. It MUST NOT invent endpoints, fields, roles, or workflow states.
> **Security rule:** UI hiding is not authorization. Every power defined here MUST be enforced server-side and scoped at record level.


## 1. Role purpose

An internal CSM operations manager accountable for agent teams, queues, service quality, workload, escalations and defined approval gates. This role corresponds to the ServiceNow pattern of an agent with additional responsibility for managing agents/groups and overriding agent actions—but every override remains policy-bound and audited.

## 2. Scope boundary

Default scope: `MANAGED_TEAM`; optional `TENANT` only where your product intentionally has one CM Leader authority across the tenant.

Preferred implementation:

- Leader sees records owned by managed teams, queues and customers.
- Tenant-wide governance visibility is a separate permission, not implied by role.
- Workforce and override powers apply only to managed teams.

## 3. Target visibility

### May see

- Managed teams, queues, assignments, workload, backlog, ageing and SLA risk.
- Demands/tickets/communications for managed scope.
- Quote drafts submitted for approval, SLA reports submitted for review.
- Escalations, failed notifications and operational audit trails.
- Customer health and CSAT for managed portfolio.
- Related service/change/problem context needed for operational decisions.

### Must not automatically see or control

- Service portfolio outside managed scope.
- Service Owner strategic roadmap, lifecycle or risk decisions unrelated to operations.
- Security/permission administration.
- Private HR data beyond operational workload/performance indicators.
- Every tenant record unless explicitly granted `*.read.tenant`.

## 4. Target powers

| Resource | Allowed powers | Conditions |
|---|---|---|
| Team/work queue | assign, reassign, balance workload, delegate, activate backup | Managed team only; reason for forced reassignment |
| Demand | assign, approve/reject quote, authorize redirect/rejection, override worker transition, approve closure exception | Managed scope; maker-checker and reason required |
| Ticket | assign/reassign, approve priority override, reopen/close exception, escalate | Managed scope |
| Quote | approve, reject for revision, revoke before customer acceptance | Cannot approve own authored quote; limits may apply |
| SLA report | review, approve, reject for correction, authorize issue | Cannot approve own prepared report |
| Communication | review sensitive outbound communication, approve mass/critical communication | Managed scope |
| Knowledge | review, publish, retire according to ownership policy | Must not bypass service-owner ownership where applicable |
| Operational controls | process notification delivery, view audit, manage queue exceptions | No audit alteration |

## 5. Override policy

Every override requires:

- target record and original action;
- reason code;
- free-text justification;
- before/after values;
- actor and timestamp;
- notification to affected assignee where relevant.

Leader override cannot bypass:

- organization/tenant isolation;
- legal hold or immutable audit;
- Service Owner-only service accountability decisions;
- separation-of-duties restrictions unless an emergency break-glass policy explicitly allows it.

## 6. Workflow powers

### Demand

- Assign/reassign `NEW` demands.
- Review assessment quality.
- Approve/reject submitted quotes.
- Authorize rejection/redirect when evidence is sufficient.
- Approve exception transitions and closure where policy permits.

### Ticket

- Manage queues and priority exceptions.
- Reassign across managed teams.
- Reopen/close on exception with reason.
- Trigger major escalation and customer communication review.

### Change

CM Leader is not automatically the technical Change Authority. In this four-role system, the leader may approve the customer/operational impact gate, but technical implementation approval must be separated by policy or Service Owner authority for owned services. Do not let one role perform assessment, planning, approval, implementation, verification and closure without separation.

## 7. Protected actions

CM Leader MUST NOT:

- change service ownership or service lifecycle merely because they manage agents;
- make Service Owner governance commitments for unrelated services;
- approve own quote/report/change;
- alter/delete audit entries;
- silently expose internal data to customers;
- assign roles or edit permission tables unless separately granted security administration;
- use tenant-wide exports without an explicit permission and audit event.

## 8. Current-code upgrade points

- Replace unconditional `if (session.role === 'CM_LEADER') return true` in `src/lib/entity-access.ts` with explicit managed scope or separately granted tenant visibility.
- Split broad leader powers into assignment, approval, override, operational-admin and audit-read permissions.
- Add approver-vs-author checks to quote, SLA report and change routes.
- Add approval limits and mandatory rejection/override reasons.
- Retain notification oversight, but separate retry/process permission from viewing all payload content.
- Ensure leader cannot edit Service Owner fields through generic service updates.

## 9. Required permission keys

```text
team.read.managed
team.workload.manage
assignment.manage.managed_scope
demand.read.managed_scope
demand.assign.managed_scope
demand.quote.approve.managed_scope
demand.quote.reject.managed_scope
demand.reject.authorize.managed_scope
demand.redirect.authorize.managed_scope
demand.transition.override.managed_scope
ticket.read.managed_scope
ticket.assign.managed_scope
ticket.priority.override.managed_scope
ticket.close.override.managed_scope
ticket.reopen.override.managed_scope
sla.report.review.managed_scope
sla.report.approve.managed_scope
knowledge.review
knowledge.publish.authorized_scope
knowledge.retire.authorized_scope
communication.review.sensitive
escalation.manage.managed_scope
audit.read.operational_scope
notification.delivery.read.operational_scope
notification.delivery.retry
export.operational.managed_scope
```

Optional, separately granted:

```text
demand.read.tenant
ticket.read.tenant
audit.read.tenant
analytics.read.tenant
```

## 10. Acceptance tests

- Leader can manage only teams and records in configured scope unless explicit tenant permission exists.
- Leader cannot approve an object they authored/prepared.
- Every override records reason and before/after values.
- Leader cannot change service ownership or lifecycle without owner-governance permission.
- Leader can approve submitted quotes and SLA reports but cannot edit immutable approval evidence afterward.
- Removing a user from the leader's managed scope immediately removes record authority.

## 11. Definition of done

The CM Leader has strong operational authority over managed CSM work, but is not a universal administrator or substitute Service Owner.


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
