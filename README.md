# CereBree uSMS — Universal Service Management System

CereBree uSMS is a governed IT service management platform built on a
constitutional role model: every actor finds a governed interface, every
boundary is explained rather than merely enforced, and every mutation is
audit-logged. The platform exposes **four role-based workspaces** — one per
accountability layer in the uSMS framework — over a single shared service
catalog, demand pipeline, SLA engine, change register, and knowledge base.

## Project purpose

The platform exists to make **governance visible**. Where conventional ITSM
tools hide structure behind ticket queues, CereBree uSMS surfaces the
governance gates that already exist in the work — quote approval, commitment
approval, SLA report review, breach response, catalog accuracy — and gives
each gate a named owner. The four role-based workspaces are:

| Role | Workspace | Accountability |
|---|---|---|
| **Service Customer** | CSM Portal | Submit demands, approve/decline quotes, browse the entitled catalog, monitor SLA performance. |
| **SCM Worker** | CSM Workspace | Own the demand lifecycle, draft quotes, communicate with the customer, prepare SLA reports. |
| **CM Leader** | CSM Workspace (governance) | Quote approval, SLA report review, workload monitoring, demand assignment, rejection authorization. |
| **Service Owner** | Service Owner Portal | Structural accountability for service value, quality and SLA commitments; commitment approval, breach response, problem-record ownership. |

Every demand flows through `NEW → UNDER_REVIEW → QUOTED → ACCEPTED →
IN_CHANGE → FULFILLED → CLOSED`, with governance gates at `UNDER_REVIEW →
QUOTED` (CM Leader quote approval) and `ACCEPTED → IN_CHANGE` (Service Owner
commitment approval). Every ticket flows through `NEW → TRIAGED → ASSIGNED →
IN_PROGRESS → WAITING_CUSTOMER → RESOLVED → CLOSED` with SLA timers running
against the response and resolution targets defined by the relevant
`SlaPolicy`.

## Tech stack

- **Framework**: Next.js 16 (App Router) with Turbopack.
- **Language**: TypeScript 5 (strict).
- **Database**: Prisma ORM with the SQLite client (file-based for dev; can be
  swapped to PostgreSQL for production).
- **Styling**: Tailwind CSS 4 with shadcn/ui (New York variant) and Lucide icons.
- **State**: Zustand for client state, TanStack Query for server state.
- **Forms / validation**: React Hook Form + Zod 4 (a shared `src/lib/validation.ts`
  module exposes every API contract schema).
- **Auth**: HMAC-signed httpOnly session cookie + scrypt password hashing,
  with login rate limiting and session expiry baked in. NextAuth.js v4 is
  available but not used by the default auth flow.
- **AI**: `z-ai-web-dev-sdk` powers the in-app Cogni assistant (server-side only).
- **Package manager**: bun (lockfile committed); npm/bun both work.

## Setup

```bash
# 1. Install dependencies
npm install         # or: bun install

# 2. Push the Prisma schema to the SQLite database
npm run db:push     # or: npx prisma migrate deploy

# 3. Seed demo data (2 customer orgs, 7 users, 6 services, demands, etc.)
npm run seed        # or: bun run prisma/seed.ts
```

The seed script is idempotent — it uses `upsert` for users and services so
re-running it won't duplicate rows. It will, however, create fresh demands,
changes, and SLA events on each run.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Prisma datasource URL. For SQLite dev: `file:./db/custom.db`. For PostgreSQL: `postgresql://user:pass@host:5432/db`. |
| `SESSION_SECRET` | **yes in production** | Strong (≥ 16 char) secret used to HMAC-sign session cookies. **If `NODE_ENV=production` is set without this var, the server will throw on first request.** In development a fallback secret is used so demo accounts work out of the box. |
| `NODE_ENV` | optional | `production` / `development` (default). Controls cookie `secure` flag and the SESSION_SECRET requirement. |

## Development server

```bash
npm run dev         # or: bun run dev
# → http://localhost:3000
```

The dev server runs on port 3000. The first request to any route incurs a
one-time Turbopack compile cost (~1-5s); subsequent requests are instant.

## Build & start

```bash
npm run build
npm start           # serves the build on port 3000
```

> **Note**: do NOT run `bun run build` in the sandbox dev environment — the
> auto-restart dev server is the canonical runtime. Build is for production
> deploys.

## Lint & typecheck

```bash
npm run check       # runs ESLint + tsc --noEmit
# or individually:
npm run lint
npm run typecheck
```

## Demo accounts

All four demo accounts share the password **`demo1234`**:

| Email | Role | Name |
|---|---|---|
| `customer@cerebree.io` | SERVICE_CUSTOMER | Elena Vance |
| `scm@cerebree.io` | SCM_WORKER | Priya Anand |
| `cmleader@cerebree.io` | CM_LEADER | Sofia Reyes |
| `owner@cerebree.io` | SERVICE_OWNER | Dr. Henrik Sørensen |

