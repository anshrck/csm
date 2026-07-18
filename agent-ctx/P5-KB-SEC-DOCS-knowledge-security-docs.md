# Task P5-KB-SEC-DOCS — Work Record

**Agent**: Knowledge Base + Security Hardening + Docs (Phase 5/7/12)
**Task ID**: P5-KB-SEC-DOCS
**Date**: July 2026

## Summary

Three deliverables in one pass:
- **(A) Knowledge Base API + UI** (Phase 5 item 14): 5 API routes + shared `KnowledgeSearch` + `KnowledgeManager` + per-workspace Knowledge views wired into all 4 role workspaces.
- **(B) Security hardening** (Phase 7 items 17-18): `src/lib/validation.ts` (Zod schemas + `validateBody` helper) + session hardening in `src/lib/auth.ts` (SESSION_SECRET production guard, 7-day expiry, login rate limiting) + Zod-validated login route.
- **(C) Documentation** (Phase 12 items 27-28): top-level `README.md` + `docs/architecture.md`.

## Files created (12)

| Path | Purpose |
|---|---|
| `src/lib/validation.ts` | Zod 4 schemas for 7 API contracts + `validateBody<T>()` helper. |
| `src/app/api/knowledge/_serialize.ts` | `serializeKnowledgeArticle()`, `summarizeKnowledgeArticle()`, `KNOWLEDGE_INCLUDE`, `errorResponse()`. |
| `src/app/api/knowledge/route.ts` | GET (list + filters + role scoping) + POST (create DRAFT). |
| `src/app/api/knowledge/[id]/route.ts` | GET (single, full body) + PATCH (edit DRAFT/REVIEW). |
| `src/app/api/knowledge/[id]/submit-review/route.ts` | POST → REVIEW. |
| `src/app/api/knowledge/[id]/publish/route.ts` | POST → PUBLISHED (CM Leader / Service Owner). |
| `src/app/api/knowledge/[id]/retire/route.ts` | POST → RETIRED (CM Leader / Service Owner). |
| `src/components/workspaces/shared/KnowledgeSearch.tsx` | Debounced search + Dialog markdown viewer. |
| `src/components/workspaces/shared/KnowledgeManager.tsx` | Full CRUD UI (stat row, filter bar, DataTable with actions, editor + viewer dialogs). |
| `src/components/workspaces/customer/Knowledge.tsx` | Browse-only view. |
| `src/components/workspaces/scm-worker/Knowledge.tsx` | `<KnowledgeManager role="SCM_WORKER" />`. |
| `src/components/workspaces/cm-leader/Knowledge.tsx` | `<KnowledgeManager role="CM_LEADER" />`. |
| `src/components/workspaces/service-owner/Knowledge.tsx` | `<KnowledgeManager role="SERVICE_OWNER" defaultFilterOwnedServices />`. |
| `README.md` | Setup, env vars, demo accounts, production warnings, migrations, project layout. |
| `docs/architecture.md` | Roles, permission model, entity model, lifecycles, SLA engine, notifications, audit, deployment. |

## Files modified (7)

| Path | Change |
|---|---|
| `src/lib/auth.ts` | SESSION_SECRET production guard, 7-day session expiry, login rate limiter (`isLoginRateLimited`, `recordFailedLogin`, `clearLoginAttempts`). |
| `src/app/api/auth/login/route.ts` | Zod-validated body + rate-limit check (429) + record-fail/clear-on-success. |
| `src/lib/store.ts` | Added `'knowledge'` to `ViewKey` + `NAV_BY_ROLE` for all 4 roles. |
| `src/lib/routing.ts` | Added `knowledge: 'knowledge'` to `VIEW_PATH`. |
| `src/components/workspaces/customer/CustomerWorkspace.tsx` | `'knowledge'` in `VALID_VIEWS` + switch case. |
| `src/components/workspaces/scm-worker/ScmWorkerWorkspace.tsx` | Import + switch case. |
| `src/components/workspaces/cm-leader/CmLeaderWorkspace.tsx` | Import + switch case. |
| `src/components/workspaces/service-owner/ServiceOwnerWorkspace.tsx` | Import + switch case. |

## Database

- `KnowledgeArticle` Prisma model already existed (Phase 5 schema, added by orchestrator).
- Seeded 5 additional articles (idempotent script) — final count: 7 articles (6 PUBLISHED + 1 DRAFT). The DRAFT lets the SCM/CM/Owner UI exercise the submit-review → publish flow.

## Verification

- `bun run lint` → EXIT 0 (whole project, after parallel agents' edits settled).
- `bunx tsc --noEmit --skipLibCheck` → 0 errors in any of my files (only pre-existing errors in other agents' files: `DemandQueue.tsx` missing `useMutation` import, missing `test-api*.ts` references in tsconfig).
- Runtime smoke-tests via `bun -e`:
  - All 7 Zod schemas parse valid input cleanly and reject invalid input with the expected error messages.
  - Login rate limiter: 4 fails don't block; 5th fail blocks; `clearLoginAttempts` resets.
  - Session expiry: 0/6-day valid; 8-day expired; missing-ts rejected.
  - SESSION_SECRET guard: throws in production without the env var; throws with <16-char value; imports cleanly with strong value; imports cleanly in dev with the fallback.
- Dev server running with clean 200s on all routes.

## Key contracts honored

- `import { db } from '@/lib/db'` ✓
- `import { getSession, requireRole } from '@/lib/auth'` ✓
- `import { auditLog } from '@/lib/audit'` ✓
- `export const runtime = 'nodejs';` at top of every route ✓
- `import { apiGet, apiPost, apiPatch } from '@/lib/api'` ✓
- `import { useApp, NAV_BY_ROLE } from '@/lib/store'` ✓
- `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'` ✓
- `import { toast } from 'sonner'` ✓
- `import { z } from 'zod'` ✓
- Did NOT write tests.
- Did NOT run `bun run build`.
- Did NOT remove demo quick-login (kept it for dev).
- Did NOT modify the catch-all route or AppShell.
