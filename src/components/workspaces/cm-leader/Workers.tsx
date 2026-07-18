'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';
import {
  PageHeader,
  SectionCard,
  StatCard,
  EmptyState,
  LoadingState,
  DemandStatusBadge,
  UserAvatar,
  RelativeTime,
  DataTable,
  type Column,
  Button,
  Badge,
  Card,
  CardContent,
} from '@/components/shared';
import { WorkloadBars, MiniBarChart } from '@/components/widgets';
import { useDemands, useLeaderStats, daysSince, type WorkloadItem } from './Dashboard';
import {
  Users,
  AlertTriangle,
  Clock,
  FileText,
  ArrowRight,
  TrendingUp,
  Building2,
  UserPlus,
  Trash2,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import type { Demand, DemandStatus } from '@/lib/types';
import { DEMAND_STATUS_LABELS } from '@/lib/types';

const STALL_THRESHOLD_DAYS = 3;
const ACTIVE_STATUSES: DemandStatus[] = ['NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'IN_CHANGE', 'FULFILLED'];

// ---- Customer assignment API types (mirrors /api/customer-assignments serializer) ----

interface CustomerAssignment {
  id: string;
  orgNodeId: string;
  orgNodeName: string;
  orgNodeType: string;
  orgNodeParentId: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  userAvatarColor: string;
  userTitle: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

interface OrgNodeOption {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

export default function Workers() {
  const qc = useQueryClient();
  const demandsQ = useDemands();
  const statsQ = useLeaderStats();

  // Fetch all customer assignments for the SCM Worker roster.
  const assignmentsQ = useQuery<CustomerAssignment[]>({
    queryKey: ['customer-assignments', 'all'],
    queryFn: () => apiGet<CustomerAssignment[]>('/api/customer-assignments?active=1'),
    staleTime: 30_000,
  });
  const assignments = assignmentsQ.data ?? [];

  const demands = demandsQ.data ?? [];
  const workers = statsQ.data?.workloadByWorker ?? [];

  const [openWorker, setOpenWorker] = useState<WorkloadItem | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<WorkloadItem | null>(null);

  // enrich workers with derived data
  const enriched = useMemo(() => {
    return workers.map((w) => {
      const ws = demands.filter((d) => d.assignedScmWorkerId === w.workerId);
      const active = ws.filter((d) => ACTIVE_STATUSES.includes(d.status));
      const byStatus: Record<string, number> = {};
      active.forEach((d) => {
        byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      });
      const stallingUnderReview = active.filter(
        (d) => d.status === 'UNDER_REVIEW' && (daysSince(d.updatedAt) ?? 0) > STALL_THRESHOLD_DAYS,
      );
      const risk = (w.slaRisk ?? w.riskCount ?? 0) + stallingUnderReview.length;
      return { ...w, activeCount: active.length, totalCount: ws.length, byStatus, stallingUnderReview, risk };
    });
  }, [workers, demands]);

  const totalActive = enriched.reduce((a, w) => a + w.activeCount, 0);
  const avgActive = enriched.length ? Math.round((totalActive / enriched.length) * 10) / 10 : 0;
  const maxActive = enriched.reduce((a, w) => Math.max(a, w.activeCount), 0);

  const workloadItems = enriched.map((w) => ({
    name: w.workerName,
    count: w.activeCount,
    risk: w.risk,
  }));

  // Map of userId → assigned customer orgs.
  const assignmentsByUser = useMemo(() => {
    const map = new Map<string, CustomerAssignment[]>();
    for (const a of assignments) {
      const arr = map.get(a.userId) ?? [];
      arr.push(a);
      map.set(a.userId, arr);
    }
    return map;
  }, [assignments]);

  const totalAssignments = assignments.length;
  const workersWithAssignments = new Set(assignments.map((a) => a.userId)).size;

  // Open the Assign Customer dialog for a specific worker.
  function openAssignDialog(worker: WorkloadItem) {
    setAssignTarget(worker);
    setAssignOpen(true);
  }

  // Create-assignment mutation — fired from the AssignCustomerDialog.
  const createAssignmentMut = useMutation({
    mutationFn: (payload: { orgNodeId: string; userId: string; role: string }) =>
      apiPost<CustomerAssignment>('/api/customer-assignments', payload),
    onSuccess: (_a, vars) => {
      toast.success('Customer org assigned', {
        description: `${assignTarget?.workerName ?? 'Worker'} is now accountable for the selected customer org.`,
      });
      setAssignOpen(false);
      setAssignTarget(null);
      qc.invalidateQueries({ queryKey: ['customer-assignments'] });
      // vars kept for log continuity.
      void vars;
    },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) {
        toast.info('Assignment already exists', { description: 'This worker is already assigned to that customer org.' });
      } else {
        toast.error('Could not assign customer', { description: e.message });
      }
    },
  });

  // Delete-assignment mutation — fired from the per-assignment unassign button.
  const deleteAssignmentMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/customer-assignments/${id}`),
    onSuccess: () => {
      toast.success('Assignment removed');
      qc.invalidateQueries({ queryKey: ['customer-assignments'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not remove assignment'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="SCM Workload Monitoring"
        description="Monitor active demand distribution across your SCM Workers. Spot workload imbalance and early stalling signals before they affect SLA."
        icon={<Users className="h-5 w-5" />}
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="SCM Workers"
          value={enriched.length}
          hint="Active in tenant"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Total Active Demands"
          value={totalActive}
          hint="Across all workers"
          icon={<FileText className="h-4 w-4" />}
        />
        <StatCard
          label="Avg per Worker"
          value={avgActive}
          hint={`Max: ${maxActive}`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Customer Assignments"
          value={totalAssignments}
          hint={`${workersWithAssignments} of ${enriched.length} workers have ≥1 customer`}
          icon={<Building2 className="h-4 w-4" />}
        />
      </div>

      {statsQ.isLoading ? (
        <LoadingState rows={3} />
      ) : enriched.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Users className="h-8 w-8 text-muted-foreground/50" />}
            title="No SCM Workers found"
            description="Workload metrics will appear here once workers are assigned demands."
          />
        </SectionCard>
      ) : (
        <>
          {/* Workload bars */}
          <SectionCard
            title="Workload Distribution"
            description="Active demands per SCM Worker — bars are colored by risk count (red = elevated risk)."
          >
            <WorkloadBars items={workloadItems} />
          </SectionCard>

          {/* Worker cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {enriched.map((w) => (
              <WorkerCard
                key={w.workerId}
                worker={w}
                assignments={assignmentsByUser.get(w.workerId) ?? []}
                onOpen={() => setOpenWorker(w)}
                onAssign={() => openAssignDialog(w)}
                onUnassign={(id) => deleteAssignmentMut.mutate(id)}
                pendingUnassign={deleteAssignmentMut.isPending}
              />
            ))}
          </div>
        </>
      )}

      <WorkerDemandsDialog
        worker={openWorker}
        demands={demands.filter((d) => d.assignedScmWorkerId === openWorker?.workerId)}
        onOpenChange={(v) => !v && setOpenWorker(null)}
      />

      <AssignCustomerDialog
        key={assignTarget?.workerId ?? 'none'}
        open={assignOpen}
        onOpenChange={(v) => {
          setAssignOpen(v);
          if (!v) setAssignTarget(null);
        }}
        worker={assignTarget}
        existingOrgIds={new Set((assignTarget ? assignmentsByUser.get(assignTarget.workerId) ?? [] : []).map((a) => a.orgNodeId))}
        onConfirm={(orgNodeId, role) =>
          assignTarget &&
          createAssignmentMut.mutate({ orgNodeId, userId: assignTarget.workerId, role })
        }
        pending={createAssignmentMut.isPending}
      />
    </div>
  );
}

function WorkerCard({
  worker,
  assignments,
  onOpen,
  onAssign,
  onUnassign,
  pendingUnassign,
}: {
  worker: WorkloadItem & { activeCount: number; totalCount: number; byStatus: Record<string, number>; stallingUnderReview: Demand[]; risk: number };
  assignments: CustomerAssignment[];
  onOpen: () => void;
  onAssign: () => void;
  onUnassign: (id: string) => void;
  pendingUnassign: boolean;
}) {
  const statusData = (Object.entries(worker.byStatus) as [string, number][]).map(([status, value]) => ({
    label: DEMAND_STATUS_LABELS[status as DemandStatus] ?? status,
    value,
  }));
  const hasRisk = worker.risk > 0;
  const hasStalling = worker.stallingUnderReview.length > 0;

  return (
    <Card className={`overflow-hidden ${hasRisk ? 'border-amber-200 dark:border-amber-900/60' : ''}`}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <UserAvatar name={worker.workerName} color={worker.avatarColor} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{worker.workerName}</div>
            <div className="text-xs text-muted-foreground">SCM Worker</div>
          </div>
          {hasRisk && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 shrink-0">
              <AlertTriangle className="h-3 w-3 mr-1" /> {worker.risk} risk
            </Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{worker.activeCount}</div>
            <div className="text-[10px] text-muted-foreground">Active</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{worker.totalCount}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-lg font-semibold tabular-nums">{statusData.length}</div>
            <div className="text-[10px] text-muted-foreground">Statuses</div>
          </div>
        </div>

        {statusData.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              By status
            </div>
            <MiniBarChart data={statusData} />
          </div>
        )}

        {hasStalling && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" />
              {worker.stallingUnderReview.length} stalling in Under Review
            </div>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">
              No update for over {STALL_THRESHOLD_DAYS} days — early signal of risk.
            </p>
          </div>
        )}

        {/* Customer assignments */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Assigned customers ({assignments.length})
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1"
              onClick={onAssign}
            >
              <UserPlus className="h-3 w-3" /> Assign
            </Button>
          </div>
          {assignments.length === 0 ? (
            <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground text-center">
              No customer orgs assigned — this worker currently picks up unassigned work.
            </div>
          ) : (
            <ul className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      {a.orgNodeName}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="text-[9px] h-3.5 px-1 py-0"
                      >
                        {a.role === 'SCM_OWNER' ? 'Owner' : a.role === 'BACKUP' ? 'Backup' : 'Escalation'}
                      </Badge>
                      <span>assigned <RelativeTime date={a.createdAt} /></span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-600"
                    onClick={() => onUnassign(a.id)}
                    disabled={pendingUnassign}
                    aria-label={`Unassign ${a.orgNodeName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )
          }
        </div>

        <Button variant="outline" size="sm" className="w-full mt-4" onClick={onOpen}>
          View demands <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkerDemandsDialog({
  worker,
  demands,
  onOpenChange,
}: {
  worker: WorkloadItem | null;
  demands: Demand[];
  onOpenChange: (v: boolean) => void;
}) {
  const { navigate } = useApp();

  const columns: Column<Demand>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => (
        <div className="min-w-0 max-w-[260px]">
          <div className="font-medium text-sm truncate">{d.title}</div>
          <div className="text-xs text-muted-foreground truncate">{d.serviceCustomerName}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <DemandStatusBadge status={d.status} />,
    },
    {
      key: 'updated',
      header: 'Last updated',
      render: (d) => <RelativeTime date={d.updatedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <Dialog open={!!worker} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {worker && <UserAvatar name={worker.workerName} color={worker.avatarColor} />}
            {worker?.workerName ?? 'Worker'} — assigned demands
          </DialogTitle>
          <DialogDescription>
            {demands.length} demand{demands.length !== 1 ? 's' : ''} assigned to this SCM Worker.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {demands.length === 0 ? (
            <EmptyState title="No demands assigned" />
          ) : (
            <DataTable
              columns={columns}
              rows={demands}
              onRowClick={(d) => {
                onOpenChange(false);
                navigate('demand-detail', { id: d.id });
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Assign Customer dialog ----------------------------------------------

function AssignCustomerDialog({
  open,
  onOpenChange,
  worker,
  existingOrgIds,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: WorkloadItem | null;
  existingOrgIds: Set<string>;
  onConfirm: (orgNodeId: string, role: string) => void;
  pending: boolean;
}) {
  // Fetch all customer org nodes (type=CUSTOMER_ORG). We piggy-back on the
  // demands endpoint: every distinct serviceCustomerName pair gives us a
  // customer org without needing a dedicated /api/org-nodes route.
  const orgsQ = useQuery<OrgNodeOption[]>({
    queryKey: ['org-nodes', 'customers'],
    queryFn: async () => {
      const allDemands = await apiGet<(Demand & { serviceCustomerName?: string })[]>('/api/demands?limit=500');
      const seen = new Map<string, OrgNodeOption>();
      for (const d of allDemands) {
        if (d.serviceCustomerId && !seen.has(d.serviceCustomerId)) {
          seen.set(d.serviceCustomerId, {
            id: d.serviceCustomerId,
            name: d.serviceCustomerName ?? 'Unknown',
            type: 'CUSTOMER_ORG',
            parentId: null,
          });
        }
      }
      return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: open,
    staleTime: 60_000,
  });

  const [orgNodeId, setOrgNodeId] = useState('');
  const [role, setRole] = useState<string>('SCM_OWNER');

  // The parent passes a `key` based on the target worker id, so each fresh
  // open mounts this component from scratch with the default state below —
  // no useEffect reset needed.

  const available = (orgsQ.data ?? []).filter((o) => !existingOrgIds.has(o.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Assign customer to {worker?.workerName ?? 'worker'}
          </DialogTitle>
          <DialogDescription>
            Choose a customer org this SCM Worker will be accountable for. The worker
            will see all tickets and demands raised by that org in their queues.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ac-org">Customer org</Label>
            {orgsQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading customer orgs…</div>
            ) : available.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No unassigned customer orgs available — this worker is already
                assigned to every known customer org.
              </div>
            ) : (
              <Select value={orgNodeId} onValueChange={setOrgNodeId}>
                <SelectTrigger id="ac-org" className="w-full">
                  <SelectValue placeholder="Select customer org…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3 w-3" />
                        {o.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-role">Assignment role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="ac-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCM_OWNER">SCM Owner (primary)</SelectItem>
                <SelectItem value="BACKUP">Backup</SelectItem>
                <SelectItem value="ESCALATION_MANAGER">Escalation Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <X className="h-4 w-4 mr-1.5" /> Cancel
          </Button>
          <Button
            disabled={pending || !orgNodeId}
            onClick={() => onConfirm(orgNodeId, role)}
          >
            {pending ? (
              'Assigning…'
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Assign
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
