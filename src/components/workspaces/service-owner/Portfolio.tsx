'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { Service, ServiceOffering, SlaProfile, SlaEvent, Change } from '@/lib/types';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  SlaHealthBadge,
  RelativeTime,
  FormattedDate,
  KeyValue,
  DataTable,
  Badge,
  type Column,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Briefcase,
  ClipboardCheck,
  Clock,
  Gauge,
  History,
  Package,
  RefreshCw,
} from 'lucide-react';
import {
  useOwnerServices,
  useSlaEvents,
  useAllChanges,
  deriveHealth,
} from './_hooks';
import { SERVICE_DOMAIN_LABELS, SERVICE_LAYER_LABELS } from '@/lib/types';

export default function Portfolio() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const servicesQ = useOwnerServices();
  const slaQ = useSlaEvents();
  const changesQ = useAllChanges();

  const services = servicesQ.data ?? [];
  const myServiceIds = useMemo(() => new Set(services.map((s) => s.id)), [services]);
  const slaEvents = slaQ.data ?? [];
  const changes = changesQ.data ?? [];

  const lastEventFor = (serviceId: string) =>
    slaEvents
      .filter((e) => e.serviceId === serviceId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

  const columns: Column<Service>[] = [
    {
      key: 'name',
      header: 'Service',
      render: (s) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{s.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {SERVICE_DOMAIN_LABELS[s.domain]} · {s.chapter}
          </div>
        </div>
      ),
    },
    {
      key: 'layer',
      header: 'Layer',
      render: (s) => <span className="text-sm">{SERVICE_LAYER_LABELS[s.layer]}</span>,
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
    },
    {
      key: 'slaClass',
      header: 'SLA Class',
      render: (s) => <SlaClassBadge slaClass={s.slaClass} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge
          variant="outline"
          className={
            s.status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
              : s.status === 'PLANNED'
                ? 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300'
                : 'bg-muted text-muted-foreground'
          }
        >
          {s.status}
        </Badge>
      ),
    },
    {
      key: 'health',
      header: 'Current Health',
      render: (s) => {
        const sEvents = slaEvents.filter((e) => e.serviceId === s.id);
        return <SlaHealthBadge health={deriveHealth(sEvents)} />;
      },
    },
    {
      key: 'lastEvent',
      header: 'Last SLA Event',
      render: (s) => {
        const ev = lastEventFor(s.id);
        if (!ev) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="text-xs">
            <div className="font-medium">{ev.eventType.replace(/_/g, ' ')}</div>
            <div className="text-muted-foreground">
              <RelativeTime date={ev.createdAt} />
            </div>
          </div>
        );
      },
      className: 'hidden lg:table-cell',
      headerClassName: 'hidden lg:table-cell',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Portfolio"
        description="Every service in your ownership has a current, accurate catalog entry. Review service metadata, SLA profile, offerings, and recent activity."
        icon={<Briefcase className="h-6 w-6" />}
      />

      {/* Catalog accuracy banner */}
      <SectionCard
        title="Catalog Accuracy Obligation"
        description="The catalog entry your customers see must reflect the live service. Verify metadata, support levels, and SLA targets remain accurate."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {services.slice(0, 4).map((s) => {
            const stale = Date.now() - new Date(s.createdAt).getTime() > 30 * 86400000;
            return (
              <div
                key={s.id}
                className="rounded-lg border p-3 cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setSelectedId(s.id)}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  <ClipboardCheck
                    className={`h-3.5 w-3.5 ${stale ? 'text-amber-500' : 'text-emerald-500'}`}
                  />
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">
                    {stale ? 'Stale' : 'Current'}
                  </span>
                </div>
                <div className="text-sm font-medium mt-1.5 line-clamp-2">{s.name}</div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Catalog entry <FormattedDate date={s.createdAt} />
                </div>
              </div>
            );
          })}
          {services.length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground py-2">
              No services in portfolio.
            </div>
          )}
        </div>
      </SectionCard>

      {servicesQ.isLoading ? (
        <LoadingState rows={6} />
      ) : services.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Briefcase className="h-10 w-10" />}
            title="No services in your portfolio"
            description="Services where you are the assigned owner will be listed here."
          />
        </SectionCard>
      ) : (
        <DataTable
          columns={columns}
          rows={services}
          onRowClick={(s) => setSelectedId(s.id)}
          empty="No services found."
        />
      )}

      {selectedId && (
        <ServiceDetailDialog
          serviceId={selectedId}
          onClose={() => setSelectedId(null)}
          slaEvents={slaEvents.filter((e) => e.serviceId === selectedId)}
          changes={changes.filter((c) => c.affectedServiceIds.includes(selectedId))}
          myServiceIds={myServiceIds}
        />
      )}
    </div>
  );
}

