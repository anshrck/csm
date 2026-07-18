// Reusable Zod validation schemas for CereBree uSMS API routes.
//
// Centralising these schemas keeps request-body validation consistent across
// every route handler and gives a single source of truth for what shape each
// API contract expects. Each schema is intentionally permissive about extra
// fields (Zod's default `strip` behaviour) so unknown keys never cause a 400.
//
// Usage in a route handler:
//   const parsed = validateBody(loginSchema, body);
//   if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });
//   // parsed.data is now typed as the schema's inferred type.

import { z } from 'zod';

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ---- Demands ----
export const demandCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  businessJustification: z.string().optional(),
  desiredTimeline: z.string().optional(),
  relatedServiceIds: z.array(z.string()).optional(),
  serviceCustomerId: z.string().optional(),
});

// ---- Tickets (Phase 2) ----
export const ticketCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  type: z.enum(['INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT']),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  serviceId: z.string().optional(),
  serviceCustomerId: z.string(),
});

// ---- Threaded comments (Phase 4) ----
export const commentSchema = z.object({
  body: z.string().min(1),
  visibility: z.enum(['CUSTOMER_VISIBLE', 'INTERNAL']),
});

// ---- CSAT surveys (Phase 4) ----
export const surveySchema = z.object({
  entityType: z.enum(['TICKET', 'DEMAND']),
  entityId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

// ---- Governance decisions (Service Owner) ----
export const governanceDecisionSchema = z.object({
  serviceId: z.string(),
  demandId: z.string().optional(),
  slaEventId: z.string().optional(),
  decisionType: z.string(),
  decision: z.string(),
  rationale: z.string().min(1),
  resourcesAuthorized: z.string().optional(),
  followUpOwner: z.string().optional(),
  followUpDate: z.string().optional(),
});

// ---- Knowledge Base articles (Phase 5) ----
export const knowledgeArticleSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  type: z.enum(['HOW_TO', 'KNOWN_ERROR', 'FAQ', 'RUNBOOK']),
  serviceId: z.string().optional(),
  status: z.string().optional(),
});

// ---- Helper: validate an unknown body against a schema ----
//
// Returns a discriminated union — `success: true` with the typed `data`, or
// `success: false` with a single human-readable `error` string (joined from
// Zod's flattened issue list so the API consumer gets one message per call
// instead of a raw ZodError tree).
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Flatten Zod errors into a single ';'-joined message. Each issue becomes
  // `path: message` (e.g. `email: Invalid email address`); empty paths (common
  // for missing required roots) collapse to just the message.
  const parts = result.error.issues.map((iss) => {
    const path = iss.path.length > 0 ? iss.path.join('.') : '';
    return path ? `${path}: ${iss.message}` : iss.message;
  });
  return { success: false, error: parts.join('; ') };
}
