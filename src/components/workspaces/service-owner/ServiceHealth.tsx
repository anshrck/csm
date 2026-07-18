'use client';

/**
 * ServiceHealth — Service Owner's portfolio health command center.
 *
 * Surfaces a dense, filterable DataTable of every owned service with its
 * current health, SLA class, availability target, open incidents, breach /
 * warning counts, problem / known-error counts, high-risk change count,
 * CSAT, catalog-reviewed date, and a derived 0-100 risk score.
 *
 * Row click → navigate('service-detail', { id: service.id }).
 *
 * Data sources:
 *   - GET /api/service-owner/service-health   → health + risk + review date
 *   - GET /api/services?owner=me              → service meta (domain, status,
 *                                                slaProfile.availabilityTarget)
 *
 * Filters: service, health (green/amber/red), domain, SLA class, status.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Activity, Briefcase, Filter, RotateCcw } from 'lucide-react';

import { useApp } from '@/lib/store';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DataTable,
  SlaClassBadge,
  FormattedDate,
  type Column,
} from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  SERVICE_DOMAIN_LABELS,
  SERVICE_LAYER_LABELS,
  type Service,
  type ServiceDomain,
  type ServiceStatus,
  type SlaClass,
  type SlaHealth,
} from '@/lib/types';

import {
  useOwnerServices,
  useServiceHealthSummary,
} from './_hooks';
import { ServiceHealthBadge } from './_components/ServiceHealthBadge';
import { RiskScoreBadge } from './_components/RiskScoreBadge';

// Augment ServiceHealthSummary with lifecycleStage which the API returns but
// the foundation type omits.
interface HealthRow {
  id: string;
  serviceId: string;
  serviceName: string;
  slaClass: string;
  health: SlaHealth;
  openIncidents: number;
  p1p2Count: number;
  breachedClocks: number;
  warnings: number;
  problems: number;
  knownErrors: number;
  highRiskChanges: number;
  csat: number | null;
  riskScore: number;
  lastReviewedAt: string | null;
  // joined from /api/services?owner=me
  domain?: ServiceDomain;
  status?: ServiceStatus;
  layer?: string;
  availabilityTarget?: number | null;
}

const HEALTH_OPTIONS: { value: SlaHealth; label: string }[] = [
  { value: 'green', label: 'Healthy' },
  { value: 'amber', label: 'At risk' },
  { value: 'red', label: 'Breached' },
];

const SLA_CLASS_OPTIONS: SlaClass[] = ['A', 'B', 'C', 'D'];
const DOMAIN_OPTIONS = Object.keys(SERVICE_DOMAIN_LABELS) as ServiceDomain[];
const STATUS_OPTIONS: ServiceStatus[] = ['ACTIVE', 'PLANNED', 'RETIRED'];

export default function ServiceHealth() {
  const { navigate } = useApp();

  const servicesQ = useOwnerServices();
  const healthQ = useServiceHealthSummary();

  // ---- filters ----
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<SlaHealth | 'all'>('all');
  const [domainFilter, setDomainFilter] = useState<ServiceDomain | 'all'>('all');
  const [slaClassFilter, setSlaClassFilter] = useState<SlaClass | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ServiceStatus | 'all'>('all');

  // ---- join health + service meta ----
  const rows: HealthRow[] = useMemo(() => {
    const health = healthQ.data ?? [];
    const services = servicesQ.data ?? [];
    const svcById = new Map<string, Service>(services.map((s) => [s.id, s]));
    return health.map((h) => {
      const svc = svcById.get(h.serviceId);
      return {
        id: h.serviceId,
        serviceId: h.serviceId,
        serviceName: h.serviceName,
        slaClass: h.slaClass,
        health: h.health,
        openIncidents: h.openIncidents,
        p1p2Count: h.p1p2Count,
        breachedClocks: h.breachedClocks,
        warnings: h.warnings,
        problems: h.problems,
        knownErrors: h.knownErrors,
        highRiskChanges: h.highRiskChanges,
        csat: h.csat,
        riskScore: h.riskScore,
        lastReviewedAt: h.lastReviewedAt,
        domain: svc?.domain,
        status: svc?.status,
        layer: svc?.layer,
        availabilityTarget: svc?.slaProfile?.availabilityTarget ?? null,
      };
    });
  }, [healthQ.data, servicesQ.data]);

  // ---- filtered rows ----
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (serviceFilter !== 'all' && r.serviceId !== serviceFilter) return false;
      if (healthFilter !== 'all' && r.health !== healthFilter) return false;
      if (domainFilter !== 'all' && r.domain !== domainFilter) return false;
      if (slaClassFilter !== 'all' && r.slaClass !== slaClassFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, serviceFilter, healthFilter, domainFilter, slaClassFilter, statusFilter]);

  // ---- KPI strip ----
  const kpis = useMemo(() => {
    const red = rows.filter((r) => r.health === 'red').length;
    const amber = rows.filter((r) => r.health === 'amber').length;
    const green = rows.filter((r) => r.health === 'green').length;
    const breaches = rows.reduce((sum, r) => sum + r.breachedClocks, 0);
    const incidents = rows.reduce((sum, r) => sum + r.openIncidents, 0);
    const p1p2 = rows.reduce((sum, r) => sum + r.p1p2Count, 0);
    return { red, amber, green, breaches, incidents, p1p2 };
  }, [rows]);

  const hasFilters =
    serviceFilter !== 'all' ||
    healthFilter !== 'all' ||
    domainFilter !== 'all' ||
    slaClassFilter !== 'all' ||
    statusFilter !== 'all';

  const resetFilters = () => {
    setServiceFilter('all');
    setHealthFilter('all');
    setDomainFilter('all');
    setSlaClassFilter('all');
    setStatusFilter('all');
  };

  // ---- columns ----
  const columns: Column<HealthRow>[] = useMemo(
    () => [
      {
        key: 'service',
        header: 'Service',
        render: (r) => (
          <div className="min-w-0 max-w-[240px]">
            <div className="font-medium text-sm truncate">{r.serviceName}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
              {r.domain && <span>{SERVICE_DOMAIN_LABELS[r.domain]}</span>}
              {r.layer && (
                <>
                  <span>·</span>
                  <span>{SERVICE_LAYER_LABELS[r.layer as keyof typeof SERVICE_LAYER_LABELS]}</span>
                </>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'slaClass',
        header: 'SLA Class',
        render: (r) => <SlaClassBadge slaClass={r.slaClass as SlaClass} />,
        headerClassName: 'w-24',
        className: 'w-24',
      },
      {
        key: 'availability',
        header: 'Avail. target',
        render: (r) => (
          <span className="text-xs tabular-nums">
            {r.availabilityTarget != null ? `${r.availabilityTarget}%` : '—'}
          </span>
        ),
        headerClassName: 'w-24',
        className: 'w-24',
      },
      {
        key: 'health',
        header: 'Health',
        render: (r) => <ServiceHealthBadge health={r.health} />,
        headerClassName: 'w-28',
        className: 'w-28',
      },
      {
        key: 'incidents',
        header: 'Open inc.',
        render: (r) => (
          <span
            className={
              r.openIncidents > 0
                ? 'text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.openIncidents}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'p1p2',
        header: 'P1/P2',
        render: (r) => (
          <span
            className={
              r.p1p2Count > 0
                ? 'text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.p1p2Count}
          </span>
        ),
        headerClassName: 'w-16 text-right',
        className: 'w-16 text-right',
      },
      {
        key: 'breaches',
        header: 'Breaches',
        render: (r) => (
          <span
            className={
              r.breachedClocks > 0
                ? 'text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.breachedClocks}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'warnings',
        header: 'Warnings',
        render: (r) => (
          <span
            className={
              r.warnings > 0
                ? 'text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.warnings}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'problems',
        header: 'Problems',
        render: (r) => (
          <span
            className={
              r.problems > 0
                ? 'text-sm tabular-nums text-foreground'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.problems}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'knownErrors',
        header: 'Known err.',
        render: (r) => (
          <span
            className={
              r.knownErrors > 0
                ? 'text-sm tabular-nums text-orange-700 dark:text-orange-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.knownErrors}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'highRiskChanges',
        header: 'Hi-risk chg',
        render: (r) => (
          <span
            className={
              r.highRiskChanges > 0
                ? 'text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300'
                : 'text-sm tabular-nums text-muted-foreground'
            }
          >
            {r.highRiskChanges}
          </span>
        ),
        headerClassName: 'w-20 text-right',
        className: 'w-20 text-right',
      },
      {
        key: 'csat',
        header: 'CSAT',
        render: (r) => (
          <span className="text-sm tabular-nums">
            {r.csat != null ? r.csat.toFixed(1) : '—'}
          </span>
        ),
        headerClassName: 'w-16 text-right',
        className: 'w-16 text-right',
      },
      {
        key: 'reviewed',
        header: 'Catalog rev.',
        render: (r) =>
          r.lastReviewedAt ? (
            <FormattedDate date={r.lastReviewedAt} className="text-xs text-muted-foreground" />
          ) : (
            <span className="text-xs text-muted-foreground italic">never</span>
          ),
        headerClassName: 'w-28',
        className: 'w-28',
      },
      {
        key: 'risk',
        header: 'Risk',
        render: (r) => <RiskScoreBadge score={r.riskScore} />,
        headerClassName: 'w-16 text-right',
        className: 'w-16 text-right',
      },
    ],
    [],
  );

  const loading = healthQ.isLoading || servicesQ.isLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Health"
        description="Portfolio health command center — every service you own, with live SLA, incident, problem, and risk posture. Click a row to drill into service detail."
        icon={<Activity className="h-5 w-5" />}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Healthy"
          value={kpis.green}
          icon={<Activity className="h-4 w-4" />}
          tone="success"
          hint="Services within SLA target"
        />
        <StatCard
          label="At risk"
          value={kpis.amber}
          icon={<Activity className="h-4 w-4" />}
          tone="warning"
          hint="Active SLA warnings"
        />
        <StatCard
          label="Breached"
          value={kpis.red}
          icon={<Activity className="h-4 w-4" />}
          tone="danger"
          hint="Active SLA breaches"
        />
        <StatCard
          label="Open incidents"
          value={kpis.incidents}
          icon={<Activity className="h-4 w-4" />}
          hint={`${kpis.p1p2} P1/P2 open`}
        />
        <StatCard
          label="SLA breaches"
          value={kpis.breaches}
          icon={<Activity className="h-4 w-4" />}
          tone={kpis.breaches > 0 ? 'danger' : 'success'}
          hint="Across all owned services"
        />
        <StatCard
          label="Portfolio size"
          value={rows.length}
          icon={<Briefcase className="h-4 w-4" />}
          hint="Services under your ownership"
        />
      </div>

      <SectionCard
        title="Service health matrix"
        description="Derived from live SLA clocks, open incidents, problem records, and risk posture. Risk score = breaches×30 + P1/P2×15 + high-risk×10 + known errors×5 (capped at 100)."
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {servicesQ.data?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={healthFilter}
            onValueChange={(v) => setHealthFilter(v as SlaHealth | 'all')}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Health" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All health</SelectItem>
              {HEALTH_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={domainFilter}
            onValueChange={(v) => setDomainFilter(v as ServiceDomain | 'all')}
          >
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="Domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All domains</SelectItem>
              {DOMAIN_OPTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {SERVICE_DOMAIN_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={slaClassFilter}
            onValueChange={(v) => setSlaClassFilter(v as SlaClass | 'all')}
          >
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="SLA class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {SLA_CLASS_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  Class {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as ServiceStatus | 'all')}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 text-xs"
              onClick={resetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>

        {loading ? (
          <LoadingState rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-10 w-10 text-muted-foreground/50" />}
            title={hasFilters ? 'No services match your filters' : 'No services in your portfolio'}
            description={
              hasFilters
                ? 'Adjust the filters above to widen your search.'
                : 'Services where you are the assigned owner will appear here with live health metrics.'
            }
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Showing {filtered.length} of {rows.length} service
              {rows.length === 1 ? '' : 's'}
            </p>
            <DataTable
              columns={columns}
              rows={filtered}
              onRowClick={(r) => navigate('service-detail', { id: r.serviceId })}
              empty="No services found."
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}
