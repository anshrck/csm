'use client';

import { useQuery } from '@tanstack/react-query';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  SlaClassBadge,
  Badge,
  Button,
  KeyValue,
  Card,
  CardContent,
} from '@/components/shared';
import { apiGet } from '@/lib/api';
import { Library, Search, Boxes, Layers, ShieldCheck, User } from 'lucide-react';
import { useMemo, useState } from 'react';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Service, ServiceDomain, ServiceLayer, SlaClass, ServiceStatus } from '@/lib/types';
import {
  SERVICE_DOMAIN_LABELS,
  SERVICE_LAYER_LABELS,
  SLA_CLASS_LABELS,
} from '@/lib/types';

const DOMAIN_OPTIONS: ServiceDomain[] = ['INTERACTION', 'SUPPORT', 'DELIVERY', 'MANAGEMENT'];
const LAYER_OPTIONS: ServiceLayer[] = ['BUSINESS', 'APPLICATION', 'PLATFORM', 'INFRASTRUCTURE'];
const SLA_OPTIONS: SlaClass[] = ['A', 'B', 'C', 'D'];

export default function Catalog() {
  const servicesQ = useQuery<Service[]>({
    queryKey: ['cm-leader', 'services', 'all'],
    queryFn: () => apiGet('/api/services?status=ALL'),
  });

  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<string>('all');
  const [layer, setLayer] = useState<string>('all');
  const [sla, setSla] = useState<string>('all');
  const [selected, setSelected] = useState<Service | null>(null);

  const services = servicesQ.data ?? [];

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (domain !== 'all' && s.domain !== domain) return false;
      if (layer !== 'all' && s.layer !== layer) return false;
      if (sla !== 'all' && s.slaClass !== sla) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${s.name} ${s.description} ${s.chapter} ${s.customerValue ?? ''} ${s.serviceOwnerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [services, search, domain, layer, sla]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    services.forEach((s) => {
      m[s.status] = (m[s.status] ?? 0) + 1;
    });
    return m;
  }, [services]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Catalog"
        description="Tenant-wide read-only view of the governed service catalog. Inspect services, offerings and SLA profiles."
        icon={<Library className="h-5 w-5" />}
        actions={
          <Badge variant="outline" className="tabular-nums">
            {filtered.length} of {services.length}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Services" value={services.length} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Active" value={byStatus.ACTIVE ?? 0} tone="success" icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Planned" value={byStatus.PLANNED ?? 0} icon={<Layers className="h-4 w-4" />} />
        <StatCard label="Class A Critical" value={services.filter((s) => s.slaClass === 'A').length} tone="danger" icon={<ShieldCheck className="h-4 w-4" />} />
      </div>

      <SectionCard>
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search services…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {DOMAIN_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>{SERVICE_DOMAIN_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={layer} onValueChange={setLayer}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Layer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All layers</SelectItem>
                {LAYER_OPTIONS.map((l) => (
                  <SelectItem key={l} value={l}>{SERVICE_LAYER_LABELS[l]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sla} onValueChange={setSla}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue placeholder="SLA Class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {SLA_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>Class {c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          {servicesQ.isLoading ? (
            <LoadingState rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Library className="h-8 w-8 text-muted-foreground/50" />}
              title="No services match your filters"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((s) => (
                <ServiceCard key={s.id} service={s} onOpen={() => setSelected(s)} />
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <ServiceDetailDialog service={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ServiceCard({ service, onOpen }: { service: Service; onOpen: () => void }) {
  return (
    <Card className="hover:shadow-md hover:border-primary/40 transition-all cursor-pointer" >
      <CardContent className="p-5" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2">{service.name}</h3>
          <SlaClassBadge slaClass={service.slaClass} />
        </div>
        <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{service.description}</p>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Badge variant="outline" className="text-[10px]">{SERVICE_DOMAIN_LABELS[service.domain]}</Badge>
          <Badge variant="outline" className="text-[10px]">{SERVICE_LAYER_LABELS[service.layer]}</Badge>
          {service.status !== 'ACTIVE' && (
            <Badge variant="outline" className="text-[10px] capitalize">{service.status.toLowerCase()}</Badge>
          )}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <User className="h-3 w-3" />
            {service.serviceOwnerName ?? 'Unassigned'}
          </span>
          <span className="text-primary font-medium">{service.offerings?.length ?? 0} offerings</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceDetailDialog({ service, onClose }: { service: Service | null; onClose: () => void }) {
  return (
    <Dialog open={!!service} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto scrollbar-thin">
        {service && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {service.name}
                <SlaClassBadge slaClass={service.slaClass} />
              </DialogTitle>
              <DialogDescription>{SERVICE_DOMAIN_LABELS[service.domain]} · {SERVICE_LAYER_LABELS[service.layer]} · {service.chapter.replace(/_/g, ' ')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-foreground/90 leading-relaxed">{service.description}</p>

              {service.customerValue && (
                <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                  <div className="text-[10px] font-medium text-primary uppercase tracking-wide mb-1">Customer Value</div>
                  <p className="text-sm">{service.customerValue}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <KeyValue label="Service Owner" value={service.serviceOwnerName ?? '—'} />
                <KeyValue label="Technical Owner" value={service.technicalOwnerName ?? '—'} />
                <KeyValue label="Commodity Type" value={service.commodityType ?? '—'} />
                <KeyValue label="Status" value={<span className="capitalize">{service.status.toLowerCase()}</span>} />
                <KeyValue label="Support Levels" value={service.supportLevels ?? '—'} />
                <KeyValue label="SLA Class" value={SLA_CLASS_LABELS[service.slaClass]} />
              </div>

              {service.slaProfile && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">SLA Profile</h4>
                  <div className="rounded-md border p-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <KeyValue label="Availability Target" value={`${service.slaProfile.availabilityTarget}%`} />
                    <KeyValue label="P1 Response" value={`${service.slaProfile.p1ResponseMins} min`} />
                    <KeyValue label="P1 Resolution" value={`${service.slaProfile.p1ResolutionMins} min`} />
                    <KeyValue label="P2 Response" value={`${service.slaProfile.p2ResponseMins} min`} />
                    <KeyValue label="P2 Resolution" value={`${service.slaProfile.p2ResolutionMins} min`} />
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-2">Service Offerings ({service.offerings?.length ?? 0})</h4>
                {service.offerings && service.offerings.length > 0 ? (
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Offering</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs text-right">Fulfillment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {service.offerings.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell>
                              <div className="font-medium text-sm">{o.name}</div>
                              <div className="text-xs text-muted-foreground line-clamp-1">{o.description}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">{o.requestType}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{o.fulfillmentDays}d</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No offerings defined.</p>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
