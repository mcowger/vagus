# News Digest Generator — Requirements

> Status: **Draft v0.2** — product behavior & requirements. Technology choices are
> fixed by the constraints below, but this document describes *what the system does*,
> not *how it is coded*. Tenancy and pipeline decisions in §9 are now resolved and
> folded into the requirements.

## 1. Overview

A self-hosted, web-based application that periodically gathers news from many
sources (news APIs, RSS/Atom, aggregators, scraped pages), runs it through a
vector + LLM pipeline (extract → dedupe/cluster → filter/score → synthesize),
and produces a **digest** on a schedule. Digests are viewable in a web dashboard
and announced via **ntfy** notifications.

Architecture mirrors [`mcowger/solar`](https://github.com/mcowger/solar): one Bun
process serving a Hono web server, a typed tRPC API to a React frontend,
BetterAuth on the same SQLite database, Kysely as the query builder. Ingestion,
idempotency, scheduling, and notification patterns follow
[`mcowger/gha`](https://github.com/mcowger/gha).

### 1.1 Fixed technology constraints

| Concern | Choice |
|---|---|
| Runtime / language | Bun + TypeScript |
| Web server | Hono |
| Frontend ↔ backend | tRPC (`@hono/trpc-server`) |
| Auth | BetterAuth (email/password + API keys, same SQLite DB) |
| LLM access | `@earendil-works/pi-ai` |
| Storage | SQLite |
| Query builder | Kysely (`kysely-bun-sqlite`) |
| Notifications | ntfy |
| Web UI | React SPA served by the Bun process |
| HTML extraction | `@mozilla/readability` |

### 1.2 Key design decision — embeddings

`@earendil-works/pi-ai` provides **chat/completion + tool calling only; it has no
embeddings endpoint.** Stage 2 semantic clustering therefore requires a **separate
embeddings provider**. **Decision: bring-your-own (BYO) OpenAI-compatible
`/v1/embeddings` endpoint** (e.g. `text-embedding-3-small`), configured by the
admin, independent of the chat-model configuration. The abstraction must stay open
to a **bundled/packaged local embedding model later** (no BYO lock-in in the data
model or interfaces). When no embedding provider is configured, the system degrades
gracefully to lexical/URL/title dedupe.

## 2. Personas & Roles

- **Admin** — first registered account (per Solar convention). Configures sources,
  schedules, providers/models, keys, notification targets; manages users; can do
  everything a user can.
- **User** — reads digests, manages their own interest profile / topic filters and
  their own notification subscriptions, triggers manual refreshes if permitted.
- **Automation (API key)** — a BetterAuth API key for scripted access (trigger a
  run, fetch the latest digest as JSON). Admin-scoped where appropriate.

**Tenancy: multi-tenant.** Each user has their own interest profile and receives
their own digest. Ingestion, extraction, embedding, and clustering are **shared**
(run once over a global article pool); **per-user scoring/filtering selects clusters,
then Stage B/C synthesis runs per user**. Each user gets **one combined digest per
interval** covering all their interests. See §9 for the full set of resolved decisions.

## 3. Functional Requirements

### 3.1 Source Management (web UI + tRPC)

- **FR-0 Source ownership (global pool + per-user additions)** — the admin maintains
  a **shared global source pool** available to all users. Each user may additionally
  add their **own private sources** on top. A user's digest draws from the global
  pool (as selected/subscribed) plus their private sources. Ingestion **fetches each
  distinct source once per run** regardless of how many users reference it (dedupe
  by source identity), then fans out to users at the scoring/synthesis stage.
- **FR-1** Admins manage global sources; users manage their own private sources.
  Both can add, edit, enable/disable, and delete sources they own. Supported
  source types:
  - `brave-news` — Brave News API query (extensible to other news APIs later).
  - `rss` — RSS/Atom feed URL (tech blogs, Substack, media outlets).
  - `hackernews` — Hacker News API (front page / top / Ask / Show, with score/age thresholds).
  - `github-trending` — GitHub Trending (language / time-window filters).
  - `scrape` — arbitrary web page URL(s), extracted via Readability.
- **FR-2** Each source has: type, human label, type-specific config (query, URL,
  filters), enabled flag, per-source schedule override (optional), and tags/topics.
- **FR-3** Source config is validated on save (URL reachability / feed parseability
  is best-effort tested and surfaced to the admin).
- **FR-4** Sources can be grouped/tagged so digests can be scoped to a subset.

### 3.2 Ingestion & Idempotency

- **FR-5** On each scheduled run (and on manual trigger), the system fetches new
  items from every enabled source.
- **FR-6** **Idempotent runs** (gha pattern): every item is keyed by a stable
  identity (URL, GUID, or source-specific ID). Already-processed items are skipped;
  publication timestamps and GUIDs are persisted. Re-running never reprocesses or
  duplicates.
- **FR-7** State is reconciled on cold start: if the run-state is lost but stored
  articles survive, the system rebuilds "already seen" from stored articles.
- **FR-8** Ingestion is concurrency-limited per stage (configurable, gha `p-limit`
  pattern) and resilient — one failing source does not fail the whole run.
- **FR-9** Items older than the current interval cutoff are discarded (configurable
  look-back window).

### 3.3 Processing & Analysis Pipeline

**Stage 1 — Extraction & Standardization**
- **FR-10** Clean raw HTML/text into a standard article object:
  `{ title, author, source, url, content, publish_date, image_url }`.
- **FR-11** Extract metadata and estimate reading time. HTML pages use
  `@mozilla/readability`.

**Stage 2 — Deduplication & Semantic Clustering**
- **FR-12** Compute embeddings for article titles/summaries (separate embedding
  provider, §1.2).
- **FR-13** Group articles covering the same event using cosine-similarity
  thresholding/clustering. Threshold is configurable.
- **FR-14** Within each cluster, identify the primary/breakthrough source vs.
  syndication/aggregators.
- **FR-15** Graceful fallback to lexical/title/URL dedupe when embeddings are
  unavailable.

**Stage 3 — Filtering & Scoring**
- **FR-16** Filter out clickbait, low-quality, and promotional content.
- **FR-17** Score relevance **per user** against that user's interest profile
  (keywords, topics, named entities, subscribed sources), using a **hybrid mechanism**:
  embedding similarity (profile vector vs. cluster centroid/primary-article embedding)
  as the primary ranker, **plus** keyword/entity-match boosts and **hard
  include/exclude rules**, **plus** an **optional cheap-LLM tiebreaker** applied only to
  borderline clusters near the threshold. Each user sees only clusters that pass their
  own threshold, capped at a configurable maximum count.
- **FR-18** Drop stories outside the current interval cutoff (reinforces FR-9).

### 3.4 LLM Synthesis & Summarization (pi-ai)

Hierarchical processing:
- **FR-19 (Stage A, article-level)** One-sentence bullet per article using a
  lightweight/cheap model. **Shared** — computed once per article, reused across users.
- **FR-20 (Stage B, cluster-level)** Multi-document synthesis **per user** for the
  clusters selected by that user's scoring: unified story summary noting consensus,
  differing perspectives across outlets, and key timeline details.
- **FR-21 (Stage C, digest-level)** Executive summary, top takeaways, "Why it
  matters" commentary, and key quotes — generated **per user** over their selected
  clusters, producing one combined digest per interval.
- **FR-22 Per-task model tiers** — the model is configurable **per pipeline task**, not
  just per stage. Tasks that demand quality (Stage B/C synthesis) can use a
  stronger/smarter model, while cheap high-volume tasks (Stage A bullets, the relevance
  tiebreaker in FR-17) use a fast/inexpensive model. Each task maps to a configured
  model selected from pi-ai's providers, with sensible defaults.

**Guardrails**
- **FR-23 Citation preservation** — every claim/bullet maps back to its source
  URL(s). The digest UI displays sources as usable inline chips + a per-story
  source list (Solar's cited-sources UX).
- **FR-24 Factuality** — strictly grounded summarization enforced via system
  prompts; the model must not introduce claims absent from the provided sources.

### 3.5 Digest Output & Web Dashboard

- **FR-25** A **web dashboard** lists digests (newest first) and renders a selected
  digest: executive summary, clustered stories with synthesized summaries, per-story
  source chips/links, images, and reading-time estimates.
- **FR-26 Verbosity control** — reader can toggle **TL;DR vs. Deep Dive** per digest
  (adjustable verbosity).
- **FR-27** A digest is addressable by stable URL/ID and retrievable as JSON via the
  API (for automation / notification deep-links).
- **FR-28** Dashboard shows run status/history (last run, next scheduled run,
  per-source success/failure, item counts).

### 3.6 Scheduling

- **FR-29** Digests are generated **on an interval** (cron-style schedule,
  configurable; gha daemon pattern). Manual "run now" trigger is available in the UI.
  A single global run performs shared ingest/embed/cluster, then per-user
  synthesis; each user's combined digest is produced within that run.
- **FR-30** Overlapping runs are prevented (a run in progress causes the next
  scheduled tick to be skipped, not queued twice).
- **FR-31** Graceful shutdown drains in-flight work and flushes pending
  notifications before exit.
- **FR-31b Scheduled pruning** — a recurring prune job enforces retention (NFR-9):
  removes articles + embeddings older than 30 days and digests older than 90 days
  (configurable), preserving idempotency keys.

### 3.7 Notifications (ntfy)

- **FR-32 Automatic publish** — when a user's digest is generated it is **immediately
  published and notified**; there is no review/approval step (gha-style, fully
  automatic). A notification is sent to that user's configured **ntfy** topic with a
  title, short summary, and a click-through deep-link to the digest (ASCII-safe headers).
- **FR-33** Notifications are **debounced/batched** so a burst produces at most one
  push per user per digest cycle.
- **FR-34** ntfy base URL is configurable (supports self-hosted instances).
- **FR-35** Each user configures **their own ntfy topic** as part of their profile
  (multi-tenant). A user with no topic configured simply receives no push.

### 3.8 Authentication & Administration (BetterAuth)

- **FR-36** Email/password auth; first registered account becomes **admin**.
- **FR-37** Admin can manage users (create, disable, role) and issue/revoke API keys.
- **FR-38** All management surfaces (sources, schedules, providers/models, embedding
  config, notification targets, prompts) live in the product UI (Solar's
  "operational surface in the product" philosophy).
- **FR-39** Optional email-domain allowlist for sign-up (Solar pattern).

## 4. Data Model (indicative, Kysely/SQLite)

Co-located in one SQLite DB with BetterAuth's tables (`user`, `session`, `account`,
`verification`). App tables (names indicative):

- `source` — id, **owner_user_id (NULL = global/admin pool)**, type, label, config(JSON),
  enabled, tags, schedule_override, timestamps.
- `user_source_subscription` — user_id, source_id (which global/private sources a user
  includes in their digest).
- `article` — id, source_id, url (unique), guid, title, author, content, publish_date,
  image_url, reading_time, embedding(BLOB/JSON), **stage_a_bullet (shared)**,
  fetched_at, **processed idempotency key**. Shared across all users.
- `cluster` — id, primary_article_id, centroid/threshold metadata. **Shared** (event-level,
  not user-scoped).
- `cluster_article` — cluster_id, article_id, role (primary/syndication).
- `interest_profile` — user_id, keywords, topics, entities, include/exclude rules,
  profile embedding, score threshold, max-cluster cap, ntfy topic.
- `processed_key` — idempotency keys (URL/GUID/source-id) retained independently of and
  longer than article content, so pruned articles are not re-ingested.
- `task_model` — pipeline task → configured model mapping (per-task tiers: synthesis vs.
  bullets vs. tiebreaker).
- `settings` — retention windows (articles/embeddings 30d, digests 90d), thresholds,
  prompts, ntfy base URL, and other admin-editable config.
- `digest` — id, **user_id**, created_at, interval_window, exec_summary, takeaways,
  why_it_matters, status. One per user per interval.
- `digest_cluster` — digest_id, cluster_id, per-user cluster synthesis (Stage B output),
  relevance_score.
- `citation` — id, digest_cluster_id/claim_ref, article_id, url.
- `run` — id, started_at, finished_at, status, per-source stats(JSON).
- `notification_state` — per-user pending queue / debounce bookkeeping.
- `app_meta`, chat-provider/model config, **embedding-provider config**.

## 5. Non-Functional Requirements

- **NFR-1** Single Bun process; no external queue, vector DB, or services bundle
  (Solar's "lightweight deployment"). Vector similarity computed in-process over
  SQLite-stored embeddings.
- **NFR-2** Deployable via Docker Compose; persistent data (SQLite + any cached
  assets) under a mounted `./data` dir.
- **NFR-3** `BETTER_AUTH_SECRET` ≥ 32 chars enforced/warned in production.
- **NFR-4** All secrets/config via environment variables; sane defaults for dev
  (mock LLM mode for zero-cost UI iteration is desirable).
- **NFR-5** Resilience: partial source failures, LLM errors, and missing embedding
  provider are handled without aborting the whole run.
- **NFR-6** Idempotency guarantees (FR-6/7) are a hard requirement — no duplicate
  articles or digests across restarts.
- **NFR-7** Cost awareness: token usage/cost per run surfaced (pi-ai reports usage);
  cheap-vs-strong model split per stage keeps cost bounded.
- **NFR-8** Health endpoint (`/healthz`) and structured request logging (Solar).
- **NFR-9 Retention/pruning** — a scheduled prune job keeps the DB bounded: articles +
  embeddings pruned at 30 days, digests at 90 days (both admin-configurable), while
  idempotency keys are retained longer so pruned articles are not re-ingested.

## 6. Out of Scope (initial)

- Assistant-UI / interactive chat (explicitly excluded).
- Email/Slack/Discord delivery (ntfy is the required channel; others are future).
- Non-web output formats (PDF/newsletter export) — future.
- Real-time streaming ingestion (batch/interval only).
- Digest review/approval workflow — publishing is fully automatic (FR-32).
- Bundled local embedding model — BYO only initially, abstraction kept open (§1.2).
- Multiple named interest profiles per user — one combined digest per user for now.

## 7. Success Criteria

- A scheduled run ingests from ≥2 source types, dedupes an event covered by multiple
  outlets into one shared cluster, then produces a **per-user cited digest** and pushes
  one ntfy notification **to each user with a topic configured**.
- Two users with different interest profiles receive **different** digests from the
  **same** shared article pool (per-user scoring/synthesis proven).
- A distinct source referenced by multiple users is **fetched once** per run.
- Re-running immediately produces **no** new articles/digests (idempotency proven).
- Every digest bullet links to at least one source URL (no uncited claims).

## 8. Milestone Sketch (for later planning)

1. **M1 Skeleton** — Bun/Hono/tRPC/SQLite/Kysely/BetterAuth; first-user-admin;
   healthz; empty dashboard.
2. **M2 Ingestion** — source CRUD + RSS + Hacker News; idempotent state; run history.
3. **M3 Pipeline** — Stage 1 extraction (+Readability), Stage A article bullets.
4. **M4 Clustering** — BYO embedding provider config, Stage 2 shared dedupe/cluster;
   per-user interest profiles + Stage 3 per-user scoring.
5. **M5 Synthesis** — shared Stage A bullets; per-user Stage B/C; citations UI;
   verbosity toggle; one combined digest per user.
6. **M6 Schedule + ntfy** — cron daemon, per-user debounced notifications, deep-links;
   automatic publish.
7. **M7 Breadth** — Brave News, GitHub Trending, scrape sources; per-user private
   sources; provider/model + embedding admin.

## 9. Resolved Decisions

1. **Tenancy** — **Multi-tenant.** Per-user interest profiles → per-user digests. ✅
2. **Pipeline structure** — **Shared ingest/extract/embed/cluster, per-user
   scoring + Stage B/C synthesis.** ✅
3. **Embedding provider** — **BYO OpenAI-compatible endpoint** initially; abstraction
   kept open to a packaged/local model later. ✅
4. **Source ownership** — **Global admin pool + per-user private additions.** ✅
5. **Digest granularity** — **One combined digest per user per interval** (single
   interest profile per user for now). ✅
6. **Publishing** — **Fully automatic**; publish + ntfy fire on generation, no review. ✅
7. **Retention** — **Articles + embeddings kept 30 days, digests 90 days, all
   configurable** in admin settings; a scheduled prune job enforces it. Idempotency
   keys (URL/GUID) are retained **separately and longer** than content so pruned
   articles are not re-ingested. ✅
8. **Content storage** — **Store the full Readability-extracted article text** for every
   ingested article within the retention window (needed for Stage B/C synthesis and
   citation grounding). Treated as a transient, private, self-hosted cache that
   auto-prunes at 30 days. ✅
9. **Relevance scoring** — **Hybrid**: embedding similarity to the user's profile is the
   primary ranker, with keyword/entity-match boosts and hard include/exclude rules, and
   an **optional LLM tiebreaker** only for borderline clusters near the threshold. ✅
