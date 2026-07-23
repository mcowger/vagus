# News Digest Generator — Technical Design

> Status: **Draft v0.1** — technical decisions. Pairs with `REQUIREMENTS.md`
> (product behavior). Every decision below was explicitly resolved; rationale and
> the rejected alternatives are recorded so we don't relitigate them.

## 1. Decision Summary

| # | Decision | Choice |
|---|---|---|
| T1 | Project structure | **Solar-style monorepo**: `apps/server` + `apps/web`, Bun workspace |
| T2 | Vector similarity | **In-process brute force** over Float32 BLOBs, **behind an interface** |
| T3 | Run orchestration | **DB-backed job/step queue** (off-the-shelf, not hand-rolled) |
| T4 | Queue library | **plainjob** (bun:sqlite adapter, built-in cron) |
| T5 | Job granularity | **Fine-grained** — one job per unit of work |
| T6 | Configuration | **DB-first** (Solar-style), edited live in admin UI |
| T7 | Secrets at rest | **Plaintext in DB, no encryption** (risk explicitly accepted) |
| T8 | Parsing stack | **linkedom + @mozilla/readability + rss-parser**, fetch-based API clients |
| T9 | Frontend | tRPC + **@tanstack/react-query**, a router, **Tailwind + shadcn/ui** |
| T10 | LLM structured output | **Tool-calling as structured output** (TypeBox + `validateToolCall`) |
| T11 | Outbound fetching | **Basic** (User-Agent + timeout + per-stage concurrency) |
| T12 | Dev/test | **Full fakes + fixtures**, offline deterministic E2E |

## 2. Runtime Topology

Single Bun process (Solar model). One `Bun.serve` instance whose route table
delegates to a Hono app:

```
browser (React SPA)
   │  typed tRPC over HTTP (@tanstack/react-query)
   ▼
Bun.serve ──> Hono app
   ├── /trpc/*          → @hono/trpc-server (appRouter)
   ├── /api/auth/*      → BetterAuth handler
   ├── /healthz         → health check
   └── /*               → bundled React SPA (Bun.serve fullstack, no Vite)
   │
   ├── one shared bun:sqlite connection (WAL, foreign_keys ON)
   │     ├── Kysely (app tables)
   │     ├── BetterAuth (user/session/account/verification, api keys)
   │     └── plainjob (job queue tables)
   │
   └── in-process worker(s): plainjob defineWorker() consuming pipeline jobs
```

- **One SQLite file, one connection**, shared by Kysely + BetterAuth + plainjob
  (Solar's co-location principle). plainjob's `bun(new Database(...))` adapter wraps
  the *same* Database instance we hand to Kysely's `BunSqliteDialect` and BetterAuth's
  dialect. `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`.
- **Migrations**: numbered Kysely migrations via `migrateToLatest()` for app tables;
  BetterAuth migrates its own tables; plainjob creates its own tables on init. Run on
  boot before serving (Solar order).
- **Graceful shutdown**: stop accepting connections → `worker.stop()` (drains
  in-flight jobs) → flush pending notifications → close DB → exit. SIGTERM/SIGINT.

## 3. Project Structure (T1)

Bun workspace, mirroring Solar:

```
apps/
  server/        # Bun + Hono + tRPC + Kysely + BetterAuth + plainjob worker + pipeline
    src/
      index.ts           # Bun.serve + Hono wiring + migrations + worker start
      auth.ts            # BetterAuth (Google OAuth + api-key plugin)
      config.ts          # env bootstrap (auth secret, port, db path)
      db/                # kysely instance, schema, migrations/
      trpc/              # context, router (AppRouter exported for the web client)
      sources/           # source-type adapters (rss, brave-news, hackernews, gh-trending, scrape)
      ingest/            # fetch + idempotency/state
      pipeline/          # extract, embed, cluster, score, synthesize
      queue/             # plainjob setup, job definitions, workers, run coordinator
      llm/               # pi-ai model setup, structured-output tools, mock provider
      embed/             # embedding provider client (BYO) + VectorIndex interface
      notify/            # ntfy debounced notifier (per-user)
  web/           # React SPA (Vite-less, bundled by Bun.serve), shadcn/ui
    src/
      trpc.ts / trpcClient.ts    # typed client importing server's AppRouter type
      routes/ ...                # digests, digest reader, sources, admin, runs
```

Production: server serves the built web bundle; dev: `Bun.serve` fullstack HMR.
The web client imports the server's `AppRouter` **type** only (no runtime coupling).

## 4. Job Queue & Pipeline Orchestration (T3, T4, T5)

**plainjob**, fine-grained. A single **run** fans out into many small durable jobs;
each retries independently and survives process restarts.

### 4.1 Run coordination

Fine granularity needs stage-completion tracking. A `run` row plus per-stage
counters (or a lightweight coordinator) detects "stage N complete → enqueue stage
N+1". Approach:

- A `run` row: `id, trigger (cron|manual), status, started_at, finished_at, stats(JSON)`.
- Each stage tracks expected vs. completed counts (columns or a `run_stage` table).
- When a job finishes it decrements/increments the counter for its stage; the last
  job of a stage enqueues the next stage's jobs (or a `coordinate` job re-checks and
  advances). Idempotent so retries don't double-advance.
