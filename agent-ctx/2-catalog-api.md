# Task 2 — Catalog API Agent

**Task ID:** 2
**Agent:** Catalog API (services, offerings, SLA profiles, entitlements)
**Owner files:**
- `src/app/api/services/_serialize.ts` (shared helper: `serializeService`, `serializeOffering`, `serializeSlaProfile`, `buildOwnerMap`)
- `src/app/api/services/route.ts` — GET (list, filtered)
- `src/app/api/services/[id]/route.ts` — GET (single with offerings + slaProfile + slaEvent context)
- `src/app/api/offerings/route.ts` — GET (list, optionally entitlement-filtered)
- `src/app/api/entitlements/route.ts` — GET (caller's orgNode entitlements)

## Routes summary

### GET /api/services
Query params: `domain`, `slaClass`, `status` (default `ACTIVE`, `ALL` disables), `owner=me`, `q`, `entitled=1`.
- `owner=me` sets `serviceOwnerId = session.id` (intended for SERVICE_OWNER portfolio view).
- `entitled=1` resolves the caller's orgNode entitlements → offerings → distinct serviceIds, then filters by `id IN (...)`. Returns `[]` early if caller has no orgNode or no entitlements.
- `q` is a JS-level case-insensitive search on name+description (SQLite has no `mode: 'insensitive'`).
- Always includes `offerings[]` (ordered by name) and the primary `slaProfile` (first by createdAt).
- `serviceOwnerName` / `technicalOwnerName` resolved in bulk via `buildOwnerMap` (no Prisma relation on `Service.serviceOwnerId` / `technicalOwnerId`).
- Returns `Service[]`.

### GET /api/services/[id]
- Includes only **active** offerings, the primary SLA profile, and `slaEvents` (id + eventType) for context.
- Adds `slaEventCount` and `slaEventsByType: { WARNING, BREACHED, CLOSED_IN_TIME }` to the response.
- 404 if not found.

### GET /api/offerings
Query params: `serviceId`, `entitled=1`.
- `entitled=1` filters to offerings entitled to caller's orgNode; returns `[]` early if caller has no orgNode.
- Joins `service.name` as `serviceName`.
- Returns `ServiceOffering[]`.

### GET /api/entitlements
- Returns caller's orgNode entitlements joined with offering + service.
- Shape: `{ id, serviceOfferingId, offeringName, serviceName, scope, validUntil }[]` (validUntil ISO or null).

## Verification
- `bunx tsc --noEmit` → zero errors in catalog API files (other agents' workspace stubs error separately).
- `bun run lint` → zero errors in catalog API files (only error is in `AppShell.tsx`, owned by orchestrator).
- Dev server returned `401` for `/api/services` (auth gate working) when briefly running; sandbox dev server is volatile (per orchestrator note).

## Contracts honored
- `export const runtime = 'nodejs';` on every route.
- `import { db } from '@/lib/db'`, `import { getSession } from '@/lib/auth'`.
- `NextResponse.json(..., { status })` for all responses.
- Dates returned as ISO strings (`.toISOString()`).
- All four routes are **read-only** — no POST/PATCH/DELETE.
