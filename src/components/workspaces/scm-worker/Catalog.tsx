'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  DataTable,
  SlaClassBadge,
  EmptyState,
  LoadingState,
  SectionCard,
  KeyValue,
  Button,
  Card,
  CardContent,
  Badge,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Library,
  Search,
  Filter,
  Layers,
  User,
  Wrench,
  PackageOpen,
  Gauge,
  FileText,
} from 'lucide-react';
import type { Service, ServiceDomain, ServiceLayer, SlaClass, ServiceStatus } from '@/lib/types';
import {
  SERVICE_DOMAIN_LABELS,
  SERVICE_LAYER_LABELS,
  SLA_CLASS_LABELS,
} from '@/lib/types';

const DOMAINS: ServiceDomain[] = ['INTERACTION', 'SUPPORT', 'DELIVERY', 'MANAGEMENT'];
const LAYERS: ServiceLayer[] = ['BUSINESS', 'APPLICATION', 'PLATFORM', 'INFRASTRUCTURE'];
const SLA_CLASSES: SlaClass[] = ['A', 'B', 'C', 'D'];
const STATUSES: ServiceStatus[] = ['ACTIVE', 'RETIRED', 'PLANNED'];

const STATUS_STYLE: Record<ServiceStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  RETIRED: 'bg-muted text-muted-foreground border-border',
  PLANNED: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
};

