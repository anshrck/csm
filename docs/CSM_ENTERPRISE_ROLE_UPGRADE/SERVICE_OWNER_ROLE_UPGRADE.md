# Role Specification — Service Owner (`SERVICE_OWNER`)

> **Document status:** Implementation Source of Truth
> **Target codebase:** CereBree uSMS / CSM (`Next.js + Prisma`)
> **Implementation rule:** The AI/engineer MUST verify every referenced file and model before editing. It MUST NOT invent endpoints, fields, roles, or workflow states.
> **Security rule:** UI hiding is not authorization. Every power defined here MUST be enforced server-side and scoped at record level.


## 1. Role purpose

The accountable business/service authority for one or more services. The Service Owner owns value, quality, commitments, risk, lifecycle, health and improvement of the services explicitly assigned to them.

This is the most important correction: **Service Owner is powerful within owned services, not powerful everywhere.** It is not a generic super-admin, customer service manager, ticket dispatcher or platform administrator.

## 2. Scope boundary

Default scope: `OWNED_SERVICES`.

A record is in scope only when it is directly or reliably related to a service where `service.serviceOwnerId == session.id`, including:

- service and service offerings;
- demands related to the owned service;
- tickets/incidents/problems/changes affecting the owned service;
- SLA events/reports and customer commitments for the owned service;
- service risks, lifecycle reviews, improvement actions and governance decisions.

No access is granted when the relationship is missing or only inferred from free text.

## 3. Enterprise responsibilities

The Service Owner is accountable for:

1. Service vision, purpose, customer value and measurable outcomes.
2. Service lifecycle: planned, active, improvement, restricted, retired.
3. Service catalog accuracy and offering approval.
4. SLA/OLA targets and service commitments.
5. Service health, risk acceptance and breach response.
6. Major change/customer-impact approval for owned services.
7. Service performance review and continual improvement plan.
8. Ownership/delegation continuity and periodic certification.
9. Customer-facing service quality and unresolved systemic issues.
10. Evidence that the service remains supported, compliant and valuable.

## 4. Target visibility

### May see for owned services

- Full service record, offering structure, entitlements and dependencies.
- Service health, SLA trends, breaches, availability and customer impact.
- Related demands, tickets, incidents, problems, changes and handovers.
- Customer feedback, CSAT and service-specific communications.
- Service risks, governance decisions and improvement backlog.
- Service-specific audit evidence and knowledge ownership status.
- Cost/value indicators intentionally assigned to Service Owner governance.

### Must not automatically see

- Unrelated services or customers.
- Agent private performance/HR information.
- Unrelated operational queues and tickets.
- Platform security settings, global role assignments or permission administration.
- Commercial details unrelated to owned service commitments.

## 5. Target powers

| Domain | Allowed powers | Conditions |
|---|---|---|
| Service | create draft, edit owned service, define value/outcomes, submit/approve lifecycle transitions, restrict/retire, certify ownership | Owned service; high-risk lifecycle actions require policy/secondary approval |
| Service offering | create/edit/activate/deactivate offerings, approve customer-facing definition | Owned service |
| Ownership | nominate delegate/manager, transfer ownership through controlled workflow | Cannot silently self-assign unrelated service |
| SLA/commitment | propose/approve targets, accept risk, approve breach response, approve service commitment | Owned service; immutable evidence |
| Demand | read related demands, approve service feasibility/commitment gate, reject commitment with reason, prioritize against service roadmap | Cannot perform worker's case handling by default |
| Ticket/incident/problem | read, set service-level priority guidance, declare service risk/major escalation, require problem review | Does not replace assigned resolver |
| Change | approve/reject customer/business/service-impact gate, require risk controls, accept residual risk, verify service outcome | Owned service; cannot be sole implementer and verifier |
| Knowledge | own/approve/publish/retire service knowledge or delegate ownership group | Owned service |
| Improvement | create/prioritize improvement initiatives and track benefits | Owned service |
| Governance | create and decide commitments, risk acceptances, exceptions and breach responses | Owned service only |

## 6. Service lifecycle authority

Use explicit lifecycle states, for example:

```text
DRAFT -> REVIEW -> APPROVED -> ACTIVE -> IMPROVEMENT/RESTRICTED -> RETIRED
```

Required gates:

