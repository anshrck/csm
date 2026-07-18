'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { Service, SlaEvent, Problem, Change, Demand } from '@/lib/types';

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
