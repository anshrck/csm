'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type {
  Service,
  SlaEvent,
  Problem,
  Change,
  Demand,
  ServiceHealthSummary,
  CustomerImpactSummary,
  OwnerRiskItem,
} from '@/lib/types';
import type { Ticket, SlaClockRow } from '@/lib/tickets';

/**
 * Service Owner data hooks — centralises fetching for the workspace so
 * every screen shares the same cache keys and client-side filtering logic.
 *
 * The Service Owner's "scope" is the set of services where
 * serviceOwnerId === session.user.id. Other agents' API routes support
 * `?owner=me` for services and problems; SLA events, changes, and demands
 * are fetched broadly and filtered client-side against `myServiceIds`.
 */

export function useOwnerServices() {
  return useQuery<Service[]>({
    queryKey: ['owner-services'],
    queryFn: () => apiGet<Service[]>('/api/services?owner=me'),
    staleTime: 30_000,
  });
}

export function useSlaEvents() {
  return useQuery<SlaEvent[]>({
    queryKey: ['sla-events-all'],
    queryFn: () => apiGet<SlaEvent[]>('/api/sla-events'),
    staleTime: 30_000,
  });
}

export function useOwnerProblems() {
  return useQuery<Problem[]>({
    queryKey: ['owner-problems'],
    queryFn: () => apiGet<Problem[]>('/api/problems?owner=me'),
    staleTime: 30_000,
  });
}

export function useAllChanges() {
  return useQuery<Change[]>({
    queryKey: ['changes-all'],
    queryFn: () => apiGet<Change[]>('/api/changes'),
    staleTime: 30_000,
  });
}

/** Demands in ACCEPTED status — Service Owner approves service commitments here. */
export function useAcceptedDemands() {
  return useQuery<Demand[]>({
    queryKey: ['demands-accepted'],
    queryFn: () => apiGet<Demand[]>('/api/demands?status=ACCEPTED'),
    staleTime: 30_000,
  });
}

