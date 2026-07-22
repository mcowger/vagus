# @vagus/server (M1 skeleton)

Single Bun process: `Bun.serve` → Hono route table (`/trpc/*`, `/api/auth/*`,
`/healthz`, SPA `/*`), one shared `bun:sqlite` connection (WAL, foreign_keys ON)
used by Kysely + BetterAuth + plainjob, numbered Kysely migrations on boot, and
an in-process plainjob worker.

Run: `bun run dev` (from repo root) — picks a branch-stable port via
`scripts/port-allocator.ts`. The server itself only reads `$PORT` / `--port`.

## M1 integration seams

The sync-first skeleton is in place with stubbed modules marked `// TODO(Track X)`.
Each track fills in its module **without changing these exported signatures**, so
the pieces integrate cleanly. `index.ts` imports exactly these:

### Track A — Auth (`src/auth.ts`, `src/trpc/context.ts`, `src/trpc/routers/auth.ts`)
- `export const auth: AuthLike` where `AuthLike.handler(request: Request): Response | Promise<Response>`.
  Mounted at `/api/auth/*`. Implement with BetterAuth on `db.sqlite`
  (email/password + api-key plugin, first-account→admin, `user`/`admin` roles,
  `isDisabled` gate, optional email-domain allowlist).
- In `src/trpc/context.ts`, `createContext({ req })` must resolve the BetterAuth
  session and populate `user: AuthUser | null` and `session`. Keep the return
  shape `{ db, user, session }`.
- Refine `protectedProcedure` / `adminProcedure` in `src/trpc/trpc.ts` if needed
  (guards already read `ctx.user`).
- Fill `authRouter` in `src/trpc/routers/auth.ts` (e.g. `me`, user management).

### Track B — Queue/coordinator (`src/queue/index.ts`, `src/trpc/routers/runs.ts`)
- `export async function startWorker(): Promise<void>` — build plainjob queue on
  `bun(db.sqlite)`, define worker(s), register the no-op job + run/stage
  coordinator (over the `run` / `run_stage` tables), start the worker loop.
- `export async function stopWorker(): Promise<void>` — `worker.stop()` (drain).
- Run/stage advance logic, overlap guard (reject a 2nd concurrent run), and the
  `runsRouter` in `src/trpc/routers/runs.ts` (`startRun`, `listRuns`, `getRun`).

### Track C — Web shell (`apps/web`)
- Replace the placeholder `apps/web/src/main.tsx` with the React + shadcn/ui app
  shell: router, `@tanstack/react-query` tRPC client importing the server
  `AppRouter` **type** only (`import type { AppRouter } from "../../server/src/trpc/router"`),
  auth screens (sign-up/sign-in), empty dashboard. Served at `/*` via the
  `apps/web/index.html` entry that `index.ts` imports.

### Track D — Ops plumbing (`src/config.ts`, `src/log.ts`, `/healthz`)
- `src/config.ts`: `export const config: Config` — validate env
  (`BETTER_AUTH_SECRET` ≥ 32, warn in prod), keep fields
  `{ dbPath, port, betterAuthSecret, nodeEnv }`.
- `src/log.ts`: structured logging + request IDs (NFR-8); keep the `log` +
  `requestId` exports. Add Hono request-logging middleware.
- Refine the `/healthz` handler in `index.ts` (DB check, etc.).

## Shared contracts (already landed — import, don't redefine)
- `src/db/connection.ts`: `db` (shared `{ sqlite, kysely, close }`), `createDb(path)`.
- `src/db/schema.ts`: Kysely `Database` interface (`run`, `run_stage`).
- `src/db/migrate.ts`: `migrateToLatest(db)` + in-code migration registry.
- `src/trpc/router.ts`: `appRouter`, `type AppRouter`.
- `src/trpc/context.ts`: `Context`, `AuthUser`, `createContext`.
