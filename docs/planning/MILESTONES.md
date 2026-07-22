# News Digest Generator — Implementation Milestones

> Status: **Draft v0.1**. Pairs with `REQUIREMENTS.md` and `TECHNICAL_DESIGN.md`.
> Sequencing follows the resolved decisions below. Milestones are **horizontal
> layers** — each completes a capability across the system before the next begins.

## Sequencing Decisions (resolved)

| # | Decision | Choice |
|---|---|---|
| S1 | Slicing | Horizontal layers (M1–M7) |
| S2 | Multi-tenancy | Multi-tenant from the start (per-user fan-out in M4/M5) |
| S3 | Job queue | Foundational in M1 (plainjob + worker + run/stage coordinator) |
| S4 | Source breadth | M2 = RSS + Brave News; HN, GitHub Trending, generic scrape → M7 |
| S5 | UI depth | Hybrid — per-milestone UI for operator-critical surfaces; dashboards/advanced admin → M7 polish |
| S6 | Deploy/CI | Land in M2 (Dockerfile + compose + offline CI) |

**Cross-cutting rules**
- **Testing (T12)**: every milestone from M2 on ships with `bun test` coverage using
  fakes + fixtures (mock LLM via pi-ai `fauxProvider`, deterministic fake embeddings,
  recorded network fixtures). Pure logic gets unit tests; each pipeline milestone
  extends the **offline end-to-end test**. **Definition of Done (DoD)** for every
  milestone includes: typecheck clean, tests green, and (M2+) CI green.
- **Multi-tenant from the start (S2)**: all pipeline schema carries `user_id` where
  applicable from its first appearance; fixtures use ≥2 users once scoring/synthesis exist.
- **Deployable (M2+)**: each milestone runs under Docker Compose with a `./data` volume.
- **Parallelization convention**: each milestone lists a **Sync-first** step (shared
  contracts — interfaces, schemas, job signatures — that one agent lands first and
  everyone imports) followed by **Tracks** that can run **concurrently** as independent
  subagents. Tracks are designed to depend on *contracts*, not on each other's runtime
  output, so they integrate cleanly at the end. Fakes/fixtures (T12) let a track test in
  isolation before its upstream track exists.

---

## M1 — Foundational Skeleton (infra only, no pipeline)

**Goal**: A running single Bun process with web/auth/db/queue wiring in place. No
user-visible digest output yet.

**Scope**
- Bun workspace: `apps/server` + `apps/web` (T1); web imports server `AppRouter` type.
- `Bun.serve` + Hono routing: `/trpc/*` (@hono/trpc-server), `/api/auth/*`, `/healthz`,
  SPA catch-all (fullstack bundling, no Vite).
- Single shared `bun:sqlite` connection (WAL, foreign_keys ON) used by Kysely,
  BetterAuth, and plainjob. Numbered Kysely migrations via `migrateToLatest()` on boot.
- **BetterAuth**: email/password + api-key plugin; first account → admin; `user`/`admin`
  roles; `isDisabled` gate; optional email-domain allowlist.
- **plainjob (S3)**: queue on the shared connection, a worker, and the **run + stage
  coordinator scaffolding** (`run` row, per-stage counters, stage-advance logic),
  proven end-to-end with a trivial **no-op job**. Graceful shutdown (drain worker →
  flush → close DB).
- **Web**: React + shadcn/ui app shell, router, `@tanstack/react-query` tRPC client,
  auth screens (sign-up/sign-in), empty dashboard.
- `config.ts` bootstrap env only: `BETTER_AUTH_SECRET` (≥32, warn in prod), port, DB path.
- Structured request logging + request IDs (NFR-8).

**Out / deferred**: Docker/CI (M2), any ingestion or pipeline, provider config.

**Parallelization** — *do these sync points first, then fan out.*
- **Sync-first (blocking, 1 agent):** repo/workspace scaffold, the shared `bun:sqlite`
  connection module, the initial Kysely schema types, and the tRPC `AppRouter` +
  context shape. Everything else imports these, so land them before fanning out.
