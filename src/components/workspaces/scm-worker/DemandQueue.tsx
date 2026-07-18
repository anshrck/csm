'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  DataTable,
  DemandStatusBadge,
  UserAvatar,
  RelativeTime,
  FormattedDate,
  EmptyState,
  LoadingState,
  Button,
  Card,
  CardContent,
  Badge,
  type Column,
} from '@/components/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ClipboardList,
  Search,
  PlusCircle,
  Filter,
  Inbox,
  Loader2,
} from 'lucide-react';
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS: DemandStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'QUOTED',
  'ACCEPTED',
  'IN_CHANGE',
  'FULFILLED',
  'CLOSED',
  'REJECTED',
  'REDIRECTED',
];

export default function DemandQueue() {
  const { navigate } = useApp();
  const qc = useQueryClient();

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<DemandStatus[]>([]);
  const [unassignedOnly, setUnassignedOnly] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const { data: demands, isLoading } = useQuery<Demand[]>({
    queryKey: ['demands', 'all'],
    queryFn: () => apiGet('/api/demands'),
  });

  const allDemands = demands ?? [];

  // Unique customer options for create dialog
  const customerOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of allDemands) {
      if (d.serviceCustomerId && d.serviceCustomerName) {
        m.set(d.serviceCustomerId, d.serviceCustomerName);
      }
    }
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [allDemands]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDemands.filter((d) => {
      if (unassignedOnly && d.assignedScmWorkerId) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(d.status)) return false;
      if (q) {
        const hay = `${d.title} ${d.description} ${d.serviceCustomerName ?? ''} ${d.submittedByName ?? ''} ${d.assignedScmWorkerName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allDemands, search, statusFilter, unassignedOnly]);

  const createDemand = useMutation({
    mutationFn: (body: { title: string; description: string; serviceCustomerId: string }) =>
      apiPost<Demand>('/api/demands', body),
    onSuccess: (d) => {
      toast.success('Demand created on behalf of customer');
      qc.invalidateQueries({ queryKey: ['demands'] });
      setCreateOpen(false);
      navigate('demand-detail', { id: d.id });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create demand'),
  });

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0">
          <p className="font-medium truncate max-w-[28ch]">{d.title}</p>
          <p className="text-xs text-muted-foreground truncate max-w-[40ch]">{d.description}</p>
        </div>
      ),
      className: 'max-w-md',
    },
    {
      key: 'customer',
      header: 'Service Customer',
      render: (d) => (
        <span className="text-sm">{d.serviceCustomerName ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <DemandStatusBadge status={d.status} />,
    },
    {
      key: 'worker',
      header: 'Assigned Worker',
      render: (d) =>
        d.assignedScmWorkerName ? (
          <div className="flex items-center gap-2">
            <UserAvatar name={d.assignedScmWorkerName} size="sm" />
            <span className="text-sm truncate">{d.assignedScmWorkerName}</span>
          </div>
        ) : (
          <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50">
            Unassigned
          </Badge>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (d) => <FormattedDate date={d.createdAt} className="text-sm" />,
    },
    {
      key: 'updated',
      header: 'Last updated',
      render: (d) => <RelativeTime date={d.updatedAt} className="text-sm text-muted-foreground" />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demand Queue"
        description="All demands across the tenant — filter, search, and pick up work."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Demand on behalf
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Search + unassigned switch */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, customer, submitter, worker…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 px-1">
              <Switch
                id="unassigned-switch"
                checked={unassignedOnly}
                onCheckedChange={setUnassignedOnly}
              />
              <Label htmlFor="unassigned-switch" className="text-sm cursor-pointer">
                Unassigned only
              </Label>
            </div>
          </div>

          {/* Status multi-toggle */}
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mt-2">
              <Filter className="h-3.5 w-3.5" /> Status:
            </div>
            <ToggleGroup
              type="multiple"
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as DemandStatus[])}
              variant="outline"
              className="flex-wrap"
            >
              {STATUS_OPTIONS.map((s) => (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className="text-xs h-7 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {DEMAND_STATUS_LABELS[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {statusFilter.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 mt-0.5"
                onClick={() => setStatusFilter([])}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {filtered.length} of {allDemands.length} demands
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState rows={6} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              title="No demands match your filters"
              description="Try clearing the status filter or search query."
            />
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(d) => navigate('demand-detail', { id: d.id })}
        />
      )}

      <CreateDemandDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customers={customerOptions}
        submitting={createDemand.isPending}
        onSubmit={(body) => createDemand.mutate(body)}
      />
    </div>
  );
}

function CreateDemandDialog({
  open,
  onOpenChange,
  customers,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: { id: string; name: string }[];
  submitting: boolean;
  onSubmit: (body: { title: string; description: string; serviceCustomerId: string }) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [customerId, setCustomerId] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setCustomerId('');
    }
  }, [open]);

  const valid = title.trim().length > 2 && description.trim().length > 2 && !!customerId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Demand on behalf of customer</DialogTitle>
          <DialogDescription>
            Capture a demand raised verbally or by email. The customer will be able to track it in their portal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              placeholder="e.g. Procurement self-service portal module"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Description</Label>
            <Textarea
              id="d-desc"
              rows={4}
              placeholder="Describe what the customer needs and why…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-cust">Service Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="d-cust" className="w-full">
                <SelectValue placeholder="Select customer organisation" />
              </SelectTrigger>
              <SelectContent>
                {customers.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No customers available
                  </SelectItem>
                ) : (
                  customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ title: title.trim(), description: description.trim(), serviceCustomerId: customerId })}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create demand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