function ServiceDetailDialog({
  serviceId,
  onClose,
  slaEvents,
  changes,
  myServiceIds,
}: {
  serviceId: string;
  onClose: () => void;
  slaEvents: SlaEvent[];
  changes: Change[];
  myServiceIds: Set<string>;
}) {
  const { data, isLoading } = useQuery<Service & { offerings?: ServiceOffering[]; slaProfile?: SlaProfile | null }>({
    queryKey: ['service', serviceId],
    queryFn: () => apiGet(`/api/services/${serviceId}`),
  });

  const recentEvents = slaEvents
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 8);
  const recentChanges = changes
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto scrollbar-thin">
        {isLoading || !data ? (
          <div className="py-8">
            <LoadingState rows={4} />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <SlaClassBadge slaClass={data.slaClass} />
                <SlaHealthBadge health={deriveHealth(slaEvents)} />
                <Badge variant="outline">{SERVICE_DOMAIN_LABELS[data.domain]}</Badge>
                <Badge variant="outline">{SERVICE_LAYER_LABELS[data.layer]}</Badge>
              </div>
              <DialogTitle className="text-xl mt-2">{data.name}</DialogTitle>
              <DialogDescription>{data.chapter} chapter</DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="sla">SLA Profile</TabsTrigger>
                <TabsTrigger value="offerings">Offerings</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <p className="text-sm leading-relaxed text-foreground/90">{data.description}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <KeyValue label="Customer Value" value={data.customerValue} />
                  <KeyValue label="Commodity Type" value={data.commodityType} />
                  <KeyValue label="Support Levels" value={data.supportLevels} />
                  <KeyValue
                    label="Catalog Entry Created"
                    value={<FormattedDate date={data.createdAt} />}
                  />
                </dl>
              </TabsContent>

              <TabsContent value="sla" className="space-y-4 mt-4">
                {data.slaProfile ? (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Gauge className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">
                        SLA Profile — Class {data.slaProfile.slaClass}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <KeyValue
                        label="Availability Target"
                        value={`${data.slaProfile.availabilityTarget}%`}
                      />
                      <KeyValue
                        label="P1 Response"
                        value={`${data.slaProfile.p1ResponseMins} min`}
                      />
                      <KeyValue
                        label="P1 Resolution"
                        value={`${data.slaProfile.p1ResolutionMins} min`}
                      />
                      <KeyValue
                        label="P2 Response"
                        value={`${data.slaProfile.p2ResponseMins} min`}
                      />
                      <KeyValue
                        label="P2 Resolution"
                        value={`${data.slaProfile.p2ResolutionMins} min`}
                      />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Gauge className="h-7 w-7" />}
                    title="No SLA profile attached"
                    description="Attach an SLA profile to publish measurable commitments."
                  />
                )}
              </TabsContent>

              <TabsContent value="offerings" className="space-y-2 mt-4">
                {data.offerings && data.offerings.length > 0 ? (
                  data.offerings.map((o) => (
                    <div key={o.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                            {o.name}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {o.description}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {o.requestType.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Fulfillment: {o.fulfillmentDays} days</span>
                        <span>·</span>
                        <span>{o.active ? 'Active' : 'Inactive'}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<Package className="h-7 w-7" />}
                    title="No offerings published"
                    description="Define requestable offerings for this service."
                  />
                )}
              </TabsContent>

              <TabsContent value="activity" className="space-y-4 mt-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" /> Recent SLA Events
                  </h4>
                  {recentEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent SLA events.</p>
                  ) : (
                    <ul className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                      {recentEvents.map((e) => (
                        <li key={e.id} className="flex items-start gap-2 text-xs">
                          <span
                            className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                              e.eventType === 'BREACHED'
                                ? 'bg-rose-500'
                                : e.eventType === 'WARNING'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium">{e.eventType.replace(/_/g, ' ')}</span>
                              <RelativeTime date={e.createdAt} className="text-muted-foreground" />
                            </div>
                            <p className="text-muted-foreground mt-0.5">{e.message}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Recent Changes
                  </h4>
                  {recentChanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent changes.</p>
                  ) : (
                    <ul className="space-y-2">
                      {recentChanges.map((c) => (
                        <li key={c.id} className="text-xs border rounded-md p-2">
                          <div className="font-medium">{c.title}</div>
                          <div className="text-muted-foreground mt-0.5">
                            {c.status} · {c.type} · <RelativeTime date={c.createdAt} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