- **Track A — Auth** (BetterAuth setup, first-user-admin hook, roles/isDisabled,
  allowlist). Depends on: DB connection.
- **Track B — Queue/coordinator** (plainjob wiring, worker, `run`/stage tables +
  advance logic, no-op job, overlap guard, graceful shutdown). Depends on: DB connection.
- **Track C — Web shell** (React + shadcn app shell, router, react-query tRPC client,
  auth screens). Depends on: `AppRouter` type only (can mock procedures until A lands).
- **Track D — Ops plumbing** (config bootstrap, structured logging + request IDs,
  `/healthz`). Independent.
- Tracks A–D run **concurrently** after the sync-first step; integrate at the end.

**DoD**
- Fresh DB boots, migrations run, first user becomes admin, can sign in and see the shell.
- Enqueue → worker executes the no-op job → run advances through a stub stage → run
  marked complete. Overlap guard rejects a second concurrent run.
- Graceful shutdown drains cleanly. `bun test` green (skeleton + coordinator unit tests).

---

## M2 — Ingestion, Provider Config, Deploy & CI

**Goal**: Real sources fetched idempotently into the DB, configured through the UI, with
packaging and CI in place.

**Scope**
- **DB-first config (T6)**: schema + tRPC for providers/keys and source definitions;
  keys stored plaintext (T7, no encryption). `source` carries `owner_user_id`
  (NULL = global pool) per FR-0.
- **Source adapters (S4)**: `rss` (rss-parser) and `brave-news` (REST + key). Common
  adapter interface returning items with a stable identity key.
- **Ingestion + idempotency (FR-5–8)**: `fetch-source` jobs (fine-grained, one per
  enabled source, deduped by identity); `processed_key` table retained independently of
  content; cold-start reconciliation from stored articles; per-stage concurrency limits;
  one failing source doesn't fail the run (FR-8). Basic fetching (T11: UA + timeout).
- **Operator UI (S5)**: provider/key config screen (needed for Brave key), source CRUD
  (global + per-user private), run history/status (poll via react-query).
- **Deploy/CI (S6)**: Dockerfile + docker-compose + `./data` volume; CI workflow
  (`bun install`, typecheck, `bun test` on the offline suite). First recorded network
  fixtures (RSS + Brave News) land here.

**Out / deferred**: extraction/Readability (M3), other source types (M7).

**Parallelization** — *agree the adapter interface + config schema first.*
- **Sync-first (blocking, 1 agent):** the `SourceAdapter` interface (item shape + stable
  identity key), the provider/config + `source` + `processed_key` schema/migrations, and
  the `fetch-source` job contract. These are the shared contracts every track binds to.
- **Track A — RSS adapter** (rss-parser) + its recorded fixtures. Fully independent once
  the interface exists.
- **Track B — Brave News adapter** (REST client + key handling) + fixtures. Independent
  of A (both implement the same interface, no shared code beyond it).
- **Track C — Ingestion core** (`fetch-source` job, idempotency via `processed_key`,
  cold-start reconciliation, concurrency limits, per-source failure isolation). Depends
  on the interface, not on A/B (test with a fake adapter).
- **Track D — Operator UI** (provider/key screen, source CRUD, run history). Depends on
  the tRPC procedures; can build against typed stubs in parallel with C.
- **Track E — Deploy/CI** (Dockerfile, compose, `./data` volume, CI workflow, fixture
  plumbing). Independent; land early so A–D are continuously tested.

**DoD**
- Admin adds a Brave key + an RSS source and a Brave source via the UI; a manual run
  fetches items from both; re-running immediately ingests **nothing new** (idempotency
  proven offline against fixtures). Run history shows per-source stats.
- `docker compose up` serves the app; CI green.

---

## M3 — Extraction & Article Bullets (Stage 1 + Stage A)

**Goal**: Raw items become standardized, grounded article objects with a shared
one-line summary.