- **Overlap guard**: cron won't start a new run while one is active (plainjob cron +
  a run-status check); manual "run now" is rejected/queued if a run is active.

### 4.2 Job types (fine-grained)

| Job | Fan-out | Notes |
|---|---|---|
| `fetch-source` | per enabled source (deduped by identity) | external, retryable |
| `extract-article` | per fetched item | linkedom + Readability |
| `embed-article` | per extracted article | BYO embeddings, retryable |
| `cluster` | 1 per run (global) | in-process brute force |
| `score-user` | per user | hybrid relevance selection (§7.1) |
| `prune` | 1, scheduled (own cron) | enforce retention (30d/90d), keep idempotency keys |
| `synthesize-cluster` | per (user × selected cluster) | LLM tool-call, retryable |
| `assemble-digest` | per user | Stage C, builds combined digest |
| `notify-user` | per user | debounced ntfy |

- **Retry/backoff**: plainjob per-job retries; expensive/flaky external + LLM jobs get
  more attempts. Timeout re-queues jobs whose worker died.
- **Cleanup**: plainjob auto-removes old done/failed jobs (configurable retention).
- Stage A (article bullet) is computed once per article (shared) during/after
  extraction and reused across users.

### 4.3 Scheduling

plainjob's built-in **cron** drives the interval (`queue.schedule(...)`), replacing a
hand-rolled cron loop. Manual trigger enqueues the same run-start job.

## 5. Data & Storage

### 5.1 Vector similarity (T2)

- Embeddings stored as **Float32 `BLOB`** on `article.embedding`.
- Clustering loads the run's article embeddings into memory, computes pairwise cosine
  similarity in TypeScript, thresholds/clusters (dozens–hundreds of vectors/run).
- All vector access goes through a **`VectorIndex` interface** (`upsert`, `query`,
  `pairwise`) so **sqlite-vec** can replace the brute-force impl later without touching
  the pipeline. No vector DB (Solar ethos).
- Fallback to lexical/title/URL dedupe when no embedding provider is configured.

### 5.2 Configuration (T6, T7)

- **DB-first**: providers/models, embedding provider, sources, schedules, thresholds,
  prompts, ntfy config all stored in SQLite and edited live in the admin UI.
- **Bootstrap env only**: `BETTER_AUTH_SECRET`, port, DB path, `NODE_ENV`.
- **Provider/embedding API keys: stored plaintext in the DB, no at-rest encryption**
  (risk explicitly accepted by the owner; **do not add an encryption key**). BetterAuth
  user API keys remain hashed by BetterAuth as usual.

### 5.3 Retention & pruning (REQUIREMENTS §9.7–8, NFR-9)

- **Store full Readability-extracted article text** (`article.content`) within the
  retention window — needed for Stage B/C synthesis and citation grounding.
- A scheduled **`prune` job** (plainjob cron) removes **articles + embeddings > 30 days**
  and **digests > 90 days** (both admin-configurable in `settings`).
- **Idempotency keys are separated from content**: a `processed_key` table (URL/GUID/
  source-id) is retained **longer than** article rows, so pruning content never causes
  re-ingestion of already-seen items.

## 6. Ingestion & Sources (T8, T11)

- **Source adapters** behind a common interface: `rss`, `brave-news`, `hackernews`,
  `github-trending`, `scrape`. Each returns raw items with a stable identity key.
  - RSS/Atom: **rss-parser**.
  - Hacker News: official Firebase JSON API (no key), plain `fetch`.
  - Brave News: REST API + key, plain `fetch`.
  - GitHub Trending: no official API → HTML fetch + parse.
  - Scrape: `fetch` → **linkedom** DOM → **@mozilla/readability**.