The login screen exposes quick-login buttons for each role. In development
this is the fastest way to switch roles while exploring the workspaces.

## Production warnings

Before deploying to production:

1. **Set `SESSION_SECRET`** to a strong, randomly-generated value (e.g.
   `openssl rand -hex 32`). The app refuses to start without it when
   `NODE_ENV=production`.
2. **Remove the demo quick-login buttons** in
   `src/components/shell/LoginScreen.tsx`. They are a development affordance
   and would let any visitor bypass auth in production.
3. **Configure a proper database** (PostgreSQL recommended). SQLite is fine
   for single-instance dev/demo but not for horizontal scaling or
   concurrent write load. Update `DATABASE_URL` and run
   `npx prisma migrate deploy` against the new database.
4. **Rate-limit at the edge** as well. The in-process login rate limiter
   (5 failures / 15 min) is per-instance; a multi-instance deployment needs
   a shared store (Redis etc.) for global rate limiting.
5. **Set `secure: true` cookies**. This happens automatically when
   `NODE_ENV=production`, but double-check that your reverse proxy
   terminates TLS so the cookie attribute is respected.

## Database migrations

```bash
# Create a new migration after editing prisma/schema.prisma
npx prisma migrate dev --name <descriptive-name>

# Apply existing migrations to a fresh database (production deploy)
npx prisma migrate deploy

# Reset the database (drops all data, re-runs all migrations, re-seeds)
npx prisma migrate reset

# Push schema changes without creating a migration (dev only)
npm run db:push
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full architecture
reference: roles & permission model, entity model, demand/ticket lifecycles,
SLA engine, notification flow, audit log, and deployment assumptions.

## Project layout

```
prisma/
  schema.prisma              # 20+ models covering the full uSMS domain
  seed.ts                    # idempotent demo seed
src/
  app/
    api/                     # route handlers (each exports `runtime = 'nodejs'`)
      auth/                  # login, logout, me
      demands/               # demand CRUD + 11 lifecycle endpoints
      changes/               # change register + lifecycle endpoints
      knowledge/             # knowledge article CRUD + lifecycle endpoints
      sla-reports/           # SLA report lifecycle (DRAFT → ISSUED)
      communications/        # customer communication thread
      governance-decisions/  # Service Owner governance decisions
      sla-events/            # SLA breach/warning feed
      sla-policies/          # SLA policy CRUD
      sla-clocks/            # SLA timer check endpoint
      tickets/               # ticket CRUD (Phase 2)
      conversations/         # threaded comments (Phase 4)
      attachments/           # file attachments (Phase 4)
      surveys/               # CSAT surveys (Phase 4)
      notifications/         # in-app notification feed
      services/              # service catalog (read-only)
      offerings/             # service offerings
      entitlements/          # customer entitlements
      stats/                 # role-scoped dashboard stats
      problems/              # problem records
      handovers/             # process handovers
      ai/                    # Cogni assistant (server-side SDK call)
      reports/               # operational reports
    page.tsx                 # root — handles auth gate + workspace switch
  components/
    shell/                   # AppShell, LoginScreen
    workspaces/
      customer/              # CSM Portal (SERVICE_CUSTOMER)
      scm-worker/            # CSM Workspace (SCM_WORKER)
      cm-leader/             # CSM Workspace (CM_LEADER)
      service-owner/         # Service Owner Portal (SERVICE_OWNER)
      shared/                # cross-workspace screens (DemandDetail, KnowledgeSearch, KnowledgeManager)
    widgets/                 # chart widgets (DemandPipelineLanes, WorkloadBars, etc.)
    guide/                   # role guide panel
    search/                  # global search + command palette
    ui/                      # shadcn/ui primitives
  lib/
    auth.ts                  # session + password + rate limiting
    audit.ts                 # auditLog() helper
    db.ts                    # Prisma client singleton
    api.ts                   # client-side apiGet/apiPost/apiPatch/apiDelete
    store.ts                 # Zustand store + NAV_BY_ROLE
    routing.ts               # URL <-> view mapping
    types.ts                 # shared TS types + label maps
    validation.ts            # Zod schemas + validateBody() helper
    permissions.ts           # requirePermission() helper
    notifications.ts         # notification fan-out helpers
    notification-delivery.ts # external channel delivery
    tickets.ts               # ticket helpers
    watchdog.ts              # dev-only process supervisor
  hooks/
    use-mobile.ts
    use-toast.ts
docs/
  architecture.md            # full architecture reference
mini-services/
  watchdog/                  # dev-only auto-restart supervisor
```

## License

Internal — CereBree uSMS Framework v1.1.
