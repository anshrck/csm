import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  computeOperationalReport,
  parseRange,
  type OperationalReport,
} from '../_compute';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';

// Report sections that can be exported individually.
type ReportKey =
  | 'ticketVolume'
  | 'slaCompliance'
  | 'avgResponseTime'
  | 'avgResolutionTime'
  | 'backlogAging'
  | 'reopenRate'
  | 'csatTrend'
  | 'workerWorkload'
  | 'demandConversion'
  | 'all';

const VALID_REPORTS: ReportKey[] = [
  'ticketVolume',
  'slaCompliance',
  'avgResponseTime',
  'avgResolutionTime',
  'backlogAging',
  'reopenRate',
  'csatTrend',
  'workerWorkload',
  'demandConversion',
  'all',
];

// ---- CSV helpers ------------------------------------------------------------

/** Quote a CSV cell per RFC 4180: wrap in quotes, double internal quotes. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const headerLine = headers.map(csvCell).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => csvCell(row[h])).join(','),
  );
  return [headerLine, ...dataLines].join('\r\n') + '\r\n';
}

// ---- Projection: flatten a report section into tabular rows ----------------

interface Projection {
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

function projectTicketVolume(r: OperationalReport): Projection {
  const rows: Array<Record<string, unknown>> = [];
  for (const b of r.ticketVolume.byCustomer) {
    rows.push({ dimension: 'byCustomer', key: b.key ?? '', label: b.label, count: b.count });
  }
  for (const b of r.ticketVolume.byService) {
    rows.push({ dimension: 'byService', key: b.key ?? '', label: b.label, count: b.count });
  }
  for (const b of r.ticketVolume.byPriority) {
    rows.push({ dimension: 'byPriority', key: b.key ?? '', label: b.label, count: b.count });
  }
  return { headers: ['dimension', 'key', 'label', 'count'], rows };
}

function projectSlaCompliance(r: OperationalReport): Projection {
  return {
    headers: ['serviceId', 'serviceName', 'total', 'met', 'breached', 'compliancePct'],
    rows: r.slaCompliance.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName ?? '',
      total: s.total,
      met: s.met,
      breached: s.breached,
      compliancePct: s.compliancePct,
    })),
  };
}

function projectAvgResponseTime(r: OperationalReport): Projection {
  return {
    headers: ['avgResponseTimeMins'],
    rows: [{ avgResponseTimeMins: r.avgResponseTimeMins ?? '' }],
  };
}

function projectAvgResolutionTime(r: OperationalReport): Projection {
  return {
    headers: ['avgResolutionTimeMins'],
    rows: [{ avgResolutionTimeMins: r.avgResolutionTimeMins ?? '' }],
  };
}

function projectBacklogAging(r: OperationalReport): Projection {
  return {
    headers: ['bucket', 'count'],
    rows: r.backlogAging.map((b) => ({ bucket: b.bucket, count: b.count })),
  };
}

function projectReopenRate(r: OperationalReport): Projection {
  return {
    headers: ['reopened', 'totalClosed', 'ratePct'],
    rows: [
      {
        reopened: r.reopenRate.reopened,
        totalClosed: r.reopenRate.totalClosed,
        ratePct: r.reopenRate.ratePct,
      },
    ],
  };
}

function projectCsatTrend(r: OperationalReport): Projection {
  return {
    headers: ['week', 'avgRating', 'responses'],
    rows: r.csatTrend.map((c) => ({
      week: c.week,
      avgRating: c.avgRating,
      responses: c.responses,
    })),
  };
}

function projectWorkerWorkload(r: OperationalReport): Projection {
  return {
    headers: ['workerId', 'workerName', 'activeTickets', 'activeDemands'],
    rows: r.workerWorkload.map((w) => ({
      workerId: w.workerId,
      workerName: w.workerName,
      activeTickets: w.activeTickets,
      activeDemands: w.activeDemands,
    })),
  };
}

function projectDemandConversion(r: OperationalReport): Projection {
  return {
    headers: ['total', 'reachedInChange', 'conversionPct'],
    rows: [
      {
        total: r.demandConversion.total,
        reachedInChange: r.demandConversion.reachedInChange,
        conversionPct: r.demandConversion.conversionPct,
      },
    ],
  };
}

const PROJECTORS: Record<
  Exclude<ReportKey, 'all'>,
  (r: OperationalReport) => Projection
> = {
  ticketVolume: projectTicketVolume,
  slaCompliance: projectSlaCompliance,
  avgResponseTime: projectAvgResponseTime,
  avgResolutionTime: projectAvgResolutionTime,
  backlogAging: projectBacklogAging,
  reopenRate: projectReopenRate,
  csatTrend: projectCsatTrend,
  workerWorkload: projectWorkerWorkload,
  demandConversion: projectDemandConversion,
};

// ---- Handler ----------------------------------------------------------------

/**
 * GET /api/reports/export
 *
 * Export a single operational-report section as CSV or JSON.
 *
 * Query params:
 *   format — "csv" (default) | "json"
 *   report — one of VALID_REPORTS (default: "all")
 *   from   — ISO date (inclusive)
 *   to     — ISO date (inclusive)
 *
 * Role scoping: CM_LEADER, SERVICE_OWNER only.
 *
 * CSV format uses RFC 4180 quoting / CRLF line endings. JSON format returns
 * the selected section as a JSON document. `report=all` is JSON-only (CSV
 * would lose the multi-section structure).
 */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole('CM_LEADER' as Role, 'SERVICE_OWNER' as Role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    if (msg === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const formatParam = (sp.get('format') ?? 'csv').toLowerCase();
  const reportParam = (sp.get('report') ?? 'all') as ReportKey;

  if (!VALID_REPORTS.includes(reportParam)) {
    return NextResponse.json(
      { error: `report must be one of: ${VALID_REPORTS.join(', ')}` },
      { status: 400 },
    );
  }
  if (formatParam !== 'csv' && formatParam !== 'json') {
    return NextResponse.json(
      { error: 'format must be "csv" or "json"' },
      { status: 400 },
    );
  }
  if (reportParam === 'all' && formatParam === 'csv') {
    return NextResponse.json(
      { error: 'report=all is JSON-only — use format=json' },
      { status: 400 },
    );
  }

  const range = parseRange(sp);
  const report = await computeOperationalReport(session, range);

  // ---- JSON branch ----
  if (formatParam === 'json') {
    if (reportParam === 'all') {
      return NextResponse.json(report, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="operational-report.json"`,
        },
      });
    }
    const section = report[reportParam];
    return NextResponse.json(section, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${reportParam}.json"`,
      },
    });
  }

  // ---- CSV branch ----
  const projection = PROJECTORS[reportParam as Exclude<ReportKey, 'all'>](report);
  const csv = toCsv(projection.headers, projection.rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportParam}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
