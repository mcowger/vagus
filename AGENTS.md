# Agent Guidelines

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

## Root Scripts (`package.json`)

| Command | What it does |
| --- | --- |
| `bun run dev` / `dev:agent` | Managed detached dev server (preferred for background agents) |
| `bun run dev:foreground` | Run server interactively in foreground |
| `bun run dev:status` | Check dev server running state and port |
| `bun run dev:stop` | Gracefully stop dev server process group |
| `bun run port` | Print branch-allocated port for current worktree |
| `bun run typecheck` | Typecheck server and web apps |
| `bun run test` | Run test suite via `bun test` |

## Verification & agent-browser

- **Run checks before finishing**: Always run `bun test` and `bun run typecheck` after making changes.
- **Visual Verification**: Use the `agent-browser` tool/CLI to verify UI features and end-to-end user flows in the browser.
- **Inspect Images**: Use the `read` tool to inspect generated screenshots (`.png`) and confirm page layout and styling.
