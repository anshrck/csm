import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';

async function main() {
  console.log('Seeding CereBree uSMS…');

  // ---- Org nodes ----
  const financeOrg = await db.orgNode.create({ data: { name: 'Finance Division', type: 'CUSTOMER_ORG' } });
  const hrOrg = await db.orgNode.create({ data: { name: 'HR Department', type: 'CUSTOMER_ORG' } });
  const opsOrg = await db.orgNode.create({ data: { name: 'Operations Unit', type: 'CUSTOMER_ORG' } });
  const internalIt = await db.orgNode.create({ data: { name: 'IT Organization', type: 'INTERNAL' } });

  // ---- Users (one per role + extras) ----
  const pwd = hashPassword('demo1234');
  const customer = await db.user.create({
    data: { email: 'customer@cerebree.io', name: 'Elena Vance', passwordHash: pwd, role: 'SERVICE_CUSTOMER', orgNodeId: financeOrg.id, avatarColor: '#0d9488', title: 'VP Finance Operations' },
  });
  const customer2 = await db.user.create({
    data: { email: 'customer2@cerebree.io', name: 'Marcus Lindholm', passwordHash: pwd, role: 'SERVICE_CUSTOMER', orgNodeId: hrOrg.id, avatarColor: '#0891b2', title: 'HR Director' },
  });
  const scmWorker = await db.user.create({
    data: { email: 'scm@cerebree.io', name: 'Priya Anand', passwordHash: pwd, role: 'SCM_WORKER', orgNodeId: internalIt.id, avatarColor: '#d97706', title: 'Service Customer Manager' },
  });
  const scmWorker2 = await db.user.create({
    data: { email: 'scm2@cerebree.io', name: 'Tomas Berg', passwordHash: pwd, role: 'SCM_WORKER', orgNodeId: internalIt.id, avatarColor: '#7c3aed', title: 'Service Customer Manager' },
  });
  const cmLeader = await db.user.create({
    data: { email: 'cmleader@cerebree.io', name: 'Sofia Reyes', passwordHash: pwd, role: 'CM_LEADER', orgNodeId: internalIt.id, avatarColor: '#be123c', title: 'Customer Management Leader' },
  });
  const serviceOwner = await db.user.create({
    data: { email: 'owner@cerebree.io', name: 'Dr. Henrik Sørensen', passwordHash: pwd, role: 'SERVICE_OWNER', orgNodeId: internalIt.id, avatarColor: '#15803d', title: 'Service Owner — Core Platform' },
  });
  const serviceOwner2 = await db.user.create({
    data: { email: 'owner2@cerebree.io', name: 'Amara Okafor', passwordHash: pwd, role: 'SERVICE_OWNER', orgNodeId: internalIt.id, avatarColor: '#b45309', title: 'Service Owner — Collaboration' },
  });

  // ---- Services ----
  const svcErp = await db.service.create({
    data: {
      name: 'Enterprise Resource Planning (ERP)',
      description: 'Core financial and supply-chain ERP suite. The system of record for all organisational accounting, procurement, and asset management.',
      domain: 'DELIVERY', chapter: 'ENTERPRISE_APPS', layer: 'APPLICATION', slaClass: 'A', status: 'ACTIVE',
      customerValue: 'Single source of truth for financial operations and statutory reporting.', commodityType: 'STRATEGIC',
      supportLevels: 'L1 SD · L2 App Support · L3 Vendor', serviceOwnerId: serviceOwner.id,
    },
  });
  const svcIdentity = await db.service.create({
    data: {
      name: 'Identity & Access Management',
      description: 'Centralised authentication, single sign-on, and privileged access governance across the application portfolio.',
      domain: 'MANAGEMENT', chapter: 'IDENTITY_ACCESS', layer: 'PLATFORM', slaClass: 'A', status: 'ACTIVE',
      customerValue: 'Secure, governed access to every business system.', commodityType: 'STRATEGIC',
      supportLevels: 'L1 SD · L2 IAM Ops · L3 Vendor', serviceOwnerId: serviceOwner.id,
    },
  });
  const svcCollab = await db.service.create({
    data: {
      name: 'Collaboration & Email',
      description: 'Email, calendaring, instant messaging, and document collaboration workspace for all employees.',
      domain: 'INTERACTION', chapter: 'COLLABORATION', layer: 'APPLICATION', slaClass: 'B', status: 'ACTIVE',
      customerValue: 'Day-to-day communication and teamwork productivity.', commodityType: 'DIFFERENTIATED',
      supportLevels: 'L1 SD · L2 Vendor', serviceOwnerId: serviceOwner2.id,
    },
  });
  const svcEndpoint = await db.service.create({
    data: {
      name: 'Endpoint Management',
      description: 'Managed laptops and desktops including patching, encryption, and remote support capability.',
      domain: 'SUPPORT', chapter: 'END_USER_COMPUTE', layer: 'PLATFORM', slaClass: 'B', status: 'ACTIVE',
      customerValue: 'Reliable, secure, and supported employee devices.', commodityType: 'UTILITY',
      supportLevels: 'L1 SD · L2 Field', serviceOwnerId: serviceOwner2.id,
    },
  });
  const svcBackup = await db.service.create({
    data: {
      name: 'Backup & Recovery',
      description: 'Scheduled backup, long-term retention, and tested restore capability for business-critical systems.',
      domain: 'MANAGEMENT', chapter: 'DATA_PROTECTION', layer: 'INFRASTRUCTURE', slaClass: 'B', status: 'ACTIVE',
      customerValue: 'Resilience against data loss with governed recovery objectives.', commodityType: 'UTILITY',
      supportLevels: 'L2 Infra · L3 Vendor', serviceOwnerId: serviceOwner.id,
    },
  });
  const svcReporting = await db.service.create({
    data: {
      name: 'Business Intelligence Portal',
      description: 'Self-service analytics dashboards and scheduled reporting over enterprise data warehouse sources.',
      domain: 'DELIVERY', chapter: 'ANALYTICS', layer: 'APPLICATION', slaClass: 'C', status: 'ACTIVE',
      customerValue: 'Data-driven decisions through governed self-service reporting.', commodityType: 'DIFFERENTIATED',
      supportLevels: 'L1 SD · L2 BI', serviceOwnerId: serviceOwner2.id,
    },
  });

  // ---- SLA profiles ----
  const slaA = (sid: string) => db.slaProfile.create({ data: { serviceId: sid, slaClass: 'A', availabilityTarget: 99.9, p1ResponseMins: 15, p1ResolutionMins: 120, p2ResponseMins: 60, p2ResolutionMins: 480 } });
  const slaB = (sid: string) => db.slaProfile.create({ data: { serviceId: sid, slaClass: 'B', availabilityTarget: 99.5, p1ResponseMins: 30, p1ResolutionMins: 240, p2ResponseMins: 120, p2ResolutionMins: 720 } });
  const slaC = (sid: string) => db.slaProfile.create({ data: { serviceId: sid, slaClass: 'C', availabilityTarget: 99.0, p1ResponseMins: 60, p1ResolutionMins: 480, p2ResponseMins: 240, p2ResolutionMins: 1440 } });
  await slaA(svcErp.id); await slaA(svcIdentity.id); await slaB(svcCollab.id); await slaB(svcEndpoint.id); await slaB(svcBackup.id); await slaC(svcReporting.id);

  // ---- Offerings ----
  await db.serviceOffering.create({ data: { serviceId: svcErp.id, name: 'New ERP Module Request', description: 'Request a new functional module or extension to the ERP suite.', requestType: 'DEMAND', fulfillmentDays: 30 } });
  await db.serviceOffering.create({ data: { serviceId: svcErp.id, name: 'ERP Access Provisioning', description: 'Role-based access to ERP transactions and reports.', requestType: 'ACCESS', fulfillmentDays: 3 } });
  await db.serviceOffering.create({ data: { serviceId: svcIdentity.id, name: 'Application SSO Onboarding', description: 'Integrate a new application with the central SSO platform.', requestType: 'DEMAND', fulfillmentDays: 21 } });
  await db.serviceOffering.create({ data: { serviceId: svcIdentity.id, name: 'Privileged Access Request', description: 'Request elevated/privileged access to a governed system.', requestType: 'ACCESS', fulfillmentDays: 2 } });
  await db.serviceOffering.create({ data: { serviceId: svcCollab.id, name: 'Distribution List Creation', description: 'Create a new email distribution list or shared mailbox.', requestType: 'SERVICE_REQUEST', fulfillmentDays: 1 } });
  await db.serviceOffering.create({ data: { serviceId: svcCollab.id, name: 'Collaboration Team Site', description: 'Provision a new team collaboration workspace.', requestType: 'SERVICE_REQUEST', fulfillmentDays: 3 } });
  await db.serviceOffering.create({ data: { serviceId: svcEndpoint.id, name: 'Standard Laptop Build', description: 'Provision a managed laptop with standard image.', requestType: 'SERVICE_REQUEST', fulfillmentDays: 5 } });
  await db.serviceOffering.create({ data: { serviceId: svcReporting.id, name: 'New Dashboard Request', description: 'Request a new BI dashboard or report.', requestType: 'DEMAND', fulfillmentDays: 15 } });

  // ---- Entitlements ----
  for (const s of [svcErp, svcIdentity, svcCollab, svcEndpoint, svcBackup, svcReporting]) {
    const off = await db.serviceOffering.findMany({ where: { serviceId: s.id } });
    for (const o of off) {
      await db.entitlement.create({ data: { orgNodeId: financeOrg.id, serviceOfferingId: o.id, scope: 'DIRECT' } });
      await db.entitlement.create({ data: { orgNodeId: hrOrg.id, serviceOfferingId: o.id, scope: 'DIRECT' } });
    }
  }

  // ---- Demands (various statuses) ----
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86400000);
  const future = (n: number) => new Date(now + n * 86400000);

  // 1. NEW — just submitted by Finance customer
  const d1 = await db.demand.create({
    data: {
      title: 'Procurement self-service portal module',
      description: 'We need a new self-service procurement module in ERP so department heads can raise and approve purchase requisitions without emailing the finance team. Expected to cut requisition cycle time by 60%.',
      businessJustification: 'Current email-based process creates 3-5 day delays and audit gaps. Self-service portal aligns with the quarterly efficiency mandate.',
      desiredTimeline: 'Before Q3 budget cycle',
      relatedServiceIds: JSON.stringify([svcErp.id]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, status: 'NEW', createdAt: days(1),
    },
  });
  await db.demandEvent.create({ data: { demandId: d1.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, notes: 'Demand submitted by Service Customer.', createdAt: days(1) } });

  // 2. UNDER_REVIEW — assigned to SCM worker
  const d2 = await db.demand.create({
    data: {
      title: 'SSO integration for new HR analytics tool',
      description: 'Integrate the newly procured HR analytics platform with our central SSO so employees use corporate credentials. The vendor supports SAML 2.0.',
      businessJustification: 'Avoid shadow identity accounts and enforce MFA on HR data access.',
      desiredTimeline: 'Within 6 weeks of go-live',
      relatedServiceIds: JSON.stringify([svcIdentity.id]),
      serviceCustomerId: hrOrg.id, submittedById: customer2.id, assignedScmWorkerId: scmWorker.id, status: 'UNDER_REVIEW', createdAt: days(3),
    },
  });
  await db.demandEvent.create({ data: { demandId: d2.id, eventType: 'CREATED', actorId: customer2.id, actorName: customer2.name, createdAt: days(3) } });
  await db.demandEvent.create({ data: { demandId: d2.id, eventType: 'REVIEW_STARTED', actorId: scmWorker.id, actorName: scmWorker.name, notes: 'Assigned to SCM Worker. Catalog check in progress.', createdAt: days(2) } });

  // 3. QUOTED — awaiting customer acceptance, CM Leader approved the quote
  const d3 = await db.demand.create({
    data: {
      title: 'Additional ERP reporting cube for tax compliance',
      description: 'A dedicated reporting cube aggregating transactional data for automated tax-jurisdiction reporting required by new regulation effective next fiscal year.',
      businessJustification: 'Regulatory compliance — penalties for non-compliance estimated at significant exposure.',
      desiredTimeline: 'Before new fiscal year',
      relatedServiceIds: JSON.stringify([svcErp.id, svcReporting.id]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, assignedScmWorkerId: scmWorker.id, status: 'QUOTED',
      estimatedEffortDays: 18, estimatedCost: 42000, quoteNotes: 'Effort covers data-model design (6d), ETL build (7d), validation with Tax team (3d), and UAT (2d). Proposed SLA class B for the new cube. Separate change will be raised in CE.',
      quoteApprovedByCmLeader: true, quoteApprovedAt: days(1), quotedAt: days(1), createdAt: days(6),
    },
  });
  await db.demandEvent.create({ data: { demandId: d3.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, createdAt: days(6) } });
  await db.demandEvent.create({ data: { demandId: d3.id, eventType: 'REVIEW_STARTED', actorId: scmWorker.id, actorName: scmWorker.name, createdAt: days(5) } });
  await db.demandEvent.create({ data: { demandId: d3.id, eventType: 'QUOTE_APPROVED', actorId: cmLeader.id, actorName: cmLeader.name, notes: 'CM Leader approved quote — scope, feasibility and SLA class verified.', createdAt: days(2) } });
  await db.demandEvent.create({ data: { demandId: d3.id, eventType: 'QUOTED', actorId: scmWorker.id, actorName: scmWorker.name, notes: 'Quote issued to Service Customer.', createdAt: days(1) } });
  await db.notification.create({ data: { userId: customer.id, type: 'DemandQuoted', title: 'Quote ready for review', message: `"${d3.title}" has been quoted. Please review and accept or decline.`, entityRef: `demand:${d3.id}`, createdAt: days(1) } });

  // 4. ACCEPTED — customer accepted, SCM must create change + hand to CE
  const d4 = await db.demand.create({
    data: {
      title: 'Privileged access review workflow automation',
      description: 'Automate the quarterly privileged access recertification workflow with manager attestation and auto-revocation on expiry.',
      businessJustification: 'Audit finding — manual recertification is error-prone and misses revocation SLAs.',
      desiredTimeline: 'Next quarter',
      relatedServiceIds: JSON.stringify([svcIdentity.id]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, assignedScmWorkerId: scmWorker2.id, status: 'ACCEPTED',
      estimatedEffortDays: 12, estimatedCost: 28000, quoteNotes: 'Workflow build on existing IAM platform. No new licensing required.',
      quoteApprovedByCmLeader: true, quoteApprovedAt: days(4), quotedAt: days(4), acceptedAt: days(2), commitmentNotes: 'Commitment: Class B SLA on the workflow service. Delivery within 6 weeks of change approval.', createdAt: days(10),
    },
  });
  await db.demandEvent.create({ data: { demandId: d4.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, createdAt: days(10) } });
  await db.demandEvent.create({ data: { demandId: d4.id, eventType: 'QUOTED', actorId: scmWorker2.id, actorName: scmWorker2.name, createdAt: days(6) } });
  await db.demandEvent.create({ data: { demandId: d4.id, eventType: 'ACCEPTED', actorId: customer.id, actorName: customer.name, notes: 'Service Customer accepted the quote.', createdAt: days(2) } });
  await db.notification.create({ data: { userId: scmWorker2.id, type: 'DemandAccepted', title: 'Quote accepted', message: `Customer accepted quote for "${d4.title}". Create a Change Request and hand to CE.`, entityRef: `demand:${d4.id}`, createdAt: days(2) } });

  // 5. IN_CHANGE — handed to CE, change in implementation
  const chg5 = await db.change.create({
    data: {
      title: 'Implement automated privileged access recertification',
      type: 'NORMAL', status: 'IMPLEMENTATION', complexity: 'MEDIUM', originType: 'DEMAND', originDemandId: d4.id,
      affectedServiceIds: JSON.stringify([svcIdentity.id]),
      implementationPlan: '1. Configure attestation campaign (2d)\n2. Build auto-revocation rules (3d)\n3. Integration test with IAM (2d)\n4. UAT with Security team (2d)\n5. Cutover (1d)\nRollback: disable campaign, revert to manual process.',
      technicalOwnerTasksJson: JSON.stringify([
        { owner: 'Dr. Henrik Sørensen', chapter: 'IDENTITY_ACCESS', task: 'Configure attestation campaign template', status: 'DONE' },
        { owner: 'Dr. Henrik Sørensen', chapter: 'IDENTITY_ACCESS', task: 'Build auto-revocation rules', status: 'IN_PROGRESS' },
        { owner: 'Amara Okafor', chapter: 'COLLABORATION', task: 'Notify managers of pending attestations', status: 'PENDING' },
      ]),
      assignedCeWorkerId: scmWorker.id, assignedCeLeaderId: cmLeader.id, approvalNotes: 'Approved by CE Leader — standard medium-complexity change.',
      createdAt: days(8), updatedAt: days(1),
    },
  });
  await db.demand.update({ where: { id: d4.id }, data: { status: 'IN_CHANGE', changeRequestId: chg5.id, handedToCeAt: days(2) } });
  await db.demandEvent.create({ data: { demandId: d4.id, eventType: 'HANDED_TO_CE', actorId: scmWorker2.id, actorName: scmWorker2.name, notes: 'Change Request created and handed to Change Enablement.', createdAt: days(2) } });
  await db.processHandover.create({ data: { type: 'CM_TO_CE', sourceDemandId: d4.id, targetChangeId: chg5.id, createdAt: days(2), acknowledgedAt: days(2), acknowledgedById: scmWorker.id } });

  // 6. FULFILLED — change closed, demand fulfilled (awaiting customer close)
  const d6 = await db.demand.create({
    data: {
      title: 'Collaboration workspace for Finance transformation program',
      description: 'A dedicated team site for the Finance transformation program — document repository, meeting notes, and RACI tracking.',
      businessJustification: 'Program team is distributed across 3 locations — needs a single collaboration hub.',
      relatedServiceIds: JSON.stringify([svcCollab.id]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, assignedScmWorkerId: scmWorker.id, status: 'FULFILLED',
      estimatedEffortDays: 3, estimatedCost: 2500, quoteNotes: 'Standard team site provisioning.',
      quoteApprovedByCmLeader: true, quoteApprovedAt: days(14), quotedAt: days(14), acceptedAt: days(13), handedToCeAt: days(12), fulfilledAt: days(3), createdAt: days(20),
    },
  });
  const chg6 = await db.change.create({
    data: {
      title: 'Provision collaboration team site for Finance transformation program',
      type: 'NORMAL', status: 'CLOSED', complexity: 'SIMPLE', originType: 'DEMAND', originDemandId: d6.id,
      affectedServiceIds: JSON.stringify([svcCollab.id]),
      implementationPlan: 'Provision team site with standard template. No custom dev.',
      technicalOwnerTasksJson: JSON.stringify([{ owner: 'Amara Okafor', chapter: 'COLLABORATION', task: 'Provision team site', status: 'DONE' }]),
      verificationNotes: 'Site provisioned and verified. Owner access confirmed.', catalogUpdatedAt: days(3),
      createdAt: days(12), closedAt: days(3), updatedAt: days(3),
    },
  });
  await db.demand.update({ where: { id: d6.id }, data: { changeRequestId: chg6.id } });
  await db.demandEvent.create({ data: { demandId: d6.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, createdAt: days(20) } });
  await db.demandEvent.create({ data: { demandId: d6.id, eventType: 'FULFILLED', actorId: scmWorker.id, actorName: scmWorker.name, notes: 'Change closed by CE. Demand marked fulfilled — awaiting customer closure.', createdAt: days(3) } });
  await db.notification.create({ data: { userId: customer.id, type: 'DemandFulfilled', title: 'Demand fulfilled', message: `"${d6.title}" has been fulfilled. Please review and close.`, entityRef: `demand:${d6.id}`, createdAt: days(3) } });

  // 7. REJECTED — SCM rejected (authorized by CM leader)
  const d7 = await db.demand.create({
    data: {
      title: 'Personal cloud storage accounts for Finance team',
      description: 'Provide individual Dropbox Business accounts for the Finance team to share large files externally.',
      businessJustification: 'Easier external file sharing.',
      relatedServiceIds: JSON.stringify([]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, assignedScmWorkerId: scmWorker2.id, status: 'REJECTED',
      rejectionReason: 'Out of scope — the organisation standard for external file sharing is the governed Collaboration & Email service with external sharing enabled. Personal cloud accounts bypass DLP controls and are not permitted under the data governance policy.',
      createdAt: days(9),
    },
  });
  await db.demandEvent.create({ data: { demandId: d7.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, createdAt: days(9) } });
  await db.demandEvent.create({ data: { demandId: d7.id, eventType: 'REJECTED', actorId: cmLeader.id, actorName: cmLeader.name, notes: 'Rejection authorized by CM Leader. Redirect to Collaboration & Email external sharing offering.', createdAt: days(8) } });
  await db.notification.create({ data: { userId: customer.id, type: 'DemandRejected', title: 'Demand rejected', message: `"${d7.title}" was rejected. See the demand record for the reason and redirect guidance.`, entityRef: `demand:${d7.id}`, createdAt: days(8) } });

  // 8. CLOSED — completed lifecycle
  const d8 = await db.demand.create({
    data: {
      title: 'BI dashboard for monthly close cycle',
      description: 'A dashboard tracking the monthly financial close cycle status across entities.',
      relatedServiceIds: JSON.stringify([svcReporting.id]),
      serviceCustomerId: financeOrg.id, submittedById: customer.id, assignedScmWorkerId: scmWorker.id, status: 'CLOSED',
      estimatedEffortDays: 8, estimatedCost: 12000, quoteNotes: 'Standard BI dashboard build on existing warehouse.',
      quoteApprovedByCmLeader: true, quoteApprovedAt: days(40), quotedAt: days(40), acceptedAt: days(38), handedToCeAt: days(35), fulfilledAt: days(25), closedAt: days(24), commitmentNotes: 'Delivered Class C SLA. Dashboard live and adopted.', createdAt: days(45),
    },
  });
  await db.demandEvent.create({ data: { demandId: d8.id, eventType: 'CREATED', actorId: customer.id, actorName: customer.name, createdAt: days(45) } });
  await db.demandEvent.create({ data: { demandId: d8.id, eventType: 'CLOSED', actorId: customer.id, actorName: customer.name, notes: 'Demand closed by Service Customer after successful adoption.', createdAt: days(24) } });

  // ---- SLA events ----
  await db.slaEvent.create({ data: { serviceId: svcErp.id, serviceCustomerId: financeOrg.id, eventType: 'WARNING', message: 'P1 response time at 70% threshold on incident INC-1042.', createdAt: days(2) } });
  await db.slaEvent.create({ data: { serviceId: svcIdentity.id, serviceCustomerId: financeOrg.id, eventType: 'BREACHED', message: 'P1 resolution SLA breached on incident INC-1031. Root cause under PM investigation.', createdAt: days(4) } });
  await db.slaEvent.create({ data: { serviceId: svcIdentity.id, serviceCustomerId: hrOrg.id, eventType: 'WARNING', message: 'Availability dipped to 99.3% (target 99.9%) over rolling 7 days.', createdAt: days(1) } });
  await db.slaEvent.create({ data: { serviceId: svcCollab.id, serviceCustomerId: financeOrg.id, eventType: 'CLOSED_IN_TIME', message: 'P2 incident INC-1019 resolved within target.', createdAt: days(6) } });
  await db.slaEvent.create({ data: { serviceId: svcBackup.id, serviceCustomerId: financeOrg.id, eventType: 'BREACHED', message: 'Backup verification job exceeded RTO on nightly run.', createdAt: days(3) } });
  await db.slaEvent.create({ data: { serviceId: svcCollab.id, serviceCustomerId: hrOrg.id, eventType: 'CLOSED_IN_TIME', message: 'All P2 incidents closed within target this period.', createdAt: days(5) } });

  // ---- Notifications for CM Leader & Service Owner ----
  await db.notification.create({ data: { userId: cmLeader.id, type: 'DemandCreated', title: 'New demand requires assignment', message: `"${d1.title}" is unassigned.`, entityRef: `demand:${d1.id}`, createdAt: days(1) } });
  await db.notification.create({ data: { userId: cmLeader.id, type: 'SlaBreached', title: 'SLA breach — Identity & Access', message: 'P1 resolution SLA breached on IAM for Finance Division. Escalation required.', entityRef: `sla:${svcIdentity.id}`, createdAt: days(4) } });
  await db.notification.create({ data: { userId: serviceOwner.id, type: 'SlaBreached', title: 'SLA breach on your service', message: 'Identity & Access Management — P1 resolution breach. Governance response required.', entityRef: `sla:${svcIdentity.id}`, createdAt: days(4) } });
  await db.notification.create({ data: { userId: serviceOwner.id, type: 'SlaWarning', title: 'SLA warning on your service', message: 'ERP — P1 response time at 70% threshold.', entityRef: `sla:${svcErp.id}`, createdAt: days(2) } });
  await db.notification.create({ data: { userId: scmWorker.id, type: 'DemandAccepted', title: 'Quote accepted — create change', message: `Customer accepted "${d4.title}".`, entityRef: `demand:${d4.id}`, createdAt: days(2) } });

  // ---- A problem record for service owner view ----
  await db.problem.create({
    data: {
      title: 'Recurring SSO timeout under peak morning load',
      serviceId: svcIdentity.id, status: 'UNDER_INVESTIGATION',
      rootCauseDescription: 'Preliminary: token refresh storm between 08:45–09:15 exceeds IdP thread pool.',
      assignedPmWorkerId: scmWorker.id, createdAt: days(5), updatedAt: days(1),
    },
  });

  console.log('Seed complete.');
  console.log('Demo accounts (password: demo1234):');
  console.log('  customer@cerebree.io  — Service Customer');
  console.log('  scm@cerebree.io       — SCM Worker');
  console.log('  cmleader@cerebree.io  — CM Leader');
  console.log('  owner@cerebree.io     — Service Owner');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
