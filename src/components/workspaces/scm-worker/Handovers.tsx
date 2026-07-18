'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  PageHeader,
  DataTable,
  ChangeStatusBadge,
  EmptyState,
  LoadingState,
  Card,
  CardContent,
  Badge,
  type Column,
  FormattedDate,
  RelativeTime,
} from '@/components/shared';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowLeftRight, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import type { ProcessHandover, Demand, Change, HandoverType } from '@/lib/types';

const HANDOVER_TYPE_LABELS: Record<HandoverType, string> = {
  CM_TO_CE: 'CM → CE',
  PM_TO_CE: 'PM → CE',
  PM_TO_SD_KE: 'PM → SD/KE',
  SD_TO_CE_STD: 'SD → CE (Standard)',
};

export default function Handovers() {
  const [unackOnly, setUnackOnly] = React.useState(false);

  const { data: handovers, isLoading } = useQuery<ProcessHandover[]>({
    queryKey: ['handovers', 'CM_TO_CE'],
    queryFn: () => apiGet('/api/handovers?type=CM_TO_CE'),
  });

  const { data: myDemands } = useQuery<Demand[]>({
    queryKey: ['demands', 'assigned', 'me'],
    queryFn: () => apiGet('/api/demands?assigned=me'),
  });

  const { data: allDemands } = useQuery<Demand[]>({
    queryKey: ['demands', 'all'],
    queryFn: () => apiGet('/api/demands'),
  });

  const { data: changes } = useQuery<Change[]>({
    queryKey: ['changes', 'all'],
    queryFn: () => apiGet('/api/changes'),
  });

  const demandMap = React.useMemo(() => {
    const m = new Map<string, Demand>();
    // Prefer all demands for lookup completeness, fall back to my demands.
    const allList = allDemands ?? [];
    const myList = myDemands ?? [];
    const list = allList.length > 0 ? allList : myList;
    list.forEach((d) => m.set(d.id, d));
    return m;
  }, [allDemands, myDemands]);

  const changeMap = React.useMemo(() => {
    const m = new Map<string, Change>();
    (changes ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [changes]);

  // Scope to handovers whose source demand is assigned to me, fall back to all CM_TO_CE
  const scoped = React.useMemo(() => {
    const all = handovers ?? [];
    if ((myDemands ?? []).length === 0) return all;
    const myIds = new Set((myDemands ?? []).map((d) => d.id));
    const mine = all.filter((h) => h.sourceDemandId && myIds.has(h.sourceDemandId));
    return mine.length > 0 ? mine : all;
  }, [handovers, myDemands]);

  const filtered = React.useMemo(() => {
    if (!unackOnly) return scoped;
    return scoped.filter((h) => !h.acknowledgedAt);
  }, [scoped, unackOnly]);

  const columns: Column<ProcessHandover>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (h) => (
        <Badge variant="outline" className="text-xs gap-1">
          <ArrowLeftRight className="h-3 w-3" />
          {HANDOVER_TYPE_LABELS[h.type as HandoverType] ?? h.type}
        </Badge>
      ),
    },
    {
      key: 'demand',
      header: 'Source Demand',
      render: (h) =>
        h.sourceDemandId && demandMap.get(h.sourceDemandId) ? (
          <div className="min-w-0">
            <p className="text-sm font-medium truncate max-w-[26ch]">{demandMap.get(h.sourceDemandId)!.title}</p>
            <p className="text-xs text-muted-foreground">{demandMap.get(h.sourceDemandId)!.serviceCustomerName ?? '—'}</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'change',
      header: 'Target Change',
      render: (h) =>
        h.targetChangeId && changeMap.get(h.targetChangeId) ? (
          <div className="min-w-0 flex items-center gap-2">
            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate max-w-[26ch]">{changeMap.get(h.targetChangeId)!.title}</p>
              <div className="mt-0.5">
                <ChangeStatusBadge status={changeMap.get(h.targetChangeId)!.status} className="text-[10px]" />
              </div>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No change linked</span>
        ),
    },
    {
      key: 'ack',
      header: 'Acknowledged',
      render: (h) =>
        h.acknowledgedAt ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div className="text-xs">
              <div className="font-medium text-emerald-700 dark:text-emerald-300">Yes</div>
              <div className="text-muted-foreground">
                <FormattedDate date={h.acknowledgedAt} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <div className="text-xs">
              <div className="font-medium text-amber-700 dark:text-amber-300">Pending</div>
              <div className="text-muted-foreground">Awaiting CE</div>
            </div>
          </div>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (h) => <RelativeTime date={h.createdAt} className="text-sm text-muted-foreground" />,
    },
  ];

  const pendingCount = scoped.filter((h) => !h.acknowledgedAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Handovers"
        description="CM → CE handovers you created when handing accepted demands to Change Enablement."
        icon={<ArrowLeftRight className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex items-center gap-2 px-1">
            <Switch id="unack-switch" checked={unackOnly} onCheckedChange={setUnackOnly} />
            <Label htmlFor="unack-switch" className="text-sm cursor-pointer">
              Unacknowledged only
            </Label>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{pendingCount}</span> pending acknowledgement
            </span>
            <span>·</span>
            <span>{filtered.length} shown</span>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState rows={5} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<ArrowLeftRight className="h-8 w-8" />}
              title={unackOnly ? 'No pending handovers' : 'No handovers yet'}
              description={
                unackOnly
                  ? 'All your handovers have been acknowledged by CE.'
                  : 'When you hand an accepted demand to Change Enablement, the handover will appear here.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}
    </div>
  );
}