export default function Catalog() {
  const { navigate } = useApp();
  const [search, setSearch] = React.useState('');
  const [domain, setDomain] = React.useState<string>('ALL');
  const [layer, setLayer] = React.useState<string>('ALL');
  const [slaClass, setSlaClass] = React.useState<string>('ALL');
  const [status, setStatus] = React.useState<string>('ALL');
  const [selected, setSelected] = React.useState<Service | null>(null);

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ['services', 'all-status'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  const all = services ?? [];

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (domain !== 'ALL' && s.domain !== domain) return false;
      if (layer !== 'ALL' && s.layer !== layer) return false;
      if (slaClass !== 'ALL' && s.slaClass !== slaClass) return false;
      if (status !== 'ALL' && s.status !== status) return false;
      if (q) {
        const hay = `${s.name} ${s.description} ${s.chapter} ${s.serviceOwnerName ?? ''} ${s.technicalOwnerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, search, domain, layer, slaClass, status]);

  const columns = [
    {
      key: 'name',
      header: 'Service',
      render: (s: Service) => (
        <div className="min-w-0">
          <p className="font-medium truncate max-w-[32ch]">{s.name}</p>
          <p className="text-xs text-muted-foreground truncate max-w-[48ch]">{s.description}</p>
        </div>
      ),
    },
    {
      key: 'domain',
      header: 'Domain / Chapter',
      render: (s: Service) => (
        <div className="text-sm">
          <div>{SERVICE_DOMAIN_LABELS[s.domain]}</div>
          <div className="text-xs text-muted-foreground">{s.chapter.replace(/_/g, ' ').toLowerCase()}</div>
        </div>
      ),
    },
    {
      key: 'layer',
      header: 'Layer',
      render: (s: Service) => <span className="text-sm">{SERVICE_LAYER_LABELS[s.layer]}</span>,
    },
    {
      key: 'slaClass',
      header: 'SLA Class',
      render: (s: Service) => <SlaClassBadge slaClass={s.slaClass} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s: Service) => (
        <Badge variant="outline" className={`text-xs ${STATUS_STYLE[s.status]}`}>
          {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'owners',
      header: 'Service Owner',
      render: (s: Service) => (
        <div className="text-sm">
          <div className="truncate">{s.serviceOwnerName ?? '—'}</div>
          {s.technicalOwnerName && (
            <div className="text-xs text-muted-foreground truncate">Tech: {s.technicalOwnerName}</div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Catalog"
        description="Full tenant catalog — read-only. Use it to assess demands and propose the right services."
        icon={<Library className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, description, chapter, owner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> Filters:
            </div>
            <FilterSelect label="Domain" value={domain} onChange={setDomain} options={DOMAINS.map((d) => ({ value: d, label: SERVICE_DOMAIN_LABELS[d] }))} />
            <FilterSelect label="Layer" value={layer} onChange={setLayer} options={LAYERS.map((l) => ({ value: l, label: SERVICE_LAYER_LABELS[l] }))} />
            <FilterSelect label="SLA Class" value={slaClass} onChange={setSlaClass} options={SLA_CLASSES.map((c) => ({ value: c, label: `Class ${c}` }))} />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {all.length} services
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState rows={6} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<Library className="h-8 w-8" />}
              title="No services match your filters"
              description="Adjust the filters above to see more of the catalog."
            />
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(s) => setSelected(s)}
        />
      )}

      <ServiceDetailDialog
        service={selected}
        onClose={() => setSelected(null)}
        onRequestChange={() => {
          toast.info('Catalog changes are made via Change Enablement', {
            description: 'Raise a demand and hand it to CE — the change record is where the catalog update is tracked.',
          });
          setSelected(null);
          navigate('demands');
        }}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[150px]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All {label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ServiceDetailDialog({
  service,
  onClose,
  onRequestChange,
}: {
  service: Service | null;
  onClose: () => void;
  onRequestChange: () => void;
}) {
  const open = !!service;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin">
        {service && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-xs ${STATUS_STYLE[service.status]}`}>
                  {service.status.charAt(0) + service.status.slice(1).toLowerCase()}
                </Badge>
                <SlaClassBadge slaClass={service.slaClass} />
                <Badge variant="outline" className="text-xs">
                  {SERVICE_DOMAIN_LABELS[service.domain]}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {SERVICE_LAYER_LABELS[service.layer]}
                </Badge>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {service.chapter.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              </div>
              <DialogTitle className="text-xl mt-2">{service.name}</DialogTitle>
              <DialogDescription className="leading-relaxed">
                {service.description}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* 9-field model: description, customerValue, commodityType, supportLevels, offerings, slaProfile targets, owners */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KeyValue label="Customer Value" value={service.customerValue} />
                <KeyValue
                  label="Commodity Type"
                  value={
                    service.commodityType
                      ? service.commodityType.charAt(0) + service.commodityType.slice(1).toLowerCase()
                      : null
                  }
                />
                <KeyValue label="Support Levels" value={service.supportLevels} />
                <KeyValue label="Service Status" value={service.status.charAt(0) + service.status.slice(1).toLowerCase()} />
              </div>

              {/* Owners */}
              <SectionCard title="Ownership">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-2">
                    <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <KeyValue label="Service Owner" value={service.serviceOwnerName ?? '—'} />
                  </div>
                  <div className="flex items-start gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <KeyValue label="Technical Owner" value={service.technicalOwnerName ?? '—'} />
                  </div>
                </div>
              </SectionCard>

              {/* SLA Profile */}
              <SectionCard title="SLA Profile Targets">
                {service.slaProfile ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <SlaTarget label="Availability" value={`${service.slaProfile.availabilityTarget}%`} />
                    <SlaTarget label="P1 Response" value={`${service.slaProfile.p1ResponseMins} min`} />
                    <SlaTarget label="P1 Resolution" value={`${service.slaProfile.p1ResolutionMins} min`} />
                    <SlaTarget label="P2 Response" value={`${service.slaProfile.p2ResponseMins} min`} />
                    <SlaTarget label="P2 Resolution" value={`${service.slaProfile.p2ResolutionMins} min`} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No SLA profile defined.</p>
                )}
              </SectionCard>

              {/* Offerings */}
              <SectionCard
                title="Service Offerings"
                description="Catalogued fulfilment paths for this service."
                actions={
                  service.offerings && service.offerings.length > 0 ? (
                    <Badge variant="outline" className="text-xs">{service.offerings.length}</Badge>
                  ) : undefined
                }
              >
                {service.offerings && service.offerings.length > 0 ? (
                  <div className="space-y-2">
                    {service.offerings.map((o) => (
                      <div key={o.id} className="flex items-start gap-3 rounded-md border p-3">
                        <PackageOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{o.name}</p>
                            <Badge variant="outline" className="text-[10px] shrink-0">{o.requestType.replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Fulfilment: <span className="font-medium text-foreground">{o.fulfillmentDays} day{o.fulfillmentDays === 1 ? '' : 's'}</span>
                            {!o.active && <span className="ml-2 text-rose-600">· Inactive</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No offerings defined for this service.</p>
                )}
              </SectionCard>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={onClose} className="gap-1.5">
                <FileText className="h-4 w-4" /> Close
              </Button>
              <Button variant="outline" onClick={onRequestChange} className="gap-1.5">
                <Layers className="h-4 w-4" /> Request Catalog Change
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SlaTarget({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Gauge className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
