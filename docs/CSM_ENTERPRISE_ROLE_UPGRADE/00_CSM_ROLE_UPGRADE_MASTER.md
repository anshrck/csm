# CSM Enterprise Role Upgrade — Master Control Document

> **Document status:** Implementation Source of Truth
> **Target codebase:** CereBree uSMS / CSM (`Next.js + Prisma`)
> **Implementation rule:** The AI/engineer MUST verify every referenced file and model before editing. It MUST NOT invent endpoints, fields, roles, or workflow states.
> **Security rule:** UI hiding is not authorization. Every power defined here MUST be enforced server-side and scoped at record level.


## 1. Objective

Upgrade the existing four-role CSM model without replacing the product architecture or adding unnecessary personas:

- `SERVICE_CUSTOMER`
- `SCM_WORKER`
- `CM_LEADER`
- `SERVICE_OWNER`

The upgrade is complete only when each role has an explicit definition of:

`visibility + record scope + actions + workflow-state powers + field powers + approvals + overrides + prohibited actions + audit requirements`.

## 2. Current code facts that must be preserved

The current code already contains:

- Role union and labels: `src/lib/types.ts`
- Session and `requireRole(...)`: `src/lib/auth.ts`
- Permission tables and defaults: `src/lib/permissions.ts`
- Entity scoping helper: `src/lib/entity-access.ts`
- Role-specific workspaces routed from: `src/app/[...slug]/page.tsx`
- Permission models: `Permission`, `RolePermission` in `prisma/schema.prisma`
- Existing workflow domains: demands, tickets, changes, problems, handovers, SLA, knowledge, communications, governance decisions, notifications, audits.

Do not delete these. Consolidate and strengthen them.

## 3. Mandatory authorization decision

Every protected request MUST pass all five checks:

```text
ALLOW = authenticated
    AND permission_granted
    AND record_in_scope
    AND action_allowed_in_current_state
    AND protected_fields_not_modified
```

Default result is `DENY`.

## 4. Required implementation architecture

Create or consolidate the following concepts:

```ts
type Resource = 'demand' | 'ticket' | 'change' | 'problem' | 'service' |
  'service_offering' | 'sla' | 'sla_report' | 'knowledge' |
  'communication' | 'governance_decision' | 'audit' | 'user_assignment';

type Action = 'read' | 'create' | 'update' | 'assign' | 'approve' | 'reject' |
  'accept' | 'resolve' | 'close' | 'reopen' | 'publish' | 'retire' |
  'escalate' | 'override' | 'export' | 'manage';

type Scope = 'SELF' | 'OWN_ORG' | 'ASSIGNED' | 'ASSIGNED_CUSTOMERS' |
  'MANAGED_TEAM' | 'OWNED_SERVICES' | 'TENANT';
```

Introduce one server-side authorization entry point, for example:

```ts
authorize(session, {
  resource,
  action,
  recordId,
  requestedChanges,
  workflowState,
})
```

The exact filename may follow the codebase convention, but all APIs MUST call the same policy layer. Do not leave new direct checks such as `session.role === ...` inside route handlers except inside the central policy implementation.

## 5. Role hierarchy rule

The roles are **not** a simple power ladder:

- `CM_LEADER` does not automatically own services.
- `SERVICE_OWNER` does not automatically manage agents or edit every case.
- `SCM_WORKER` cannot approve its own commercial/governance work.
- `SERVICE_CUSTOMER` cannot access internal notes, internal audit, cost internals, or other organizations.

## 6. Cross-role maker-checker controls

- Quote creator cannot approve the same quote.
- SLA report preparer cannot approve the same report.
- Change requester/planner cannot be sole approver for a normal or emergency change.
- Service Owner can approve a service commitment only for a service they own.
- CM Leader can override worker actions only with a mandatory reason.
- No role may approve, reject, close, or override through a generic update endpoint.

## 7. Implementation order

1. Inventory every API route and UI action by resource/action.
2. Replace route-level role lists with permission keys.
3. Expand `DEFAULT_PERMISSIONS` and seed data.
4. Strengthen record scoping in `entity-access.ts` or its replacement.
5. Add workflow transition policy per resource.
6. Add protected-field policy.
7. Apply role-aware navigation and action buttons from the same permission source.
8. Add authorization audit events for sensitive allow/deny/override decisions.
9. Add automated tests from each role document.
10. Run negative tests before declaring completion.

## 8. Completion gate

The upgrade is NOT complete if any of the following remains:

- A route grants access only because the URL belongs to a role workspace.
- A broad `read.all` permission bypasses record scope.
- Service Owner can see unrelated tenant records.
- SCM Worker can approve its own quote/report/change.
- Customer can view internal comments, internal audit, internal costs, or other customers.
- CM Leader can edit service ownership without explicit service-governance authority.
- Frontend and backend disagree on available actions.
- Denied-action tests are missing.


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