- **Extraction (Stage 1)**: linkedom + Readability produce the standard article object
  `{ title, author, source, url, content, publish_date, image_url }` + reading-time.
- **Idempotency**: every item keyed by URL/GUID/source-id; processed keys persisted;
  reconciled from stored articles on cold start (gha pattern). Per-source fetch runs
  **once per run** even if many users reference it.
- **Fetching (T11 — basic)**: plain `fetch` with a descriptive User-Agent, per-request
  timeout, and per-stage concurrency limits (`p-limit` and/or plainjob worker
  concurrency). **No** robots.txt, per-domain throttle, or conditional requests for now.

## 7. LLM Integration (T10)

- **pi-ai** (`@earendil-works/pi-ai`) for all chat/synthesis; providers/models
  configured in DB and registered into a pi-ai `Models` collection at runtime.
- **Structured output via tool-calling**: each synthesis stage defines a TypeBox
  "submit" tool whose parameters *are* the output schema, e.g.
  `submit_cluster_summary({ summary, bullets: [{ claim, sourceArticleIds }], perspectives, timeline })`
  and `submit_digest({ execSummary, takeaways, whyItMatters, quotes })`.
- Validate the tool call with pi-ai's `validateToolCall`; on validation failure, return
  the error as a tool result and let the model retry (bounded).
- **Citation grounding (FR-23/24)**: each source article is passed with a **stable ID**;
  the model may reference only those IDs. Any bullet whose `sourceArticleIds` aren't in
  the provided set is rejected/repaired, making hallucinated citations detectable.
- **Per-task model tiers (FR-22)**: the model is configured **per pipeline task**, not
  merely per stage. A `task_model` mapping routes each task to a configured pi-ai model:
  strong/smart for Stage B/C synthesis; fast/cheap for Stage A bullets and the relevance
  **tiebreaker** (§7.1). Sensible defaults; overridable in the admin UI. pi-ai usage/cost
  captured per run for the cost surface (NFR-7).

### 7.1 Hybrid relevance scoring (FR-17)

The `score-user` job selects which shared clusters enter a user's digest:

1. **Embedding similarity (primary)** — the user's profile is embedded once (keywords/
   topics as text); each cluster is scored by cosine similarity between the profile
   vector and the cluster centroid/primary-article embedding. Reuses existing
   embeddings — no extra LLM cost.
2. **Keyword/entity boost** — overlap with the profile's keywords/entities adjusts the
   score; **hard include/exclude rules** force or block clusters.
3. **Optional LLM tiebreaker** — only for **borderline** clusters near the threshold, a
   cheap/fast model (per-task tier) judges relevance. Bounded so cost stays low.

Clusters above the (configurable) threshold, capped at a max count, proceed to
per-user synthesis. Degrades to keyword-only scoring when embeddings are unavailable.

## 8. Embeddings (T2, and REQUIREMENTS §1.2)

- pi-ai has **no** embeddings API → a **separate BYO OpenAI-compatible `/v1/embeddings`
  client**, configured independently (endpoint + model + key) in the admin UI.
- Behind an `Embedder` interface so a **packaged/local model** can be added later without
  changing callers. Absent config → clustering degrades to lexical dedupe.

## 9. Notifications (T—, follows gha)

- **Per-user ntfy**: each user configures their own topic; base URL configurable.
- **Debounced/batched** per user so a burst yields at most one push per digest cycle;
  ASCII-safe headers; click-through deep-link to the digest.
- **Automatic publish** — digest becomes visible and notification fires on generation;
  no review step (REQUIREMENTS FR-32).

## 10. Frontend (T9)

- **tRPC client over `@tanstack/react-query`** (typed hooks, caching, invalidation, and
  polling for run status/history).
- A client-side **router** for `/digests`, `/digests/:id`, `/sources`, `/admin`, `/runs`.
- **Tailwind + shadcn/ui** (Radix primitives) for accessible tables, forms, dialogs —
  fast path to a polished admin UI.
- Digest reader renders clustered stories with **inline source chips + per-story source
  list** (Solar cited-sources UX) and a **TL;DR ↔ Deep Dive** verbosity toggle (FR-26).

## 11. Auth (BetterAuth)