- `DRAFT -> REVIEW`: mandatory owner, description, value, customer, support model, offering and SLA data.
- `REVIEW -> APPROVED`: owner decision plus required technical/compliance review.
- `APPROVED -> ACTIVE`: operational readiness evidence.
- `ACTIVE -> RESTRICTED`: reason, customer impact and recovery plan.
- `ACTIVE/RESTRICTED -> RETIRED`: migration/communication/data-retention plan and secondary approval.

No generic PATCH may directly change lifecycle state.

## 7. Service governance decisions

Each decision MUST contain:

- service ID and owner ID;
- decision type;
- affected customer/commitment where applicable;
- options considered;
- decision and rationale;
- risk/impact;
- effective date and review date;
- evidence/attachments;
- approver/delegate identity;
- immutable audit event.

Decision types should include:

`COMMITMENT_APPROVAL`, `SLA_EXCEPTION`, `RISK_ACCEPTANCE`, `BREACH_RESPONSE`, `SERVICE_RESTRICTION`, `SERVICE_RETIREMENT`, `MAJOR_CHANGE_IMPACT`, `IMPROVEMENT_PRIORITY`.

## 8. Delegation model

ServiceNow distinguishes the accountable owner from day-to-day manager/delegate. Preserve accountability:

- Owner remains accountable.
- Delegate can act only for named service, named powers and time window.
- Delegation has start/end time, reason and audit.
- High-risk actions may be non-delegable or require secondary approval.
- Expired delegation must stop working immediately.

## 9. Protected actions

Service Owner MUST NOT:

- view or govern services they do not own;
- manage agent assignments or queues unless separately granted;
- approve own technical implementation and verification as the only authority;
- alter audit records;
- grant platform roles/permissions;
- use governance decisions to mutate unrelated customer records;
- bypass mandatory lifecycle, risk or customer-communication gates;
- read internal records merely because `SERVICE_OWNER` is included in a route role list.

## 10. Current-code upgrade points

- Preserve owned-service scoping in `src/lib/entity-access.ts`, but make it authoritative across every endpoint, search, attachment, audit and AI context.
- Replace `demand.read.all` and `ticket.read.all` for Service Owner with `*.read.owned_services`.
- Expand current `service.manage` into granular service, offering, lifecycle, ownership, SLA and governance permissions.
- Review change routes: Service Owner currently receives read access but lacks a clear service-impact approval gate. Add explicit owner decision endpoints/actions.
- Keep governance decision creation restricted to owners, but validate actual ownership and decision type/state.
- Separate operational record editing from governance authority; owner should not casually edit ticket resolution or worker assignments.
- Add delegation, ownership transfer and periodic ownership certification.
- Add service lifecycle transition policy and immutable decision evidence.

## 11. Required permission keys

```text
service.read.owned
service.update.owned
service.lifecycle.submit.owned
service.lifecycle.approve.owned
service.lifecycle.restrict.owned
service.lifecycle.retire.owned
service.ownership.delegate.owned
service.ownership.transfer.request
service.ownership.certify.owned
service_offering.create.owned
service_offering.update.owned
service_offering.activate.owned
service_offering.retire.owned
demand.read.owned_services
demand.commitment.approve.owned_services
demand.commitment.reject.owned_services
ticket.read.owned_services
problem.read.owned_services
problem.review.require.owned_services
change.read.owned_services
change.service_impact.approve.owned_services
change.service_impact.reject.owned_services
change.residual_risk.accept.owned_services
sla.read.owned_services
sla.target.manage.owned_services
sla.exception.approve.owned_services
sla.breach_response.decide.owned_services
sla.report.read.owned_services
knowledge.read.owned_services
knowledge.publish.owned_services
knowledge.retire.owned_services
governance.read.owned_services
governance.decide.owned_services
risk.read.owned_services
risk.accept.owned_services
improvement.manage.owned_services
audit.read.owned_services
analytics.read.owned_services
```

## 12. Acceptance tests

- Owner A cannot access Service B records owned by Owner B by ID, search, attachment, audit or AI.
- Owner can update and govern owned service but cannot manage unrelated worker queues.
- Lifecycle transition fails when required evidence/gates are missing.
- Ownership transfer requires controlled workflow; changing `serviceOwnerId` through generic PATCH is denied.
- Delegated user loses authority at expiry and cannot exceed delegated powers.
- Owner cannot be sole requester, implementer, verifier and approver for a high-risk change.
- Every commitment, risk acceptance, lifecycle action and breach response is immutable and auditable.

## 13. Definition of done

The Service Owner has deep, enterprise-grade authority over the complete value, quality, risk, commitment and lifecycle of owned services—without becoming a tenant super-admin.


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
