'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Library,
  Search,
  X,
  Layers,
  PlusCircle,
  Clock,
  Package,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { apiGet } from '@/lib/api';
import {
  type Service,
  type ServiceDomain,
  type SlaClass,
  SERVICE_DOMAIN_LABELS,
} from '@/lib/types';
import {
  PageHeader,
  SlaClassBadge,
  EmptyState,
  LoadingState,
  Button,
  Badge,
} from '@/components/shared';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const DOMAIN_FILTERS: { key: ServiceDomain | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All Domains' },
  { key: 'INTERACTION', label: 'Interaction' },
  { key: 'SUPPORT', label: 'Support' },
  { key: 'DELIVERY', label: 'Delivery' },
  { key: 'MANAGEMENT', label: 'Management' },
];

const SLA_FILTERS: { key: SlaClass | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All SLA classes' },
  { key: 'A', label: 'Class A — Mission Critical' },
  { key: 'B', label: 'Class B — Business Critical' },
  { key: 'C', label: 'Class C — Standard' },
  { key: 'D', label: 'Class D — Best Effort' },
];

export default function Catalog() {
  const { navigate } = useApp();
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<ServiceDomain | 'ALL'>('ALL');
  const [slaClass, setSlaClass] = useState<SlaClass | 'ALL'>('ALL');
  const [selected, setSelected] = useState<Service | null>(null);

  const servicesQ = useQuery({
    queryKey: ['services', 'entitled'],
    queryFn: () => apiGet<Service[]>('/api/services?entitled=1'),
  });

  const filtered = useMemo(() => {
    const list = servicesQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list
      .filter((s) => (domain === 'ALL' ? true : s.domain === domain))
      .filter((s) => (slaClass === 'ALL' ? true : s.slaClass === slaClass))
      .filter((s) =>
        q
          ? s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            (s.customerValue ?? '').toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [servicesQ.data, search, domain, slaClass]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Catalog"
        description="The set of services your organisational unit is entitled to consume. Open a service to view offerings and submit a demand."
        icon={<Library className="h-5 w-5" />}
      />

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search services…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {DOMAIN_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setDomain(f.key)}
                className={cn(
                  'inline-flex items-center h-8 px-3 rounded-md text-xs font-medium border transition-colors',
                  domain === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-accent hover:text-accent-foreground border-border',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="sm:ml-auto w-full sm:w-64">
            <Select value={slaClass} onValueChange={(v) => setSlaClass(v as SlaClass | 'ALL')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="SLA class" />
              </SelectTrigger>
              <SelectContent>
                {SLA_FILTERS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {servicesQ.isLoading ? (
        <LoadingState rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Library className="h-10 w-10" />}
          title={servicesQ.data && servicesQ.data.length > 0 ? 'No matching services' : 'No entitled services'}
          description={
            servicesQ.data && servicesQ.data.length > 0
              ? 'Adjust your filters to find what you need.'
              : 'Your organisation has no active service entitlements yet.'
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {servicesQ.data?.length ?? 0} entitled services
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((s) => (
              <ServiceCard
                key={s.id}
                service={s}
                onOpen={() => setSelected(s)}
              />
            ))}
          </div>
        </>
      )}

      <ServiceDetailDialog
        service={selected}
        onClose={() => setSelected(null)}
        onSubmitDemand={(id) => {
          setSelected(null);
          navigate('submit-demand', { serviceId: id });
        }}
      />
    </div>
  );
}

function ServiceCard({ service, onOpen }: { service: Service; onOpen: () => void }) {
  const offerings = service.offerings ?? [];
  return (
    <button
      onClick={onOpen}
      className="text-left flex flex-col rounded-lg border bg-card hover:border-primary/40 hover:shadow-md transition-all p-4 group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight group-hover:text-primary line-clamp-2">
            {service.name}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-wide">
            {SERVICE_DOMAIN_LABELS[service.domain]} · {service.chapter.replace(/_/g, ' ')}
          </p>
        </div>
        <SlaClassBadge slaClass={service.slaClass} className="shrink-0" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">
        {service.description}
      </p>
      <div className="mt-3 flex items-center justify-between pt-3 border-t">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          {offerings.length} offering{offerings.length === 1 ? '' : 's'}
        </span>
        <span className="text-xs font-medium text-primary group-hover:underline">View details →</span>
      </div>
    </button>
  );
}

function ServiceDetailDialog({
  service,
  onClose,
  onSubmitDemand,
}: {
  service: Service | null;
  onClose: () => void;
  onSubmitDemand: (id: string) => void;
}) {
  const offerings = service?.offerings ?? [];
  return (
    <Dialog open={!!service} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {service && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-2 pr-6">
                <DialogTitle className="text-lg">{service.name}</DialogTitle>
                <SlaClassBadge slaClass={service.slaClass} className="shrink-0" />
              </div>
              <DialogDescription className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{SERVICE_DOMAIN_LABELS[service.domain]}</Badge>
                <span className="text-xs text-muted-foreground">{service.chapter.replace(/_/g, ' ')}</span>
                {service.slaProfile && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    {service.slaProfile.availabilityTarget}% availability target
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Description
                  </h4>
                  <p className="text-sm leading-relaxed">{service.description}</p>
                </div>

                {service.customerValue && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Customer Value
                    </h4>
                    <p className="text-sm leading-relaxed text-foreground/90">{service.customerValue}</p>
                  </div>
                )}

                {service.slaProfile && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Layers className="h-3 w-3" /> SLA Profile — Class {service.slaClass}
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Availability</dt>
                        <dd className="font-medium tabular-nums">{service.slaProfile.availabilityTarget}%</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">P1 Response</dt>
                        <dd className="font-medium tabular-nums">{service.slaProfile.p1ResponseMins} min</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">P1 Resolution</dt>
                        <dd className="font-medium tabular-nums">{formatMins(service.slaProfile.p1ResolutionMins)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">P2 Resolution</dt>
                        <dd className="font-medium tabular-nums">{formatMins(service.slaProfile.p2ResolutionMins)}</dd>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Offerings ({offerings.length})
                  </h4>
                  {offerings.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No active offerings on this service.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {offerings.map((o) => (
                        <li key={o.id} className="p-3 first:pt-3 last:pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{o.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{o.description}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <Badge variant="outline" className="text-[10px]">{o.requestType.replace(/_/g, ' ')}</Badge>
                              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {o.fulfillmentDays}d
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => onSubmitDemand(service.id)} className="gap-2">
                <PlusCircle className="h-4 w-4" /> Submit Demand for This Service
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
