'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { DataTable, Badge, type Column } from '@/components/shared';
import type { Ticket, TicketPriority, TicketStatus } from '@/lib/tickets';
import {
  TICKET_PRIORITY_SHORT,
  TICKET_STATUS_LABELS,
} from '@/lib/tickets';
import { SlaClockBadge } from './SlaClockBadge';

/**
 * TicketMiniTable — compact ticket list for embedding inside the Service
 * Detail "Tickets" tab and similar surfaces.
 *
 * Columns: number, title, priority badge, status, SLA indicator.
 * Designed to be scannable at a glance; the consumer wires row clicks to the
 * ticket-detail view via `onSelect`.
 */

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  P1: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
  P2: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  P3: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  P4: 'bg-muted text-muted-foreground border-border',
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  NEW: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300',
  TRIAGED: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  ASSIGNED: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
  IN_PROGRESS: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300',
  WAITING_CUSTOMER: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  RESOLVED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  CLOSED: 'bg-muted text-muted-foreground border-border',
  CANCELED: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300',
};

function deriveSlaStatus(clocks: Ticket['slaClocks']): string | null {
  if (!clocks || clocks.length === 0) return null;
  // BREACHED takes priority; otherwise RUNNING; otherwise the first clock's status.
  if (clocks.some((c) => c.status === 'BREACHED')) return 'BREACHED';
  const running = clocks.find((c) => c.status === 'RUNNING');
  if (running) return 'RUNNING';
  const paused = clocks.find((c) => c.status === 'PAUSED');
  if (paused) return 'PAUSED';
  const met = clocks.find((c) => c.status === 'MET');
  return met ? 'MET' : clocks[0].status;
}

export interface TicketMiniTableProps {
  tickets: Ticket[];
  onSelect?: (ticket: Ticket) => void;
  className?: string;
  empty?: React.ReactNode;
  maxHeight?: string;
}

export function TicketMiniTable({
  tickets,
  onSelect,
  className,
  empty,
  maxHeight,
}: TicketMiniTableProps) {
  const columns: Column<Ticket>[] = [
    {
      key: 'number',
      header: 'Number',
      render: (t) => (
        <span className="font-mono text-xs font-medium text-primary">{t.number}</span>
      ),
      headerClassName: 'w-28',
      className: 'w-28',
    },
    {
      key: 'title',
      header: 'Title',
      render: (t) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="font-medium text-sm truncate">{t.title}</div>
          {t.serviceName && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {t.serviceName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => (
        <Badge
          variant="outline"
          className={cn(
            'font-semibold border text-[11px] tabular-nums',
            PRIORITY_STYLES[t.priority],
          )}
        >
          {TICKET_PRIORITY_SHORT[t.priority]}
        </Badge>
      ),
      headerClassName: 'w-20',
      className: 'w-20',
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <Badge
          variant="outline"
          className={cn(
            'font-medium border text-[11px]',
            STATUS_STYLES[t.status],
          )}
        >
          {TICKET_STATUS_LABELS[t.status]}
        </Badge>
      ),
      headerClassName: 'w-32',
      className: 'w-32',
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (t) => {
        const status = deriveSlaStatus(t.slaClocks);
        if (!status) {
          return <span className="text-[11px] text-muted-foreground">—</span>;
        }
        return <SlaClockBadge status={status} />;
      },
      headerClassName: 'w-28',
      className: 'w-28',
    },
  ];

  return (
    <div className={cn(maxHeight && 'max-h-96 overflow-y-auto scrollbar-thin', className)}>
      <DataTable
        columns={columns}
        rows={tickets}
        onRowClick={onSelect}
        empty={
          empty ?? 'No tickets on this service.'
        }
      />
    </div>
  );
}

export default TicketMiniTable;
