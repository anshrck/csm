import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { serializeGovernanceDecision, errorResponse } from './_serialize';

export const runtime = 'nodejs';

const VALID_DECISION_TYPES = new Set([
  'COMMITMENT_APPROVAL',
  'COMMITMENT_ESCALATION',
  'BREACH_RESPONSE',
  'LIFECYCLE_DIRECTION',
  'CATALOG_ACCURACY',
]);

const VALID_DECISIONS = new Set([
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'REMEDIATION_AUTHORIZED',
  'RESOURCES_AUTHORIZED',
  'EMERGENCY_CHANGE_DIRECTED',
]);

// GET /api/governance-decisions — list with filters + role-based scoping.
// Query params: serviceId, demandId, decisionType.
// Role scoping:
//   CM_LEADER        → all decisions.
//   SERVICE_OWNER    → only decisions on services they own.
//   SCM_WORKER       → decisions whose demandId is one of their assigned
//                      demands.
//   SERVICE_CUSTOMER → not in scope (decisions are internal governance).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // SERVICE_CUSTOMER has no business reading governance decisions.
    if (session.role === 'SERVICE_CUSTOMER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const serviceId = sp.get('serviceId') ?? undefined;
    const demandId = sp.get('demandId') ?? undefined;
    const decisionType = sp.get('decisionType') ?? undefined;

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (serviceId) and.push({ serviceId });
    if (demandId) and.push({ demandId });
    if (decisionType) and.push({ decisionType });

    if (session.role === 'SERVICE_OWNER') {
      // Restrict to services the caller owns (serviceOwnerId is a plain String
      // foreign key on the Service table — no Prisma relation).
      const owned = await db.service.findMany({
        where: { serviceOwnerId: session.id },
        select: { id: true },
      });
      const ownedIds = owned.map((s) => s.id);
      and.push({ serviceId: { in: ownedIds.length ? ownedIds : ['__none__'] } });
    } else if (session.role === 'SCM_WORKER') {
      const assigned = await db.demand.findMany({
        where: { assignedScmWorkerId: session.id },
        select: { id: true },
      });
      const assignedIds = assigned.map((d) => d.id);
      and.push({ demandId: { in: assignedIds.length ? assignedIds : ['__none__'] } });
    }
    // CM_LEADER: no extra scoping.

    if (and.length === 0) delete where.AND;

    const rows = await db.governanceDecision.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(rows.map(serializeGovernanceDecision));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/governance-decisions — create a governance decision.
// Role: SERVICE_OWNER only (must own the service referenced).
// Body: { serviceId, demandId?, slaEventId?, problemId?, decisionType,
//         decision, rationale, resourcesAuthorized?, followUpOwner?,
//         followUpDate? }
// Side effects:
//   - if COMMITMENT_APPROVAL + demandId → notify demand.assignedScmWorkerId
//     + the customer's SERVICE_CUSTOMER users with 'CommitmentApproved' or
//     'CommitmentRejected'.
//   - if BREACH_RESPONSE + slaEventId → notify all CM_LEADER users
//     ('BreachResponded').
//   - if decision=ESCALATED → notify all CM_LEADER + SERVICE_OWNER users
//     ('CommitmentEscalated').
//   - if demandId + decision=APPROVED → set demand.commitmentNotes.
//   - if demandId → create DemandEvent (eventType 'COMMENT') describing the
//     governance decision.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole('SERVICE_OWNER' as Role);

    const body = await req.json().catch(() => ({}));

    const serviceId =
      typeof body.serviceId === 'string' ? body.serviceId.trim() : '';
    if (!serviceId) {
      return NextResponse.json({ error: 'serviceId is required' }, { status: 400 });
    }
    const service = await db.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, serviceOwnerId: true },
    });
    if (!service) {
      return NextResponse.json({ error: 'serviceId not found' }, { status: 400 });
    }
    if (service.serviceOwnerId !== session.id) {
      return NextResponse.json(
        { error: 'You can only record governance decisions for services you own' },
        { status: 403 },
      );
    }

    const decisionType =
      typeof body.decisionType === 'string' ? body.decisionType.trim() : '';
    if (!VALID_DECISION_TYPES.has(decisionType)) {
      return NextResponse.json(
        { error: 'decisionType must be one of COMMITMENT_APPROVAL | COMMITMENT_ESCALATION | BREACH_RESPONSE | LIFECYCLE_DIRECTION | CATALOG_ACCURACY' },
        { status: 400 },
      );
    }
    const decision =
      typeof body.decision === 'string' ? body.decision.trim() : '';
    if (!VALID_DECISIONS.has(decision)) {
      return NextResponse.json(
        { error: 'decision must be one of APPROVED | REJECTED | ESCALATED | REMEDIATION_AUTHORIZED | RESOURCES_AUTHORIZED | EMERGENCY_CHANGE_DIRECTED' },
        { status: 400 },
      );
    }
    const rationale =
      typeof body.rationale === 'string' ? body.rationale.trim() : '';
    if (!rationale) {
      return NextResponse.json({ error: 'rationale is required' }, { status: 400 });
    }

    const demandId =
      typeof body.demandId === 'string' && body.demandId.trim()
        ? body.demandId.trim()
        : null;
    const slaEventId =
      typeof body.slaEventId === 'string' && body.slaEventId.trim()
        ? body.slaEventId.trim()
        : null;
    const problemId =
      typeof body.problemId === 'string' && body.problemId.trim()
        ? body.problemId.trim()
        : null;
    const resourcesAuthorized =
      typeof body.resourcesAuthorized === 'string' && body.resourcesAuthorized.trim()
        ? body.resourcesAuthorized.trim()
        : null;
    const followUpOwner =
      typeof body.followUpOwner === 'string' && body.followUpOwner.trim()
        ? body.followUpOwner.trim()
        : null;
    const followUpDate =
      typeof body.followUpDate === 'string' && body.followUpDate.trim()
        ? new Date(body.followUpDate)
        : null;
    if (followUpDate && Number.isNaN(followUpDate.getTime())) {
      return NextResponse.json(
        { error: 'followUpDate must be a valid ISO date' },
        { status: 400 },
      );
    }

    // Validate the optional foreign keys.
    let demand: { id: string; title: string; assignedScmWorkerId: string | null; serviceCustomerId: string } | null = null;
    if (demandId) {
      demand = await db.demand.findUnique({
        where: { id: demandId },
        select: {
          id: true,
          title: true,
          assignedScmWorkerId: true,
          serviceCustomerId: true,
        },
      });
      if (!demand) {
        return NextResponse.json({ error: 'demandId not found' }, { status: 400 });
      }
    }
    if (slaEventId) {
      const e = await db.slaEvent.findUnique({ where: { id: slaEventId }, select: { id: true } });
      if (!e) return NextResponse.json({ error: 'slaEventId not found' }, { status: 400 });
    }
    if (problemId) {
      const p = await db.problem.findUnique({ where: { id: problemId }, select: { id: true } });
      if (!p) return NextResponse.json({ error: 'problemId not found' }, { status: 400 });
    }

    const created = await db.governanceDecision.create({
      data: {
        serviceId,
        demandId,
        slaEventId,
        problemId,
        decisionType,
        decision,
        rationale,
        resourcesAuthorized,
        followUpOwner,
        followUpDate,
        decidedById: session.id,
        decidedByName: session.name,
      },
    });

    const now = created.createdAt;

    // Record a DemandEvent for traceability (COMMENT type, governance note).
    if (demand) {
      const eventNotes = `Governance decision recorded by Service Owner ${session.name} (${decisionType} → ${decision}): ${rationale}`;
      await db.demandEvent.create({
        data: {
          demandId: demand.id,
          eventType: 'COMMENT',
          actorId: session.id,
          actorName: session.name,
          notes: eventNotes,
          createdAt: now,
        },
      });

      // If APPROVED, set the demand's commitmentNotes (governance-authorised
      // commitment terms). Other decisions don't touch commitmentNotes.
      if (decision === 'APPROVED') {
        await db.demand.update({
          where: { id: demand.id },
          data: { commitmentNotes: rationale },
        });
      }
    }

    // ---- Notifications ----

    // COMMITMENT_APPROVAL + demandId → notify the assigned SCM worker and the
    // customer's SERVICE_CUSTOMER users (CommitmentApproved / CommitmentRejected).
    if (decisionType === 'COMMITMENT_APPROVAL' && demand) {
      const notifType = decision === 'APPROVED' ? 'CommitmentApproved' : 'CommitmentRejected';
      const notifTitle =
        decision === 'APPROVED'
          ? 'Service commitment approved'
          : 'Service commitment rejected';
      const notifMessage = `Service Owner ${session.name} ${decision === 'APPROVED' ? 'approved' : 'rejected'} the commitment for demand "${demand.title}". Rationale: ${rationale}`;

      const targets: { id: string }[] = [];
      if (demand.assignedScmWorkerId) {
        targets.push({ id: demand.assignedScmWorkerId });
      }
      const customerUsers = await db.user.findMany({
        where: {
          role: 'SERVICE_CUSTOMER',
          orgNodeId: demand.serviceCustomerId,
        },
        select: { id: true },
      });
      for (const u of customerUsers) {
        if (!targets.find((t) => t.id === u.id)) targets.push(u);
      }
      if (targets.length) {
        await db.notification.createMany({
          data: targets.map((u) => ({
            userId: u.id,
            type: notifType,
            title: notifTitle,
            message: notifMessage,
            entityRef: `governance-decision:${created.id}`,
            createdAt: now,
          })),
        });
      }
    }

    // BREACH_RESPONSE + slaEventId → notify all CM_LEADER users (BreachResponded).
    if (decisionType === 'BREACH_RESPONSE' && slaEventId) {
      const cmLeaders = await db.user.findMany({
        where: { role: 'CM_LEADER' },
        select: { id: true },
      });
      if (cmLeaders.length) {
        await db.notification.createMany({
          data: cmLeaders.map((u) => ({
            userId: u.id,
            type: 'BreachResponded',
            title: 'Breach response recorded',
            message: `Service Owner ${session.name} recorded a breach response (${decision}) on service "${service.name}". Rationale: ${rationale}`,
            entityRef: `governance-decision:${created.id}`,
            createdAt: now,
          })),
        });
      }
    }

    // ESCALATED → notify all CM_LEADER + SERVICE_OWNER users (CommitmentEscalated).
    if (decision === 'ESCALATED') {
      const escalationTargets = await db.user.findMany({
        where: {
          role: { in: ['CM_LEADER', 'SERVICE_OWNER'] },
        },
        select: { id: true },
      });
      if (escalationTargets.length) {
        await db.notification.createMany({
          data: escalationTargets.map((u) => ({
            userId: u.id,
            type: 'CommitmentEscalated',
            title: 'Commitment escalated',
            message: `Service Owner ${session.name} escalated a governance decision (${decisionType}) on service "${service.name}". Rationale: ${rationale}`,
            entityRef: `governance-decision:${created.id}`,
            createdAt: now,
          })),
        });
      }
    }

    return NextResponse.json(serializeGovernanceDecision(created), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
