import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { SessionUser } from '@/lib/types';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';

// --- Currency helper ----------------------------------------------------
function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return '€' + n.toLocaleString('en-IE', { maximumFractionDigits: 0 });
}

// --- Role-scoped context builders --------------------------------------
// Each builder returns a concise structured text block describing the user's
// live portfolio. Queries are deliberately lightweight (counts + a handful
// of records) so we never dump entire tables into the prompt.

async function buildCustomerContext(session: any): Promise<string> {
  const orgId = session.orgNodeId;
  if (!orgId) return 'No organizational unit is linked to your account.';
  const tenantId = session.actorContext?.tenantId || 'default-tenant';

  // Demands for this customer org
  const demands = await db.demand.findMany({
    where: { tenantId, serviceCustomerId: orgId },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      estimatedCost: true,
      estimatedEffortDays: true,
      assignedScmWorkerId: true,
      quoteApprovedByCmLeader: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const byStatus: Record<string, number> = {};
  for (const d of demands) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const countSummary = Object.entries(byStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  // Entitled services (via offerings → service)
  const entitlements = await db.entitlement.findMany({
    where: { tenantId, orgNodeId: orgId },
    include: { offering: { include: { service: { select: { id: true, name: true, slaClass: true, status: true } } } } },
    take: 100,
  });
  const services = new Map<string, { name: string; slaClass: string; status: string }>();
  for (const e of entitlements) {
    const svc = e.offering.service;
    if (!services.has(svc.id)) services.set(svc.id, { name: svc.name, slaClass: svc.slaClass, status: svc.status });
  }

  // SLA events affecting this customer
  const slaEvents = await db.slaEvent.findMany({
    where: { tenantId, serviceCustomerId: orgId },
    include: { service: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  const breaches = slaEvents.filter((e) => e.eventType === 'BREACHED').length;
  const warnings = slaEvents.filter((e) => e.eventType === 'WARNING').length;

  const lines: string[] = [];
  lines.push(`Demands: ${demands.length} total (${countSummary || 'none'}).`);
  if (demands.length > 0) {
    lines.push('Recent demands (most recent first):');
    for (const d of demands.slice(0, 8)) {
      const cost = d.estimatedCost ? `, est. ${money(d.estimatedCost)}` : '';
      const effort = d.estimatedEffortDays ? `, ${d.estimatedEffortDays}d effort` : '';
      lines.push(`  - "${d.title}" [${d.status}]${cost}${effort}`);
    }
  }
  lines.push(`Entitled services: ${services.size}`);
  for (const s of services.values()) {
    lines.push(`  - ${s.name} (Class ${s.slaClass}, ${s.status})`);
  }
  lines.push(`SLA events in your scope (recent): ${breaches} breaches, ${warnings} warnings.`);
  for (const e of slaEvents.slice(0, 6)) {
    lines.push(`  - [${e.eventType}] ${e.service.name}: ${e.message}`);
  }
  return lines.join('\n');
}

async function buildScmWorkerContext(session: any): Promise<string> {
  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  const assigned = await db.demand.findMany({
    where: { tenantId, assignedScmWorkerId: session.id },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      estimatedCost: true,
      quoteApprovedByCmLeader: true,
      relatedServiceIds: true,
      customer: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });

  const unassigned = await db.demand.findMany({
    where: { tenantId, assignedScmWorkerId: null, status: 'NEW' },
    select: { id: true, title: true, createdAt: true, customer: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });

  // Collect service IDs and customer orgs from assigned demands
  const serviceIds = new Set<string>();
  const customerOrgs = new Set<string>();
  for (const d of assigned) {
    customerOrgs.add(d.customer.name);
    try {
      const ids = JSON.parse(d.relatedServiceIds || '[]');
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') serviceIds.add(id);
    } catch {
      /* ignore */
    }
  }

  // SLA events on services in scope
  const slaEvents =
    serviceIds.size > 0
      ? await db.slaEvent.findMany({
          where: { tenantId, serviceId: { in: [...serviceIds] } },
          include: { service: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        })
      : [];

  // Active changes this worker coordinates (as CE worker)
  const activeChanges = await db.change.findMany({
    where: { tenantId, assignedCeWorkerId: session.id, status: { notIn: ['CLOSED', 'REJECTED'] } },
    select: { id: true, title: true, status: true, type: true, complexity: true },
    take: 12,
  });

  // Counts
  const byStatus: Record<string, number> = {};
  for (const d of assigned) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const countSummary = Object.entries(byStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const awaitingCm = assigned.filter((d) => d.status === 'UNDER_REVIEW' && !d.quoteApprovedByCmLeader).length;
  const awaitingCustomer = assigned.filter((d) => d.status === 'QUOTED').length;
  const acceptedNeedChange = assigned.filter((d) => d.status === 'ACCEPTED').length;

  const lines: string[] = [];
  lines.push(`Demands assigned to you: ${assigned.length} (${countSummary || 'none'}).`);
  lines.push(`Unassigned NEW demands in the queue: ${unassigned.length}.`);
  if (unassigned.length > 0) {
    lines.push('Recent unassigned demands:');
    for (const d of unassigned) lines.push(`  - "${d.title}" from ${d.customer.name}`);
  }
  lines.push(`Customer orgs you serve: ${[...customerOrgs].join(', ') || 'none'}.`);
  lines.push(`Action needed — awaiting CM Leader quote approval: ${awaitingCm}.`);
  lines.push(`Action needed — awaiting customer accept/decline: ${awaitingCustomer}.`);
  lines.push(`Action needed — accepted demands needing a Change Request: ${acceptedNeedChange}.`);
  if (assigned.length > 0) {
    lines.push('Demands you own (most recently updated first):');
    for (const d of assigned.slice(0, 8)) {
      const cost = d.estimatedCost ? `, est. ${money(d.estimatedCost)}` : '';
      lines.push(`  - "${d.title}" from ${d.customer.name} [${d.status}]${cost}`);
    }
  }
  lines.push(`Active changes you coordinate (as CE worker): ${activeChanges.length}`);
  for (const c of activeChanges.slice(0, 6)) {
    lines.push(`  - "${c.title}" [${c.status}, ${c.type}${c.complexity ? `, ${c.complexity}` : ''}]`);
  }
  if (slaEvents.length > 0) {
    const sb = slaEvents.filter((e) => e.eventType === 'BREACHED').length;
    const sw = slaEvents.filter((e) => e.eventType === 'WARNING').length;
    lines.push(`SLA events in your scope (recent): ${sb} breaches, ${sw} warnings.`);
    for (const e of slaEvents.slice(0, 6)) {
      lines.push(`  - [${e.eventType}] ${e.service.name}: ${e.message}`);
    }
  } else {
    lines.push('SLA events in your scope: none in the recent window.');
  }
  return lines.join('\n');
}

async function buildCmLeaderContext(session: any): Promise<string> {
  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  // Full demand picture
  const allDemands = await db.demand.findMany({
    where: { tenantId },
    select: {
      id: true,
      title: true,
      status: true,
      estimatedCost: true,
      assignedScmWorkerId: true,
      quoteApprovedByCmLeader: true,
      updatedAt: true,
      customer: { select: { name: true } },
    },
    take: 300,
  });
  const byStatus: Record<string, number> = {};
  for (const d of allDemands) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const countSummary = Object.entries(byStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const unassignedNew = allDemands.filter((d) => d.status === 'NEW' && !d.assignedScmWorkerId);
  const pendingApprovals = allDemands.filter((d) => d.status === 'UNDER_REVIEW' && !d.quoteApprovedByCmLeader);

  // Open SLA breaches
  const slaBreaches = await db.slaEvent.findMany({
    where: { tenantId, eventType: 'BREACHED', resolvedAt: null },
    include: { service: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  // SCM worker workload
  const workers = await db.user.findMany({
    where: { role: 'SCM_WORKER' },
    select: {
      id: true,
      name: true,
      assignedDemands: { select: { id: true, status: true } },
    },
  });

  // Active changes
  const activeChangesCount = await db.change.count({
    where: { tenantId, status: { notIn: ['CLOSED', 'REJECTED'] } },
  });

  const lines: string[] = [];
  lines.push(`Total demands in the system: ${allDemands.length} (${countSummary}).`);
  lines.push(`Unassigned NEW demands awaiting assignment: ${unassignedNew.length}.`);
  if (unassignedNew.length > 0) {
    lines.push('Most recent unassigned:');
    for (const d of unassignedNew.slice(0, 6)) lines.push(`  - "${d.title}" from ${d.customer.name}`);
  }
  lines.push(`Pending quote approvals (UNDER_REVIEW, not yet approved by you): ${pendingApprovals.length}.`);
  if (pendingApprovals.length > 0) {
    lines.push('Demands awaiting your quote approval:');
    for (const d of pendingApprovals.slice(0, 8)) {
      const cost = d.estimatedCost ? `, est. ${money(d.estimatedCost)}` : '';
      lines.push(`  - "${d.title}" from ${d.customer.name}${cost}`);
    }
  }
  lines.push(`Unresolved SLA breaches: ${slaBreaches.length}.`);
  for (const b of slaBreaches.slice(0, 8)) lines.push(`  - ${b.service.name}: ${b.message}`);
  lines.push('SCM Worker workload (open = not CLOSED/REJECTED/FULFILLED):');
  for (const w of workers) {
    const open = w.assignedDemands.filter((d) => !['CLOSED', 'REJECTED', 'FULFILLED'].includes(d.status)).length;
    lines.push(`  - ${w.name}: ${w.assignedDemands.length} total, ${open} open.`);
  }
  lines.push(`Active change requests (not CLOSED/REJECTED): ${activeChangesCount}.`);
  return lines.join('\n');
}

async function buildServiceOwnerContext(session: any): Promise<string> {
  const tenantId = session.actorContext?.tenantId || 'default-tenant';
  const services = await db.service.findMany({
    where: { tenantId, serviceOwnerId: session.id },
    select: { id: true, name: true, slaClass: true, status: true, chapter: true, domain: true },
  });
  const serviceIds = services.map((s) => s.id);

  // SLA events on my services
  const slaEvents =
    serviceIds.length > 0
      ? await db.slaEvent.findMany({
          where: { tenantId, serviceId: { in: serviceIds } },
          include: { service: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : [];

  // Open problems on my services
  const problems =
    serviceIds.length > 0
      ? await db.problem.findMany({
          where: { tenantId, serviceId: { in: serviceIds }, status: { notIn: ['CLOSED'] } },
          select: { id: true, title: true, status: true, serviceId: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        })
      : [];

  // Pending governance: ACCEPTED / IN_CHANGE demands touching my services
  const candidateDemands =
    serviceIds.length > 0
      ? await db.demand.findMany({
          where: { tenantId, status: { in: ['ACCEPTED', 'IN_CHANGE'] } },
          select: {
            id: true,
            title: true,
            status: true,
            relatedServiceIds: true,
            customer: { select: { name: true } },
          },
          take: 200,
        })
      : [];
  const onMyServices = candidateDemands.filter((d) => {
    try {
      const ids = JSON.parse(d.relatedServiceIds || '[]');
      return Array.isArray(ids) && ids.some((id: unknown) => typeof id === 'string' && serviceIds.includes(id));
    } catch {
      return false;
    }
  });

  const lines: string[] = [];
  lines.push(`Services you own: ${services.length}`);
  for (const s of services) {
    lines.push(`  - ${s.name} (Class ${s.slaClass}, ${s.status}, ${s.chapter})`);
  }
  const breaches = slaEvents.filter((e) => e.eventType === 'BREACHED').length;
  const warnings = slaEvents.filter((e) => e.eventType === 'WARNING').length;
  lines.push(`SLA events on your services (recent): ${breaches} breaches, ${warnings} warnings.`);
  for (const e of slaEvents.slice(0, 8)) {
    lines.push(`  - [${e.eventType}] ${e.service.name}: ${e.message}`);
  }
  lines.push(`Open problems on your services: ${problems.length}`);
  for (const p of problems.slice(0, 8)) {
    const svc = services.find((s) => s.id === p.serviceId)?.name ?? 'service';
    lines.push(`  - "${p.title}" on ${svc} [${p.status}]`);
  }
  lines.push(`Pending governance demands (ACCEPTED/IN_CHANGE touching your services): ${onMyServices.length}`);
  for (const d of onMyServices.slice(0, 8)) {
    lines.push(`  - "${d.title}" [${d.status}] from ${d.customer.name}`);
  }
  return lines.join('\n');
}

// --- System prompt assembly ---------------------------------------------
function buildSystemPrompt(session: SessionUser, context: string): string {
  return `You are Cogni, the operational intelligence assistant for the CereBree uSMS (Universal Service Management System) platform.

You are assisting: ${session.name}
Role: ${session.role}
Title: ${session.title ?? 'n/a'}
Organizational unit: ${session.orgNodeName ?? 'n/a'}

The uSMS demand lifecycle is:
  NEW → UNDER_REVIEW → QUOTED → ACCEPTED → IN_CHANGE → FULFILLED → CLOSED
  (Rejection and redirect are terminal paths. QUOTED requires CM Leader sign-off first.)

Your job: give concise, role-appropriate, data-grounded answers about the user's actual portfolio — demands, services, SLA events, governance state, and active changes. Reference the real records supplied in the context below. Offer governance-oriented guidance aligned with the uSMS lifecycle and the user's role.

Behavioural rules:
- Answer concisely in plain language. Prefer short paragraphs or tight bullet lists.
- Reference the user's actual data — titles, statuses, counts, costs. Never invent records, IDs, statuses, dates, or numbers that are not present in the context.
- If asked to perform an action (approve a quote, reject a demand, create a change, mark fulfilled, close, etc.), explain the next step the user should take in the platform — do NOT claim to have executed it.
- If the question is out of scope (not about the user's uSMS portfolio or operations), politely redirect.
- If the context does not contain enough information to answer accurately, say so and suggest where to look.

CONTEXT — current portfolio snapshot for ${session.name}:
${context}
`;
}

// --- POST handler -------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const message = (body?.message ?? '').toString().trim();
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  if (message.length > 2000) {
    return NextResponse.json({ error: 'Message is too long (max 2000 characters)' }, { status: 400 });
  }

  // Build role-scoped context (fail-safe — never let a DB error kill the chat)
  let context = 'Context unavailable at this time.';
  try {
    switch (session.role) {
      case 'SERVICE_CUSTOMER':
        context = await buildCustomerContext(session);
        break;
      case 'SCM_WORKER':
        context = await buildScmWorkerContext(session);
        break;
      case 'CM_LEADER':
        context = await buildCmLeaderContext(session);
        break;
      case 'SERVICE_OWNER':
        context = await buildServiceOwnerContext(session);
        break;
      default:
        context = `Role ${session.role} has no specific context configured.`;
    }
  } catch (err) {
    console.error('[api/ai] context build failed:', err);
  }

  const systemPrompt = buildSystemPrompt(session, context);

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.4,
      stream: false,
      thinking: { type: 'disabled' },
    });
    const reply = completion?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: 'Cogni returned an empty response. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[api/ai] LLM call failed:', err?.message ?? err);
    return NextResponse.json(
      { error: 'Cogni is unavailable right now. Please try again shortly.' },
      { status: 500 },
    );
  }
}