**Scope**
- **Stage 1 (FR-10/11)**: `extract-article` jobs — linkedom + @mozilla/readability
  produce `{ title, author, source, url, content, publish_date, image_url }` + reading
  time. **Store full extracted text** (retention item 8). Feeds/APIs that already carry
  content skip re-fetch.
- **Stage A (FR-19)**: `stage-a-bullet` — one-sentence bullet per article via a
  **cheap per-task model** (FR-22), computed once and **shared** across users. pi-ai
  `Models` set up from DB provider config; usage/cost captured (NFR-7).
- **Per-task model config (FR-22)**: `task_model` mapping + minimal admin control (Stage
  A task defaults to a cheap model).

**Out / deferred**: embeddings/clustering (M4), multi-doc synthesis (M5).

**Parallelization**
- **Sync-first (blocking, 1 agent):** the `article` schema additions (content, reading
  time, `stage_a_bullet`), the `extract-article`/`stage-a-bullet` job contracts, and the
  pi-ai `Models` setup + `task_model` mapping (used by Stage A and every later LLM task).
- **Track A — Extraction** (linkedom + Readability, standard article object, reading-time,
  skip-when-content-present) + messy-HTML fixtures. Independent.
- **Track B — Stage A bullets** (cheap-model summarization, shared/reuse, usage capture)
  using the **mock LLM** — needs the `Models`/`task_model` contract, not Track A's output
  (test with fixture articles).
- **Track C — Per-task model config** (`task_model` schema + minimal admin control).
  Mostly independent; coordinate on the mapping shape from the sync-first step.
- A and B run concurrently; wire the pipeline order (extract → bullet) at integration.

**DoD**
- Offline E2E: fixtures → fetch → extract → article rows with content + reading time +
  a Stage A bullet, using the mock LLM. Re-runs reuse existing bullets (no re-summarize).
- Extraction unit tests over messy-HTML fixtures. Tests green in CI.

---

## M4 — Embeddings, Clustering & Per-User Scoring (Stage 2 + Stage 3)

**Goal**: Articles are deduped into shared event clusters; each user's profile selects
which clusters are relevant to them.

**Scope**
- **Embeddings (T2, §1.2)**: BYO OpenAI-compatible `/v1/embeddings` client behind an
  `Embedder` interface + admin config; `embed-article` jobs store Float32 BLOBs.
  Deterministic fake embedder for offline tests.
- **Clustering (FR-12–15)**: `cluster` job — in-process brute-force cosine over the run's
  embeddings behind the `VectorIndex` interface; configurable threshold; identify
  primary vs. syndication (FR-14); lexical fallback when embeddings absent (FR-15).
- **Interest profiles (S2, multi-tenant)**: `interest_profile` per user (keywords,
  topics, entities, include/exclude rules, profile embedding, threshold, max-cluster cap,
  ntfy topic) + operator-critical profile editor UI.
- **Hybrid scoring (FR-17, §7.1)**: `score-user` jobs — embedding similarity primary +
  keyword/entity boost + hard include/exclude rules + **optional cheap-LLM tiebreaker**
  for borderline clusters (per-task model tier). Selects capped set of clusters per user.

**Out / deferred**: Stage B/C synthesis + digest rendering (M5).

**Parallelization** — *the `Embedder` + `VectorIndex` interfaces are the key contracts.*
- **Sync-first (blocking, 1 agent):** the `Embedder` interface (+ deterministic fake),
  the `VectorIndex` interface, the `interest_profile`/`cluster`/`cluster_article` schema,
  and the `score-user` job contract.
- **Track A — Embeddings** (BYO `/v1/embeddings` client + admin config, `embed-article`
  job, BLOB storage). Implements `Embedder`; independent.
- **Track B — Clustering** (brute-force cosine behind `VectorIndex`, threshold,
  primary-vs-syndication, lexical fallback) using the **fake embedder** — does not wait
  on Track A. Pure, heavily unit-tested.
