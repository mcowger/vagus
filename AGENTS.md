# Agent Guidelines & Session Protocols

Guidance for AI agents and contributors working in this repository. See `docs/planning/` for requirements, technical design, and milestone specifications.

## Stack

- **Bun** runtime, **TypeScript** end-to-end, **Bun workspaces** monorepo (`apps/server` + `apps/web`).
- Server: **Hono** on `Bun.serve`, **tRPC**, **BetterAuth**, **Kysely** + `bun:sqlite`, **plainjob**.
- Frontend: **React 19**, **tRPC + TanStack Query**, **Tailwind CSS v4** via `bun-plugin-tailwind`.

## Start the Dev Server

**Agents and background use: use the managed dev-server scripts.** They detach the server into its own session with `setsid`, track it via `.dev-server.pid`, and log to `.dev-server.log` — no `nohup`/`disown`, no blocked shells, and clean process group termination on stop. **Never start the server with raw `... &`/`nohup` from an agent shell.**

```bash
bun run dev:agent         # start detached (polls /healthz, fails fast on error)
bun run dev:foreground    # start in foreground for debugging (agents should not use)
bun run dev:status        # check running status and assigned port
bun run dev:stop          # stop server process group and clean up pidfile
```

### Server Execution & Port Selection
- The server binds to a branch-stable port allocated by `scripts/port-allocator.ts` (or `$PASEO_PORT` / `$PORT` env override).
- Pidfile lives at `.dev-server.pid` and logs at `.dev-server.log` (gitignored).

## Live Styling (Tailwind CSS)

- **No manual CSS build step is required.**
- `bun-plugin-tailwind` is configured in `bunfig.toml`:
  ```toml
  [serve.static]
  plugins = ["bun-plugin-tailwind"]
  ```
- `apps/web/index.html` references `<link rel="stylesheet" href="./src/index.css" />`. Bun automatically compiles Tailwind CSS utility classes dynamically when serving static assets.

## UI & Design Conventions

- **Theme & Palette**: Dark-mode primary design leveraging Tailwind CSS v4 slate tones (`bg-slate-950`, `bg-slate-900/60`, `border-slate-800/80`) with emerald/amber/sky accent highlights.
- **Interactive Citations (`CitationPill`)**:
  - Never display raw internal article IDs (e.g., `art_123`) in reader UI.
  - Render source citations as interactive badges (`CitationPill`) containing:
    - Publisher domain favicon via `https://www.google.com/s2/favicons?domain=<hostname>&sz=32`
    - Clean domain name (e.g., `techcrunch.com`)
    - External hyperlink opening in a new tab (`target="_blank" rel="noopener noreferrer"`)
    - Full article title on hover.
  - Parse citation tags smoothly in continuous text blocks via `TextWithCitations`.
- **Task Model Matrix UI**:
  - Model assignment uses a unified 1-row-per-task mapping table (`TaskModels.tsx`) connecting task capabilities (Extraction, Embedding, Synthesis, Scoring, Formatting) to assigned providers and models.
  - Model dropdowns pull live dynamically from `/v1/models` and filter choices by required task modality (`text` vs `embedding`).

## Pipeline & Backend Conventions

- **DB-Driven Settings**: Provider credentials, API endpoints, system parameters, and model routing choices are strictly database-backed (`provider_config`, `system_setting`, `task_model`).
- **Pipeline Stage Cascade (`coordinator.ts`)**:
  - Pipeline execution auto-cascades through all 8 stages (`fetch` → `dedup` → `embed` → `cluster` → `score` → `synthesize` → `format` → `notify`).
  - Stage execution queries all active users from the `user` table and auto-provisions default user profiles when missing.
- **Broad Curator Mode & Dynamic Embeddings**:
  - Leaving user interest criteria empty defaults scoring to **Broad Curator Mode** (baseline score `0.50`), ensuring items qualify for downstream synthesis.
  - Profile vectors automatically re-embed using `getEmbedder(db)` whenever vector dimension mismatches (e.g., 128d mock vs 1536d OpenAI) are detected.

## Root Scripts (`package.json`)

| Command | What it does |
| --- | --- |
| `bun run dev:agent` | Managed detached dev server (preferred for background agents) |
| `bun run dev:foreground` | Run server interactively in foreground |
| `bun run dev:status` | Check dev server running state and port |
| `bun run dev:stop` | Gracefully stop dev server process group |
| `bun run port` | Print branch-allocated port for current worktree |
| `bun run typecheck` | Typecheck server and web apps |
| `bun run test` | Run test suite via `bun test` |

## Live Tests Protocol

- **Explicit Approval Required**: Executing live integration tests (e.g. `bun run test:live` or commands with `RUN_LIVE_TESTS=1`) is strictly prohibited without explicit user approval each and every time.

## Subagent Parallel Execution

- **Batch Subagent Dispatch**: When executing independent parallel tracks using subagents, ALL `task` tool calls MUST be invoked concurrently in the **same message turn**.
- **Do Not Serialise Spawns**: Calling `task` for one subagent in Turn N, waiting for its result, and calling `task` for another subagent in Turn N+1 executes tasks sequentially rather than in parallel. Always issue all `task` invocations in a single response turn when parallel execution is required.

## Verification & agent-browser

- **Run checks before finishing**: Always run `bun test` and `bun run typecheck` after making changes.
- **Visual Verification**: Use the `agent-browser` tool/CLI to verify UI features and end-to-end user flows in the browser.
- **Inspect Images**: Use the `read` tool to inspect generated screenshots (`.png`) and confirm page layout and styling.
