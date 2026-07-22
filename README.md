# Vagus — Automated Intelligence Briefing & Digest Platform

Vagus is an end-to-end automated news synthesis and intelligence briefing platform built with Bun, TypeScript, Hono, React 19, Tailwind CSS v4, tRPC, BetterAuth, and SQLite.

It ingests content from RSS feeds and web search queries, extracts key findings, clusters related articles into unified story topics, scores story relevance for individual user interest profiles, and synthesizes executive briefings complete with interactive favicon citations.

---

## Preference Adaptation & Feedback System

Vagus includes an adaptive feedback engine that continuously tailors digest generation to user preferences through explicit thumbs up / thumbs down interactions.

```
                  ┌──────────────────────────────────────────────┐
                  │            User Feedback Event               │
                  └──────────────────────┬───────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
      ┌─────────────────────────┐                 ┌──────────────────────────┐
      │   Source Weight Tuning  │                 │    Cluster Preference    │
      │   (user_source_weight)  │                 │   (interest_profile)     │
      └────────────┬────────────┘                 └────────────┬─────────────┘
                   │                                           │
                   ▼                                           ▼
      Adjust Multiplier (0.0x–2.0x)               Blend Preference Vector (EMA)
      0.0x = Mute all stories from source         V_new = 0.75·V_old + 0.25·V_cluster
```

### 1. Source Weight Tuning (`user_source_weight`)
- **Per-User Isolation**: Multi-tenant isolation ensures one user's source preferences do not affect global ingest or other users' digests.
- **Dynamic Multipliers**: Each source starts at a baseline weight of `1.0x`.
  - **Thumbs Up** on a source increments its weight multiplier (e.g. `1.0x` → `1.3x` → `1.6x` → `2.0x` max boost).
  - **Thumbs Down** on a source decrements its weight multiplier (e.g. `1.0x` → `0.7x` → `0.4x` → `0.1x` → `0.0x`).
- **Source Muting**: When a source's weight drops to `0.0x` (or $\le 0.1$), story clusters relying exclusively on that source receive a score of `0` (`"Source muted by user preference"`) and are excluded from synthesis.

### 2. Topic & Story Vector Adaptation
Clicking **Thumbs Up** or **Thumbs Down** on a **Story Cluster** card in the Digest Reader adapts the user's semantic profile without requiring manual keyword configuration:

- **Positive Vector Nudging (`positive_embedding`)**:
  - Clicking **Thumbs Up** extracts the cluster's primary article vector ($V_{cluster}$) and blends it into the user's positive preference vector using an **Exponential Moving Average**:
    $$V_{pos\_new} = 0.75 \cdot V_{pos\_old} + 0.25 \cdot V_{cluster}$$
  - Future stories with high cosine similarity to $V_{pos}$ receive a **relevance score boost** (up to $+0.20$).

- **Negative Vector Nudging (`negative_embedding`)**:
  - Clicking **Thumbs Down** blends the cluster vector into the user's negative preference vector:
    $$V_{neg\_new} = 0.75 \cdot V_{neg\_old} + 0.25 \cdot V_{cluster}$$
  - Future stories semantically similar to suppressed topics (e.g. personal banking listicles, product roundups, or unwanted niches) incur a **cosine similarity penalty** (up to $-0.30$). Stories penalized below the user's similarity threshold are filtered out automatically.

### 3. Feedback Audit Log (`user_feedback`)
- Every vote logs an immutable event record containing `user_id`, `target_type` (`"source"` or `"cluster"`), `target_id`, and `vote` (`1`, `-1`, or `0`).
- Users can review and reset their custom source weightings at any time in **Profile Management** or **Source Settings**.

---

## Recency & Sequential Run Deduplication

Vagus prevents repetitive digests when running multiple pipeline cycles per day:
- **`processed_key` Ingest Deduplication**: Permanently records canonical item keys to prevent re-ingesting raw articles.
- **Prior Digest History Filtering**: Before selecting clusters for a new run, the scoring engine queries all articles previously delivered in prior digests for that specific user.
- **Delta Synthesis**:
  - Clusters with **no new articles** since the user's last digest are assigned a score of `0` (`"Already delivered in previous digest"`) and filtered out.
  - Clusters with **fresh updates** (e.g., 1 new article published since the last run + background context) qualify as updated stories and are re-synthesized with the new developments highlighted.

---

## 8-Stage Automated Pipeline

```
[Fetch Sources] ──▶ [Extract Content] ──▶ [Stage A Headlines] ──▶ [Embed Vectors]
                                                                        │
[Notify User] ◄── [Format Briefing] ◄── [Stage C Assembly] ◄── [Stage B Synthesis] ◄── [Cluster & Score]
```

1. **Ingest (`fetch-source`)**: Fetches raw feeds with `processed_key` deduplication.
2. **Extract (`extract-article`)**: Crawls article text, parses metadata, and calculates reading times.
3. **Stage A (`stage_a_bullet`)**: Uses LLMs to produce concise 1-sentence headline bullets.
4. **Embed (`embed-article`)**: Generates dense vector embeddings using configured text embedding models.
5. **Cluster & Score (`cluster-run` & `score-user`)**: Performs cosine similarity clustering ($\ge 0.80$) and scores candidate clusters against user interest profiles, applying source weights and preference vector adjustments.
6. **Stage B (`synthesize-cluster`)**: Synthesizes cluster summaries, multi-source perspectives, event timelines, and citation keys.
7. **Stage C (`assemble-digest`)**: Assembles overall executive briefing digests with bulleted trend cards, key takeaways, why it matters, and quotes.
8. **Notify (`ntfy`)**: Dispatches push notifications via ntfy.sh with deep links to the Digest Reader.

---

## System Customization & LLM Prompts

- **DB-Driven Settings**: API keys, endpoints, worker concurrency, retention windows, and model routing choices are strictly database-backed.
- **Editable LLM Prompts**: System personas and user prompt templates across all pipeline stages (`stage_a_bullet`, `stage_b_synthesis`, `stage_c_assembly`, `scoring_tiebreaker`) can be edited directly in **Admin Settings** with `{{variable}}` substitution tags and one-click resets.

---

## Stack & Architecture

- **Runtime**: Bun workspace monorepo (`apps/server` + `apps/web`)
- **Backend**: Hono on `Bun.serve`, tRPC v10, BetterAuth, Kysely + `bun:sqlite`, plainjob queue
- **Frontend**: React 19, tRPC + TanStack Query, Tailwind CSS v4 (`bun-plugin-tailwind`)

---

## Local Development & Operations

### Start Server (Managed Detached Process)

```bash
bun run dev:agent         # Start detached background dev server
bun run dev:status        # Check running server status and port
bun run dev:stop          # Gracefully stop dev server
```

### Verification & Testing

```bash
bun run typecheck         # Typecheck server and web apps
bun run test              # Execute unit test suite (140+ passing tests)
```