- **Track C — Profiles** (`interest_profile` schema + profile editor UI + profile
  embedding). UI depends only on tRPC stubs; independent of A/B.
- **Track D — Hybrid scoring** (`score-user`: similarity + keyword/entity boost +
  include/exclude + LLM tiebreaker). Depends on the `VectorIndex` + profile *contracts*,
  testable with fixture clusters + fake embedder in parallel with B/C.
- A–D run **concurrently** against the fakes; integrate on the real embedder at the end.

**DoD**
- Offline E2E with **≥2 users**: an event covered by multiple fixture articles collapses
  into one shared cluster; two profiles select **different** clusters from the same pool.
  Fake embedder makes it deterministic.
- Clustering/scoring math unit-tested. Fallback path tested with embeddings disabled.

---

## M5 — Synthesis & Digest Reader (Stage B/C + Citations)

**Goal**: Per-user digests are generated with grounded, cited summaries and are readable
in the browser.

**Scope**
- **Stage B (FR-20)**: `synthesize-cluster` jobs per (user × selected cluster) — multi-doc
  synthesis via **tool-calling structured output** (T10): TypeBox `submit_cluster_summary`
  tool, `validateToolCall`, bounded retry. Consensus / differing perspectives / timeline.
- **Stage C (FR-21)**: `assemble-digest` per user — `submit_digest` (exec summary,
  takeaways, why-it-matters, quotes). One combined digest per user per interval.
- **Citation grounding (FR-23/24)**: source articles passed with stable IDs; bullets may
  reference only provided IDs; hallucinated citations rejected/repaired. `citation` rows
  persisted.
- **Digest reader UI (S5, operator-critical)**: clustered stories with **inline source
  chips + per-story source list** (Solar UX) and **TL;DR ↔ Deep Dive verbosity toggle**
  (FR-26). Digest addressable by stable URL/ID + retrievable as JSON (FR-27).
- **Stronger per-task model** for B/C (FR-22).

**Out / deferred**: scheduling, notifications, pruning (M6); breadth + polish (M7).

**Parallelization** — *lock the structured-output schemas + citation contract first.*
- **Sync-first (blocking, 1 agent):** the TypeBox `submit_cluster_summary` /
  `submit_digest` tool schemas, the `citation` schema + stable-ID grounding contract, and
  the `digest`/`digest_cluster` schema. UI and backend both bind to these types.
- **Track A — Stage B synthesis** (`synthesize-cluster` job, tool-call + `validateToolCall`
  + retry). Mock LLM (`fauxProvider`) scripted to emit the tool call; independent.
- **Track B — Stage C assembly** (`assemble-digest` job). Depends on the digest schema,
  not on A's runtime output (test with fixture cluster summaries).
- **Track C — Citation grounding + validation** (reject/repair out-of-set IDs, persist
  `citation`). Pure logic; unit-testable independently and reused by A and B.
- **Track D — Digest reader UI** (source chips, per-story source list, TL;DR/Deep-Dive
  toggle, stable URL, JSON endpoint). Builds against the digest types + fixture digests,
  fully parallel to A–C.

**DoD**
- Offline E2E end to end (≥2 users): fixtures → … → two distinct cited digests rendered
  in the reader; **every bullet links to ≥1 source URL** (no uncited claims); verbosity
  toggle works; JSON endpoint returns the digest. Mock LLM throughout.
- Citation-validation unit tests (reject out-of-set IDs). Tests green in CI.

---

## M6 — Scheduling, Notifications & Retention

**Goal**: The system runs itself on an interval, notifies users, and stays bounded.

**Scope**
- **Scheduling (FR-29/30, T4)**: plainjob **cron** drives interval runs; manual "run now"
  enqueues the same run-start; overlap guard prevents concurrent runs.
- **Notifications (FR-32–35)**: per-user **ntfy**, debounced/batched (one push per user
  per cycle), ASCII-safe headers, deep-link to the digest; configurable base URL;
  **automatic publish** on generation (no review). `notification_state` per user.