- **Google OAuth only** for humans (no email/password). Emails in `ADMIN_EMAILS`
  become **admin** and bypass the domain allowlist; everyone else must match
  `SIGNUP_ALLOWED_DOMAINS`. Authorization is centralized in `resolveSignupRole`
  (applied on user creation for both real Google logins and `/dev/login`).
- **Trusted account linking** for Google (`accountLinking` with
  `requireLocalEmailVerified: false`) so a Google sign-in links into a same-email
  account, e.g. one predating the switch away from email/password.
- API-key plugin for automation (trigger runs, fetch digests as JSON); admin mints
  keys, robots send them via `x-api-key` (resolves to the owning admin via
  `enableSessionForAPIKeys`).
- Dev/test-only `POST /dev/login`, gated by `DEV_AUTH_ENABLED` (never in
  production), simulates a Google sign-in under the same rules; detached dev
  starts also seed an admin + an API key to `.dev-api-key`.
- Same SQLite connection/file as the app; roles `user`/`admin`; `isDisabled` gate.
- Full design: `docs/planning/AUTH_GOOGLE_ONLY.md`.

## 12. Dev & Test (T12)

- **Full fakes + fixtures → offline, deterministic E2E**:
  - **Mock LLM** via pi-ai `fauxProvider()` (scripted responses) behind a `MOCK`/env flag.
  - **Deterministic fake embedding** function (stable vectors from text) for offline
    clustering.
  - **Recorded network fixtures** (saved RSS/HTML/API responses) so ingestion runs
    offline in dev and CI.
  - **Seed** a dev admin + sample sources/articles/digests.
- **`bun test`**, `*.test.ts` colocated with source (Solar/gha convention). Pure-logic
  units (parsing, cosine/clustering, scoring, citation validation) have inline fixtures;
  the full pipeline has an offline end-to-end test.

## 13. Deployment (follows Solar)

- **Docker Compose**; persistent SQLite + cached assets under a mounted `./data`.
- `BETTER_AUTH_SECRET` ≥ 32 chars enforced/warned in production.
- `/healthz` + structured request logging with request IDs.

### 13.1 Dev ports (Paseo + branch-stable allocator)

- **The server just accepts `$PORT` (or `--port`)** like any conventional server — it
  does **not** import the allocator. Port *selection* lives in the `bun run dev` target,
  which inlines the shared allocator CLI:
  ```jsonc
  // package.json (M1)
  "dev": "PORT=${PASEO_PORT:-$(bun scripts/port-allocator.ts)} bun apps/server/src/index.ts"
  // equivalently: bun apps/server/src/index.ts --port ${PASEO_PORT:-$(scripts/port-allocator.ts)}
  ```
- `scripts/port-allocator.ts` is a **pure, deterministic** `(service, branch) → port`
  mapping over a configurable range (`PASEO_PORT_RANGE`, default `4300-4399`), runnable
  as a CLI (prints the branch-stable port for the current git branch) and importable as
  a library. Same branch → same port across restarts; different worktrees → different
  ports.
- **Paseo** (beta `worktree.servicePorts.portScript`, PR #2165) calls
  `scripts/paseo-port.ts` — the same allocator, fed the branch Paseo supplies — and sets
  `$PASEO_PORT`; the `${PASEO_PORT:-…}` shell fallback makes the two paths agree without
  shared state. Both live in `scripts/` alongside `port-allocator.test.ts`.

## 14. Key Dependencies (indicative)

`hono`, `@hono/trpc-server`, `@trpc/server`, `@trpc/client`, `better-auth`,
`@better-auth/api-key`, `kysely`, `kysely-bun-sqlite`, `plainjob`,
`@earendil-works/pi-ai`, `@mozilla/readability`, `linkedom`, `rss-parser`, `p-limit`,
`zod`/TypeBox (via pi-ai), React, `@tanstack/react-query`, a router, `tailwindcss`,
`shadcn/ui` (Radix).

## 15. Deferred / Revisit

- **sqlite-vec** swap-in behind `VectorIndex` if article volume grows.
- **Packaged local embedding model** behind `Embedder`.
- **Polite fetching** (conditional requests, per-domain throttle, robots.txt) if we
  scale source counts or add heavy scraping.
- Tuning of the hybrid scoring weights/threshold and the LLM-tiebreaker band (§7.1) —
  mechanism is finalized; concrete weights/defaults to be tuned during pipeline build.
- **Per-task model tier defaults** — finalize which concrete models default to each task.
