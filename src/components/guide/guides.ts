import type { Role } from '@/lib/types';

// Concise, structured summaries of each uSMS role guide.
// Extracted from the Role_Guide_*_v1_0.txt source files in /upload.
// Source attribution: uSMS Role Guide Suite v1.0 (March 2026).

export interface GuideSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface RoleGuide {
  title: string;
  tagline: string;
  /** Short structural-positioning line shown under the title. */
  layer: string;
  sections: GuideSection[];
}

export const ROLE_GUIDES: Record<Role, RoleGuide> = {
  SERVICE_CUSTOMER: {
    title: 'Service Customer',
    tagline: 'The organizational unit that consumes governed IT services.',
    layer: 'Actor layer · External-facing role of the uSMS model',
    sections: [
      {
        heading: 'Who You Are',
        paragraphs: [
          'A Service Customer is not an individual — it is an organizational unit. A business division, a department, or an external company receiving managed IT services. What defines you is your formal relationship with the IT organization, not your personal title.',
          'That relationship includes a service agreement (which services, at which level, for how many users), budget accountability for the IT spend your unit consumes, user governance (you authorize what your users may access), and escalation authority when commitments are not met.',
        ],
      },
      {
        heading: 'Your Accountability',
        bullets: [
          'Govern how your organizational unit consumes IT services — what is requested, what is approved, what is retired.',
          'Authorize which services your users may access. No user can consume a service your agreement does not cover.',
          'Hold the IT organization accountable for SLA commitments — structurally enforced, not merely promised.',
          'Make formal governance decisions: submit demands, approve or reject quotes, escalate through defined levels.',
        ],
      },
      {
        heading: 'Your Authorities',
        bullets: [
          'Submit a demand for a new service, a modification, or a retirement — routed through your SCM Worker, not engineers.',
          'Approve or reject a quote. Acceptance commits both parties; rejection returns the demand with a documented reason.',
          'Track demand status in real time — you never need to ask where your demand is.',
          'Govern user access within the entitlement model; specific assignments override the unit default, still governed.',
          'Escalate: L1 SCM Worker → L2 CM Leader → L3 Service Owner → L4 Governance Owner.',
        ],
      },
      {
        heading: 'What You Cannot Do',
        bullets: [
          'Submit demands on behalf of another organizational unit — you govern your scope only.',
          'Negotiate directly with engineers, Technical Owners, or Change Enablement. The SCM Worker is your single channel.',
          'Bypass the SCM Worker to chase status. If the portal does not answer, your SCM Worker does.',
          'Access services or data outside your entitlement — entitlement-based rendering, not a permission filter.',
        ],
      },
      {
        heading: 'What Good Looks Like',
        bullets: [
          'You receive honest assessments — redirects and rejections are the system working, not failures.',
          'Your SCM Worker communicates ahead of your need. You do not chase status.',
          'SLA reports contain context — root cause, remediation status — not just numbers.',
          'Breach communications are timely, governed, and meaningful — never a bare timestamp.',
          'Your catalog view reflects your current agreements at all times.',
        ],
      },
    ],
  },

  SCM_WORKER: {
    title: 'SCM Worker',
    tagline: 'The named, personal governance contact for one or more Service Customers.',
    layer: 'Worker layer · Customer Service Management (CSM) function',
    sections: [
      {
        heading: 'Who You Are',
        paragraphs: [
          'You are a Service Customer Manager — the human embodiment of the CSM interface. You are not a ticket processor or demand intake clerk. You are a governance actor who translates between the Service Customer’s business language and the IT organization’s governance structures.',
          'You are the only role that maintains the complete customer relationship thread from demand submission through fulfillment. Every other role touches the demand at a specific point. You are there from the first conversation to the closed record.',
        ],
      },
      {
        heading: 'Your Accountability',
        bullets: [
          'Demand Management — own the end-to-end lifecycle of every active demand for your customers.',
          'Service Catalog Management — keep catalog entries for your customers accurate; trigger changes when reality drifts.',
          'Service Level Management — monitor SLA performance continuously and translate data into customer-relevant communication.',
          'Communication ownership through execution — never hand it off, even when work moves to Change Enablement.',
        ],
      },
      {
        heading: 'Your Authorities',
        bullets: [
          'Create Demand Records on behalf of Service Customers.',
          'Conduct demand assessment and determine outcome (Redirect, Reject, Quote) — subject to CM Leader approval on quotes and rejections.',
          'Prepare quotes for CM Leader review and approval, and record formal customer acceptance.',
          'Submit ProcessHandover records to Change Enablement.',
          'Issue governed SLA communications and produce SLA performance reports (CM Leader reviews before issuance).',
        ],
      },
      {
        heading: 'Your Limits',
        bullets: [
          'You cannot issue quotes without CM Leader approval — every quote is an organizational commitment.',
          'You cannot modify the service catalog directly. Only Change Enablement may write to the catalog (Separation Principle).',
          'You cannot communicate with Technical Owners directly about delivery — that flows through CE.',
          'You cannot serve Service Users in the CSM channel — redirect them to the Service Desk.',
          'You cannot also be the CE Leader for the same service scope (separation of duties).',
        ],
      },
      {
        heading: 'What Good Looks Like',
        bullets: [
          'Every active demand has a documented, current status. No demand stalls without a record.',
          'Quotes are accurate — the IT organization delivers what it quoted.',
          'Communication is ahead of the customer. Your customers do not contact you to ask for status.',
          'SLA warnings are never silent. Every SLAWarning triggers a proactive communication before the breach.',
          'Breach communications contain context — what happened, what is being done, what it means.',
          'Problems are surfaced to your CM Leader before they become external issues.',
        ],
      },
    ],
  },

  CM_LEADER: {
    title: 'CM Leader',
    tagline: 'Operational authority for the Customer Service Management function.',
    layer: 'Leader layer · CSM function · Governance authority above SCM Workers',
    sections: [
      {
        heading: 'Who You Are',
        paragraphs: [
          'You are the Customer Management Leader. You sit in the Leader layer of the SeOS role model, translating Owner intent into organized execution. You manage the operational flow of CSM, hold accountability for throughput and quality, and serve as the governance authority between your SCM Workers and the Service Owner.',
          'CSM is the strategic front-office of uSMS — the only entry point for service demand and the governance interface for SLA commitments. You lead this function operationally. What happens in CSM is your accountability continuously, not when escalation forces it.',
        ],
      },
      {
        heading: 'Your Accountability',
        bullets: [
          'Demand throughput — no demand stalls in UNDER_REVIEW without a documented reason; none stays open past fulfillment.',
          'Assessment quality — the catalog check is the primary governance function of assessment; ensure it is not bypassed.',
          'Quote accuracy — you approve every quote before it reaches a Service Customer.',
          'Customer communication standards — SCM Workers provide status; customers do not chase it.',
          'SLM reporting discipline — reports are accurate, complete, consistent, and reviewed by you before issuance.',
          'Separation of duties — you may not also serve as CE Leader for the same service scope.',
        ],
      },
      {
        heading: 'Your Governance Gates',
        bullets: [
          'Quote Approval (the gate you never skip) — review scope alignment, feasibility, SLA class, cost alignment, and separation of duties. Return with corrections if any gap; never approve under customer pressure.',
          'Rejection Authorization — SCM Workers document rejections; you confirm. Contested rejections escalate to you; commitment disputes go further to the Service Owner.',
          'SLA Report Review Before Issuance — verify accuracy, completeness, and consistency. A report that surprises a customer with an undisclosed breach is an SLM discipline failure.',
        ],
      },
      {
        heading: 'Your Authorities',
        bullets: [
          'Approve quotes before issuance to Service Customers.',
          'Authorize rejection decisions and communicate them.',
          'Assign demands to SCM Workers and manage workload distribution.',
          'Escalate SLA breaches to the Service Owner for Class A and B services — immediately, with full context.',
          'Trigger Service Catalog Management modification workflows when SLA class misalignment is identified.',
          'Authorize exception processes when contractual SLA terms require deviation; report CSM KPIs to the Process Owner.',
        ],
      },
      {
        heading: 'What Good Looks Like',
        bullets: [
          'No demand stalls without a record — the pipeline is visible and current.',
          'No quote is issued without your approval — this gate catches assessment failures.',
          'Service Customers never call to ask for status — SCM Workers communicate ahead of need.',
          'SLA warnings are never silent — your SCM Workers contact customers before the breach.',
          'Breach communications contain root cause context, not just a timestamp.',
          'The Service Owner hears about problems from you, not from Service Customers.',
        ],
      },
    ],
  },

  SERVICE_OWNER: {
    title: 'Service Owner',
    tagline: 'Structural accountability for the value, quality, and SLA commitments of specific services.',
    layer: 'Owner layer · Highest accountability tier in the SeOS role model',
    sections: [
      {
        heading: 'Who You Are',
        paragraphs: [
          'You sit in the Owner layer — the highest accountability tier in uSMS operational governance. The Owner layer does not execute operational work. It holds structural accountability for the integrity, quality, and commitment fulfillment of specific services.',
          'You are accountable for one or more discrete services in the uSeC Service Catalog: their value, quality, SLA commitments, and lifecycle governance. Your accountability is permanent and structural — it does not activate when a ticket is assigned, and it does not pause between incidents.',
          'You are an escalation target, not an operational participant. You are brought in when a decision exceeds the Leader layer’s authority, or when structural commitments are at stake.',
        ],
      },
      {
        heading: 'Your Accountability',
        bullets: [
          'Service value and fitness for purpose — the catalog reflects what is delivered; gaps are governed, not absorbed silently.',
          'SLA commitment quality — the SLA class for your service carries concrete commitments; you are the governance authority that approves them.',
          'Commitment approval at demand acceptance — you approve new services, SLA class changes, scope expansions, and extensions to new customers.',
          'SLA breach response — you make a governance decision: additional resources, emergency change, known-limitation acceptance, or documented remediation. Inaction is not a response.',
          'Service lifecycle governance — you approve retirement and significant evolution of your services.',
          'Catalog accuracy for your services — scope, SLA class, Technical Owner assignments are current.',
        ],
      },
      {
        heading: 'What Service Ownership Is Not',
        bullets: [
          'Not a demand assessment role — that is the SCM Worker. You appear at the commitment approval point.',
          'Not a change execution authority — the CE Leader approves changes; you weigh in on governance dimensions only.',
          'Not the Technical Owner — a separate Owner-layer role for the CIs that compose your service.',
          'Not the customer’s primary contact — that is the SCM Worker. You communicate directly only in high-stakes scenarios.',
          'Not the Service Desk, and not a Process Owner.',
        ],
      },
      {
        heading: 'Your Touchpoints',
        bullets: [
          'Demand Management — commitment approval at acceptance; escalation target for commitment disputes.',
          'Service Level Management — receive breach escalations on Class A/B; quarterly SLA review with the CM Leader.',
          'Change Enablement — consulted on changes that materially affect committed scope or SLA.',
          'Problem Management — receive Problem Record notifications for your services; provide governance framing for decisions.',
        ],
      },
      {
        heading: 'What Good Looks Like',
        bullets: [
          'Every service in your ownership has a current, accurate catalog entry — reviewed within the last quarter.',
          'Every SLA commitment you approved was a commitment that could be kept.',
          'Breach notifications produce governance responses, not documentation — a decision is always made.',
          'The CM Leader escalates to you rarely — not because issues do not exist, but because lower levels have the clarity and authority to resolve them.',
          'Service retirements are clean — with customer acknowledgement, replacement guidance, and a closed governance record.',
          'Your service commitments evolve with the services — you initiate SLA class reviews; you do not wait for breach patterns.',
        ],
      },
    ],
  },
};

export const ROLE_GUIDE_ORDER: Role[] = [
  'SERVICE_CUSTOMER',
  'SCM_WORKER',
  'CM_LEADER',
  'SERVICE_OWNER',
];