- **Retention/pruning (FR-31b, NFR-9)**: scheduled `prune` job — articles + embeddings
  > 30 days, digests > 90 days (admin-configurable in `settings`); idempotency keys kept
  longer so pruned items aren't re-ingested.
- **Graceful shutdown** flushes pending notifications (FR-31).

**Out / deferred**: additional sources + polish UI (M7).

**Parallelization** — *three largely independent concerns.*
- **Track A — Scheduling** (plainjob cron run-start, manual "run now", overlap guard).
  Touches the queue/coordinator from M1.
- **Track B — Notifications** (per-user ntfy client, debounce/batch queue, deep-links,
  automatic publish, `notification_state`) against a **fake ntfy endpoint**. Independent
  of A.
- **Track C — Retention/pruning** (`prune` job, `settings` for windows, keep-idempotency-
  keys logic). Independent of A/B; pure DB work.
- All three run **concurrently**; only the end-to-end DoD test needs them together.

**DoD**
- A scheduled tick triggers a full run producing per-user digests and **one ntfy push per
  user with a topic** (verified against a fake ntfy endpoint in fixtures). Debounce
  collapses a burst to one push. Prune job removes aged rows while re-runs still skip
  pruned URLs. Overlap guard verified. Tests green.

---

## M7 — Source Breadth & Polish

**Goal**: Remaining source types and the deferred management UI.

**Scope**
- **Sources (S4)**: `hackernews` (Firebase JSON API, score/age thresholds),
  `github-trending` (HTML fetch + parse, no official API), generic `scrape`
  (fetch → linkedom → Readability). Per-user private sources fully supported.
- **Polish UI (S5)**: usage/cost dashboard (per-run tokens/cost, NFR-7), advanced admin
  (users management depth, provider/model management, task-model tiers, thresholds,
  prompts, retention settings), run-detail drill-down.
- Hardening: adapter fixtures for the new sources; extend the offline E2E to include a
  scrape/Readability path and the new adapters.

**Parallelization** — *highly parallel; adapters share only the M2 `SourceAdapter` interface.*
- **Track A — Hacker News adapter** (+ fixtures). Independent.
- **Track B — GitHub Trending adapter** (HTML parse, + fixtures). Independent.
- **Track C — Generic scrape adapter** (fetch → linkedom → Readability, + fixtures).
  Reuses M3 extraction; independent.
- **Track D — Usage/cost dashboard** (per-run tokens/cost UI). Independent read-side UI.
- **Track E — Advanced admin** (users depth, provider/model + task-model tiers,
  thresholds, prompts, retention settings, run-detail drill-down). Independent UI/tRPC.
- Tracks A–E have **no interdependencies** — ideal for a wide fan-out of subagents; each
  lands with its own fixtures/tests.

**DoD**
- All five source types ingest under the common interface with fixtures; a scrape source
  flows through the full pipeline offline. Admin can manage providers, task-model tiers,
  thresholds, retention, and users from the UI. Usage dashboard reflects a run. Tests green.

---

## Dependency Graph

```
M1 (skeleton + queue) ──► M2 (ingestion + config + deploy/CI)
                              └──► M3 (extract + Stage A)
                                     └──► M4 (embed + cluster + per-user score)
                                            └──► M5 (synthesis + reader + citations)
                                                   └──► M6 (schedule + ntfy + prune)
                                                          └──► M7 (breadth + polish)
```

## Traceability Notes
- Requirements: FR-x / NFR-x in `REQUIREMENTS.md`. Technical choices: T1–T12 and §-refs
  in `TECHNICAL_DESIGN.md`. Sequencing: S1–S6 above.
- Deferred/revisit items (sqlite-vec, packaged local embeddings, polite fetching, scoring
  weight tuning, per-task model defaults) are tracked in `TECHNICAL_DESIGN.md` §15 and
  addressed opportunistically, not as blocking milestones.
