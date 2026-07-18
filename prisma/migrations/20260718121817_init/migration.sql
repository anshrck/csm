-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "orgNodeId" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#0d9488',
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrgNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "slaClass" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "customerValue" TEXT,
    "commodityType" TEXT,
    "supportLevels" TEXT,
    "serviceOwnerId" TEXT NOT NULL,
    "technicalOwnerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "fulfillmentDays" INTEGER NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceOffering_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "slaClass" TEXT NOT NULL,
    "availabilityTarget" REAL NOT NULL,
    "p1ResponseMins" INTEGER NOT NULL,
    "p1ResolutionMins" INTEGER NOT NULL,
    "p2ResponseMins" INTEGER NOT NULL,
    "p2ResolutionMins" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlaProfile_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgNodeId" TEXT NOT NULL,
    "serviceOfferingId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "validUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entitlement_serviceOfferingId_fkey" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Demand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "businessJustification" TEXT,
    "desiredTimeline" TEXT,
    "relatedServiceIds" TEXT NOT NULL,
    "serviceCustomerId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "assignedScmWorkerId" TEXT,
    "status" TEXT NOT NULL,
    "estimatedEffortDays" REAL,
    "estimatedCost" REAL,
    "quoteNotes" TEXT,
    "quoteApprovedByCmLeader" BOOLEAN NOT NULL DEFAULT false,
    "quoteApprovedAt" DATETIME,
    "commitmentNotes" TEXT,
    "rejectionReason" TEXT,
    "redirectedToOfferingId" TEXT,
    "changeRequestId" TEXT,
    "quotedAt" DATETIME,
    "acceptedAt" DATETIME,
    "handedToCeAt" DATETIME,
    "fulfilledAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Demand_serviceCustomerId_fkey" FOREIGN KEY ("serviceCustomerId") REFERENCES "OrgNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Demand_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Demand_assignedScmWorkerId_fkey" FOREIGN KEY ("assignedScmWorkerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandEvent_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemandEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "serviceCustomerId" TEXT,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "SlaEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Change" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "complexity" TEXT,
    "originType" TEXT NOT NULL,
    "originDemandId" TEXT,
    "originProblemId" TEXT,
    "affectedServiceIds" TEXT NOT NULL,
    "implementationPlan" TEXT,
    "technicalOwnerTasksJson" TEXT NOT NULL,
    "assignedCeWorkerId" TEXT,
    "assignedCeLeaderId" TEXT,
    "rejectionReason" TEXT,
    "verificationNotes" TEXT,
    "catalogUpdatedAt" DATETIME,
    "isEmergencyPostReviewDue" BOOLEAN NOT NULL DEFAULT false,
    "postImplementationReview" TEXT,
    "approvalNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Change_assignedCeWorkerId_fkey" FOREIGN KEY ("assignedCeWorkerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_originDemandId_fkey" FOREIGN KEY ("originDemandId") REFERENCES "Demand" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessHandover" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "sourceDemandId" TEXT,
    "sourceProblemId" TEXT,
    "targetChangeId" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessHandover_sourceDemandId_fkey" FOREIGN KEY ("sourceDemandId") REFERENCES "Demand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProcessHandover_targetChangeId_fkey" FOREIGN KEY ("targetChangeId") REFERENCES "Change" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decision" TEXT,
    "rootCauseDescription" TEXT,
    "impactAssessment" TEXT,
    "decisionRationale" TEXT,
    "workaroundDescription" TEXT,
    "knownErrorId" TEXT,
    "assignedPmWorkerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Problem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityRef" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "serviceIds" TEXT NOT NULL,
    "serviceCustomerIds" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "reviewedByCmLeaderId" TEXT,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "reviewNotes" TEXT,
    "approvedAt" DATETIME,
    "issuedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT,
    "serviceId" TEXT,
    "serviceCustomerId" TEXT,
    "slaEventId" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GovernanceDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "demandId" TEXT,
    "slaEventId" TEXT,
    "problemId" TEXT,
    "decisionType" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "resourcesAuthorized" TEXT,
    "followUpOwner" TEXT,
    "followUpDate" DATETIME,
    "decidedById" TEXT NOT NULL,
    "decidedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DemandService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    CONSTRAINT "DemandService_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemandService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    CONSTRAINT "ChangeService_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaReportService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slaReportId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    CONSTRAINT "SlaReportService_slaReportId_fkey" FOREIGN KEY ("slaReportId") REFERENCES "SlaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlaReportService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaReportCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slaReportId" TEXT NOT NULL,
    "orgNodeId" TEXT NOT NULL,
    CONSTRAINT "SlaReportCustomer_slaReportId_fkey" FOREIGN KEY ("slaReportId") REFERENCES "SlaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlaReportCustomer_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicalOwnerTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "chapter" TEXT,
    "ciScope" TEXT,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "serviceId" TEXT,
    CONSTRAINT "TechnicalOwnerTask_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicalOwnerTask_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "impact" TEXT,
    "urgency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "serviceId" TEXT,
    "serviceCustomerId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "assignmentGroupId" TEXT,
    "resolutionCode" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    CONSTRAINT "Ticket_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_serviceCustomerId_fkey" FOREIGN KEY ("serviceCustomerId") REFERENCES "OrgNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_assignmentGroupId_fkey" FOREIGN KEY ("assignmentGroupId") REFERENCES "AssignmentGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "serviceId" TEXT,
    "ticketType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "responseMins" INTEGER NOT NULL,
    "resolutionMins" INTEGER NOT NULL,
    "businessCalendarId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlaPolicy_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SlaPolicy_businessCalendarId_fkey" FOREIGN KEY ("businessCalendarId") REFERENCES "BusinessCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlaClock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "pausedAt" DATETIME,
    "totalPausedMins" INTEGER NOT NULL DEFAULT 0,
    "metAt" DATETIME,
    "breachedAt" DATETIME,
    CONSTRAINT "SlaClock_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlaClock_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rulesJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "serviceCustomerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    CONSTRAINT "Comment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SatisfactionSurvey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SatisfactionSurvey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "serviceId" TEXT,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "KnowledgeArticle_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeArticle_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Service_domain_idx" ON "Service"("domain");

-- CreateIndex
CREATE INDEX "Service_slaClass_idx" ON "Service"("slaClass");

-- CreateIndex
CREATE INDEX "Service_status_idx" ON "Service"("status");

-- CreateIndex
CREATE INDEX "ServiceOffering_serviceId_idx" ON "ServiceOffering"("serviceId");

-- CreateIndex
CREATE INDEX "SlaProfile_serviceId_idx" ON "SlaProfile"("serviceId");

-- CreateIndex
CREATE INDEX "Entitlement_orgNodeId_idx" ON "Entitlement"("orgNodeId");

-- CreateIndex
CREATE INDEX "Demand_status_idx" ON "Demand"("status");

-- CreateIndex
CREATE INDEX "Demand_serviceCustomerId_idx" ON "Demand"("serviceCustomerId");

-- CreateIndex
CREATE INDEX "Demand_assignedScmWorkerId_idx" ON "Demand"("assignedScmWorkerId");

-- CreateIndex
CREATE INDEX "DemandEvent_demandId_idx" ON "DemandEvent"("demandId");

-- CreateIndex
CREATE INDEX "SlaEvent_serviceId_idx" ON "SlaEvent"("serviceId");

-- CreateIndex
CREATE INDEX "SlaEvent_eventType_idx" ON "SlaEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "Change_originDemandId_key" ON "Change"("originDemandId");

-- CreateIndex
CREATE INDEX "Change_status_idx" ON "Change"("status");

-- CreateIndex
CREATE INDEX "Change_originDemandId_idx" ON "Change"("originDemandId");

-- CreateIndex
CREATE INDEX "ProcessHandover_type_idx" ON "ProcessHandover"("type");

-- CreateIndex
CREATE INDEX "Problem_status_idx" ON "Problem"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_read_idx" ON "Notification"("read");

-- CreateIndex
CREATE INDEX "SlaReport_status_idx" ON "SlaReport"("status");

-- CreateIndex
CREATE INDEX "SlaReport_preparedById_idx" ON "SlaReport"("preparedById");

-- CreateIndex
CREATE INDEX "Communication_demandId_idx" ON "Communication"("demandId");

-- CreateIndex
CREATE INDEX "Communication_serviceCustomerId_idx" ON "Communication"("serviceCustomerId");

-- CreateIndex
CREATE INDEX "GovernanceDecision_serviceId_idx" ON "GovernanceDecision"("serviceId");

-- CreateIndex
CREATE INDEX "GovernanceDecision_demandId_idx" ON "GovernanceDecision"("demandId");

-- CreateIndex
CREATE INDEX "GovernanceDecision_decisionType_idx" ON "GovernanceDecision"("decisionType");

-- CreateIndex
CREATE INDEX "DemandService_serviceId_idx" ON "DemandService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DemandService_demandId_serviceId_key" ON "DemandService"("demandId", "serviceId");

-- CreateIndex
CREATE INDEX "ChangeService_serviceId_idx" ON "ChangeService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeService_changeId_serviceId_key" ON "ChangeService"("changeId", "serviceId");

-- CreateIndex
CREATE INDEX "SlaReportService_serviceId_idx" ON "SlaReportService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaReportService_slaReportId_serviceId_key" ON "SlaReportService"("slaReportId", "serviceId");

-- CreateIndex
CREATE INDEX "SlaReportCustomer_orgNodeId_idx" ON "SlaReportCustomer"("orgNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaReportCustomer_slaReportId_orgNodeId_key" ON "SlaReportCustomer"("slaReportId", "orgNodeId");

-- CreateIndex
CREATE INDEX "TechnicalOwnerTask_changeId_idx" ON "TechnicalOwnerTask"("changeId");

-- CreateIndex
CREATE INDEX "TechnicalOwnerTask_assigneeId_idx" ON "TechnicalOwnerTask"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_serviceCustomerId_idx" ON "Ticket"("serviceCustomerId");

-- CreateIndex
CREATE INDEX "Ticket_assignedUserId_idx" ON "Ticket"("assignedUserId");

-- CreateIndex
CREATE INDEX "Ticket_priority_idx" ON "Ticket"("priority");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_idx" ON "TicketEvent"("ticketId");

-- CreateIndex
CREATE INDEX "SlaPolicy_serviceId_idx" ON "SlaPolicy"("serviceId");

-- CreateIndex
CREATE INDEX "SlaPolicy_priority_idx" ON "SlaPolicy"("priority");

-- CreateIndex
CREATE INDEX "SlaClock_ticketId_idx" ON "SlaClock"("ticketId");

-- CreateIndex
CREATE INDEX "SlaClock_status_idx" ON "SlaClock"("status");

-- CreateIndex
CREATE INDEX "Conversation_entityType_entityId_idx" ON "Conversation"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Comment_conversationId_idx" ON "Comment"("conversationId");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "SatisfactionSurvey_entityType_entityId_idx" ON "SatisfactionSurvey"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurvey_entityType_entityId_customerId_key" ON "SatisfactionSurvey"("entityType", "entityId", "customerId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_status_idx" ON "KnowledgeArticle"("status");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_type_idx" ON "KnowledgeArticle"("type");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_serviceId_idx" ON "KnowledgeArticle"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");
