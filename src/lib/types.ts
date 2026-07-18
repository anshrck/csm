// Shared TypeScript types for CereBree uSMS

export type Role = 'SERVICE_CUSTOMER' | 'SCM_WORKER' | 'CM_LEADER' | 'SERVICE_OWNER';

export const ROLE_LABELS: Record<Role, string> = {
  SERVICE_CUSTOMER: 'Service Customer',
  SCM_WORKER: 'SCM Worker',
  CM_LEADER: 'CM Leader',
  SERVICE_OWNER: 'Service Owner',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SERVICE_CUSTOMER: 'Strategic front-office — submit demands and govern SLA commitments for your organizational unit.',
  SCM_WORKER: 'Service Customer Manager — own the demand lifecycle and customer communication thread.',
  CM_LEADER: 'Customer Management Leader — hold governance gates: quote approval, rejection authorization, SLA review.',
  SERVICE_OWNER: 'Owner layer — structural accountability for service value, quality and SLA commitments.',
};

export type DemandStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'QUOTED'
  | 'ACCEPTED'
  | 'IN_CHANGE'
  | 'FULFILLED'
  | 'CLOSED'
  | 'REJECTED'
  | 'REDIRECTED';

export const DEMAND_STATUS_LABELS: Record<DemandStatus, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under Review',
  QUOTED: 'Quoted',
  ACCEPTED: 'Accepted',
  IN_CHANGE: 'In Change',
  FULFILLED: 'Fulfilled',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  REDIRECTED: 'Redirected',
};

export const DEMAND_PIPELINE: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
  'FULFILLED',
];

export type ServiceDomain = 'INTERACTION' | 'SUPPORT' | 'DELIVERY' | 'MANAGEMENT';
export type ServiceLayer = 'BUSINESS' | 'APPLICATION' | 'PLATFORM' | 'INFRASTRUCTURE';
export type SlaClass = 'A' | 'B' | 'C' | 'D';
export type ServiceStatus = 'ACTIVE' | 'RETIRED' | 'PLANNED';

export const SERVICE_DOMAIN_LABELS: Record<ServiceDomain, string> = {
  INTERACTION: 'Interaction',
  SUPPORT: 'Support',
  DELIVERY: 'Delivery',
  MANAGEMENT: 'Management',
};

export const SERVICE_LAYER_LABELS: Record<ServiceLayer, string> = {
  BUSINESS: 'Business',
  APPLICATION: 'Application',
  PLATFORM: 'Platform',
  INFRASTRUCTURE: 'Infrastructure',
};

export const SLA_CLASS_LABELS: Record<SlaClass, string> = {
  A: 'Class A — Mission Critical',
  B: 'Class B — Business Critical',
  C: 'Class C — Standard',
  D: 'Class D — Best Effort',
};

export type SlaHealth = 'green' | 'amber' | 'red';

export type ChangeType = 'STANDARD' | 'NORMAL' | 'EMERGENCY';
export type ChangeStatus =
  | 'REQUESTED'
  | 'ASSESSMENT'
  | 'PLANNING'
  | 'APPROVED'
  | 'IMPLEMENTATION'
  | 'VERIFICATION'
  | 'CLOSED'
  | 'REJECTED';
export type ChangeComplexity = 'SIMPLE' | 'MEDIUM' | 'COMPLEX';
export type ChangeOrigin = 'DEMAND' | 'PROBLEM' | 'STANDARD';

export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  REQUESTED: 'Requested',
  ASSESSMENT: 'Assessment',
  PLANNING: 'Planning',
  APPROVED: 'Approved',
  IMPLEMENTATION: 'Implementation',
  VERIFICATION: 'Verification',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

export type HandoverType = 'CM_TO_CE' | 'PM_TO_CE' | 'PM_TO_SD_KE' | 'SD_TO_CE_STD';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgNodeId: string | null;
  orgNodeName: string | null;
  avatarColor: string;
  title: string | null;
}

export interface OrgNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  domain: ServiceDomain;
  chapter: string;
  layer: ServiceLayer;
  slaClass: SlaClass;
  status: ServiceStatus;
  customerValue: string | null;
  commodityType: string | null;
  supportLevels: string | null;
  serviceOwnerId: string;
  technicalOwnerId: string | null;
  serviceOwnerName?: string;
  technicalOwnerName?: string;
  offerings?: ServiceOffering[];
  slaProfile?: SlaProfile | null;
  createdAt: string;
}

export interface ServiceOffering {
  id: string;
  serviceId: string;
  name: string;
  description: string;
  requestType: string;
  fulfillmentDays: number;
  active: boolean;
  serviceName?: string;
}

export interface SlaProfile {
  id: string;
  serviceId: string;
  slaClass: SlaClass;
  availabilityTarget: number;
  p1ResponseMins: number;
  p1ResolutionMins: number;
  p2ResponseMins: number;
  p2ResolutionMins: number;
}

export interface Demand {
  id: string;
  title: string;
  description: string;
  businessJustification: string | null;
  desiredTimeline: string | null;
  relatedServiceIds: string[];
  serviceCustomerId: string;
  serviceCustomerName?: string;
  submittedById: string;
  submittedByName?: string;
  assignedScmWorkerId: string | null;
  assignedScmWorkerName?: string;
  status: DemandStatus;
  estimatedEffortDays: number | null;
  estimatedCost: number | null;
  quoteNotes: string | null;
  quoteApprovedByCmLeader: boolean;
  quoteApprovedAt: string | null;
  commitmentNotes: string | null;
  rejectionReason: string | null;
  redirectedToOfferingId: string | null;
  changeRequestId: string | null;
  quotedAt: string | null;
  acceptedAt: string | null;
  handedToCeAt: string | null;
  fulfilledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events?: DemandEvent[];
  change?: Change | null;
}

export interface DemandEvent {
  id: string;
  demandId: string;
  eventType: string;
  actorId: string | null;
  actorName: string;
  notes: string | null;
  createdAt: string;
}

export interface SlaEvent {
  id: string;
  serviceId: string;
  serviceName?: string;
  serviceCustomerId: string | null;
  eventType: 'WARNING' | 'BREACHED' | 'CLOSED_IN_TIME';
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Change {
  id: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  complexity: ChangeComplexity | null;
  originType: ChangeOrigin;
  originDemandId: string | null;
  originProblemId: string | null;
  affectedServiceIds: string[];
  implementationPlan: string | null;
  technicalOwnerTasksJson: any[];
  assignedCeWorkerId: string | null;
  assignedCeWorkerName?: string;
  rejectionReason: string | null;
  verificationNotes: string | null;
  catalogUpdatedAt: string | null;
  isEmergencyPostReviewDue: boolean;
  postImplementationReview: string | null;
  approvalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  services?: Service[];
}

export interface ProcessHandover {
  id: string;
  type: HandoverType;
  sourceDemandId: string | null;
  sourceProblemId: string | null;
  targetChangeId: string | null;
  acknowledgedById: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  entityRef: string | null;
  read: boolean;
  createdAt: string;
}

export interface Problem {
  id: string;
  title: string;
  serviceId: string;
  serviceName?: string;
  status: string;
  decision: string | null;
  rootCauseDescription: string | null;
  impactAssessment: string | null;
  decisionRationale: string | null;
  workaroundDescription: string | null;
  knownErrorId: string | null;
  assignedPmWorkerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalDemands: number;
  byStatus: Record<string, number>;
  slaWarnings: number;
  slaBreaches: number;
  pendingApprovals: number;
  openChanges: number;
}