export function useDemand(id: string | undefined) {
  return useQuery<Demand>({
    queryKey: ['demand', id],
    queryFn: () => apiGet<Demand>(`/api/demands/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/* -------------------------- Derived helpers -------------------------- */

export type SlaHealth = 'green' | 'amber' | 'red';

/** Determine health from a list of SLA events for a single service. */
export function deriveHealth(events: SlaEvent[]): SlaHealth {
  const open = events.filter((e) => !e.resolvedAt);
  if (open.some((e) => e.eventType === 'BREACHED')) return 'red';
  if (open.some((e) => e.eventType === 'WARNING')) return 'amber';
  return 'green';
}

/** Compliance % for a service: closed-in-time / total events (0-100). */
export function serviceCompliance(events: SlaEvent[]): number {
  if (events.length === 0) return 100;
  const breaches = events.filter((e) => e.eventType === 'BREACHED').length;
  const inTime = events.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
  const denom = breaches + inTime;
  if (denom === 0) return 100;
  return Math.round((inTime / denom) * 100);
}

/** Synthesise a 6-month trend of compliance % per service-class. */
export function synthesiseTrend(events: SlaEvent[]): { label: string; value: number }[] {
  const months: { label: string; value: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString(undefined, { month: 'short' });
    const inMonth = events.filter((e) => {
      const ed = new Date(e.createdAt);
      return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear();
    });
    const breaches = inMonth.filter((e) => e.eventType === 'BREACHED').length;
    const inTime = inMonth.filter((e) => e.eventType === 'CLOSED_IN_TIME').length;
    const denom = breaches + inTime;
    const value = denom === 0 ? 100 : Math.round((inTime / denom) * 100);
    months.push({ label, value });
  }
  return months;
}

/* =================================================================== */
/* Phase: Service Owner Enterprise — extended hooks                     */
/* =================================================================== */

/** Service Owner owned-service id set (memo-friendly key). */
export function useOwnerServiceIds() {
  const q = useOwnerServices();
  const ids = (q.data ?? []).map((s) => s.id);
  return {
    ...q,
    data: ids,
    idSet: new Set(ids),
  };
}

/** Tickets on owned services (server enforces the SERVICE_OWNER scope). */
export function useOwnerTickets(params?: {
  status?: string;
  priority?: string;
  type?: string;
  serviceId?: string;
  q?: string;
  overdue?: boolean;
  breachingSoon?: boolean;
  sort?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.priority) qs.set('priority', params.priority);
  if (params?.type) qs.set('type', params.type);
  if (params?.serviceId) qs.set('serviceId', params.serviceId);
  if (params?.q) qs.set('q', params.q);
  if (params?.overdue) qs.set('overdue', '1');
  if (params?.breachingSoon) qs.set('breachingSoon', '1');
  qs.set('sort', params?.sort ?? 'recent');
  qs.set('limit', String(params?.limit ?? 500));
  const queryStr = qs.toString();
  return useQuery<Ticket[]>({
    queryKey: ['owner-tickets', queryStr],
    queryFn: () => apiGet<Ticket[]>(`/api/tickets?${queryStr}`),
    staleTime: 15_000,
  });
}

/** SLA clocks on tickets of owned services. Pass serviceId or ticketId to narrow. */
export function useOwnerSlaClocks(params?: {
  ticketId?: string;
  serviceId?: string;
  status?: string;
  type?: string;
  overdue?: boolean;
  atRisk?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.ticketId) qs.set('ticketId', params.ticketId);
  if (params?.serviceId) qs.set('serviceId', params.serviceId);
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  if (params?.overdue) qs.set('overdue', '1');
  if (params?.atRisk) qs.set('atRisk', '1');
  const queryStr = qs.toString();
  return useQuery<SlaClockRow[]>({
    queryKey: ['owner-sla-clocks', queryStr],
    queryFn: () => apiGet<SlaClockRow[]>(`/api/sla-clocks?${queryStr}`),
    staleTime: 15_000,
  });
}

/** Service Health summary — derived health metrics per owned service. */
export function useServiceHealthSummary() {
  return useQuery<ServiceHealthSummary[]>({
    queryKey: ['service-owner', 'service-health'],
    queryFn: () => apiGet<ServiceHealthSummary[]>('/api/service-owner/service-health'),
    staleTime: 30_000,
  });
}

/** Customer Impact summary — per-customer rollup across owned services. */
export function useCustomerImpactSummary() {
  return useQuery<CustomerImpactSummary[]>({
    queryKey: ['service-owner', 'customer-impact'],
    queryFn: () => apiGet<CustomerImpactSummary[]>('/api/service-owner/customer-impact'),
    staleTime: 30_000,
  });
}

/** Risk register — derived + persisted risks for owned services. */
export function useOwnerRiskRegister(params?: {
  serviceId?: string;
  severity?: string;
  status?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.serviceId) qs.set('serviceId', params.serviceId);
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.status) qs.set('status', params.status);
  const queryStr = qs.toString();
  return useQuery<OwnerRiskItem[]>({
    queryKey: ['service-owner', 'risk-register', queryStr],
    queryFn: () =>
      apiGet<OwnerRiskItem[]>(`/api/service-owner/risk-register?${queryStr}`),
    staleTime: 30_000,
  });
}

/** Single service detail with SLA event counts + offerings + slaProfile. */
export function useServiceDetail(id: string | undefined) {
  return useQuery<ServiceDetailDto>({
    queryKey: ['service-detail', id],
    queryFn: () => apiGet<ServiceDetailDto>(`/api/services/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Service detail DTO — extends Service with review/lifecycle + SLA event rollup. */
export interface ServiceDetailDto extends Service {
  lastReviewedAt?: string | null;
  lifecycleStage?: string | null;
  slaEventCount?: number;
  slaEventsByType?: {
    WARNING: number;
    BREACHED: number;
    CLOSED_IN_TIME: number;
  };
}

/** Tickets scoped to a single service. */
export function useServiceTickets(serviceId: string | undefined) {
  return useQuery<Ticket[]>({
    queryKey: ['service-tickets', serviceId],
    queryFn: () =>
      apiGet<Ticket[]>(`/api/tickets?serviceId=${serviceId}&limit=500`),
    enabled: !!serviceId,
    staleTime: 15_000,
  });
}

/** Problems scoped to a single service. */
export function useServiceProblems(serviceId: string | undefined) {
  return useQuery<Problem[]>({
    queryKey: ['service-problems', serviceId],
    queryFn: () => apiGet<Problem[]>(`/api/problems?serviceId=${serviceId}`),
    enabled: !!serviceId,
    staleTime: 30_000,
  });
}

/** Knowledge articles scoped to a single service. */
export function useServiceKnowledge(serviceId: string | undefined) {
  return useQuery<KnowledgeArticleSummary[]>({
    queryKey: ['service-knowledge', serviceId],
    queryFn: () =>
      apiGet<KnowledgeArticleSummary[]>(
        `/api/knowledge?serviceId=${serviceId}&summary=1`,
      ),
    enabled: !!serviceId,
    staleTime: 60_000,
  });
}

export interface KnowledgeArticleSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  serviceName?: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

/** Audit logs scoped to an entity (Service, Ticket, etc.). */
export function useEntityAuditLogs(
  entityType: string,
  entityId: string | undefined,
  limit = 50,
) {
  return useQuery<AuditLogRow[]>({
    queryKey: ['entity-audit-logs', entityType, entityId, limit],
    queryFn: () =>
      apiGet<AuditLogRow[]>(
        `/api/audit-logs?entityType=${entityType}&entityId=${entityId}&limit=${limit}`,
      ),
    enabled: !!entityId,
    staleTime: 30_000,
  });
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Governance decisions for a given service + decision type. */
export function useGovernanceDecisions(params: {
  serviceId?: string;
  decisionType?: string;
  slaEventId?: string;
}) {
  const qs = new URLSearchParams();
  if (params.serviceId) qs.set('serviceId', params.serviceId);
  if (params.decisionType) qs.set('decisionType', params.decisionType);
  const queryStr = qs.toString();
  return useQuery<GovernanceDecisionRow[]>({
    queryKey: ['governance-decisions', queryStr],
    queryFn: () =>
      apiGet<GovernanceDecisionRow[]>(`/api/governance-decisions?${queryStr}`),
    staleTime: 30_000,
  });
}

export interface GovernanceDecisionRow {
  id: string;
  serviceId: string;
  demandId: string | null;
  slaEventId: string | null;
  problemId: string | null;
  decisionType: string;
  decision: string;
  rationale: string;
  resourcesAuthorized: string | null;
  followUpOwner: string | null;
  followUpDate: string | null;
  decidedById: string;
  decidedByName: string;
  createdAt: string;
}

/** SLA events scoped to a single service (filters the broad list client-side). */
export function useServiceSlaEvents(serviceId: string | undefined) {
  const q = useSlaEvents();
  const data = (q.data ?? []).filter((e) => e.serviceId === serviceId);
  return { ...q, data };
}

/** Changes affecting a single service (filters the broad list client-side). */
export function useServiceChanges(serviceId: string | undefined) {
  const q = useAllChanges();
  const data = (q.data ?? []).filter((c) =>
    serviceId ? c.affectedServiceIds.includes(serviceId) : false,
  );
  return { ...q, data };
}
