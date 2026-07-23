# Plan: Google-Only Auth + API Keys + Domain Whitelist

## Goal

Restrict authentication to **Google OAuth** for humans and **API keys** for robot
access. Remove email/password login entirely. Keep the existing **domain
whitelist** for who may create an account, and add an **admin email allowlist**.

Scope reminder: this app exists so users get occasional news updates. Data-loss
prevention, corporate edge-case hardening, and account migration are explicitly
**out of scope**.

## Decisions (agreed)

- **Email/password**: fully removed server-side (`emailAndPassword.enabled = false`),
  not merely hidden. No preservation/migration of existing email accounts.
- **Google OAuth**: `socialProviders.google` from `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`. Provider registered **only when both are present**; the
  app still boots without them (no hard crash). No hard-fail in prod for this.
- **Admin bootstrap**: via `ADMIN_EMAILS` env var (comma-separated,
  case-insensitive). Replaces the old "first user becomes admin" logic.
- **Admin vs domain whitelist**: admin emails **bypass** the domain whitelist.
  Everyone else must match `SIGNUP_ALLOWED_DOMAINS`.
- **API keys**: admin-only creation. Robot sends key via `x-api-key`; the key
  **resolves to the owning admin user** (inherits owner's role). No separate
  robot-role abstraction.
- **API-key management surface**: tRPC `adminProcedure` create/list/revoke +
  a small admin UI panel. Raw key shown **once** on creation.
- **Web UI**: single "Sign in with Google" button; remove signup page/route and
  email/password forms.
- **Dev/test login**: a dev-only `POST /dev/login` session-mint endpoint that
  **faithfully simulates a Google sign-in** — see below. Plus an idempotent seed
  script that preseeds an admin user and an API key.

## Authorization rules (single source of truth)

On user creation (real Google login OR `/dev/login`), the `databaseHooks.user.create`
hook decides:

1. Normalize email to lowercase.
2. If email ∈ `ADMIN_EMAILS` → `role = admin`, **skip** domain check.
3. Else if `SIGNUP_ALLOWED_DOMAINS` non-empty and email domain ∉ list → **reject**.
4. Else → `role = user`.
5. `isDisabled = false`.

Disabled users are rejected at session creation (existing behavior, retained).

## Dev/test tooling

All gated by **`DEV_AUTH_ENABLED=true` AND `NODE_ENV !== "production"`**. In
production these code paths are never mounted.

- **`POST /dev/login { email }`**: simulates Google sign-in. Runs the email
  through the *same* allowlist rules (`ADMIN_EMAILS` / `SIGNUP_ALLOWED_DOMAINS`),
  creates the user if allowed (like a first Google login), then mints a real
  better-auth session cookie. Rejects disallowed emails exactly as Google would.
  Safety property: **cannot create any account Google OAuth couldn't** — it only
  skips the Google redirect, not the authorization rules.
- **`scripts/seed-dev.ts`** (idempotent): ensures a seeded admin user exists
  (email from `ADMIN_EMAILS`); mints an API key via `auth.api.createApiKey`;
  writes the raw key to gitignored `.dev-api-key` and logs it. Skips if a valid
  `.dev-api-key` already exists.
- **`scripts/dev-server.sh`**: runs the seed script on start when
  `DEV_AUTH_ENABLED=true`.
- **`.gitignore`**: add `.dev-api-key`.

Agent workflow in dev:
- UI navigation: `POST /dev/login` → cookie → browse.
- Robot/API: read `.dev-api-key`, send as `x-api-key`.
- Rejection path: `POST /dev/login` with a non-whitelisted email → expect reject.

## Env vars

| Var | Purpose | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | provider skipped if unset |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | provider skipped if unset |
| `ADMIN_EMAILS` | comma-sep admin allowlist | case-insensitive; bypasses domain check |
| `SIGNUP_ALLOWED_DOMAINS` | comma-sep domain whitelist | existing; unchanged semantics |
| `DEV_AUTH_ENABLED` | enable dev login + seed | ignored when `NODE_ENV=production` |

## Work breakdown & parallelization

Streams marked **[P]** can run in parallel once the **Core** stream lands the
shared seam. The seam is: the exported auth instance shape, the `x-api-key`
resolution in tRPC context, and the authorization-rule hook.

### Stream 0 — Core auth (BLOCKING; do first)
- `apps/server/src/auth.ts`: disable email/password; add Google provider
  (conditional); configure `apiKey()` header resolution; rewrite user-create hook
  for `ADMIN_EMAILS` + domain whitelist; drop first-user-admin.
- `apps/server/src/trpc/context.ts`: resolve `x-api-key` → owning user.
- `apps/server/src/config.ts` (if needed): surface new env.
- Rewrite `apps/server/src/auth.test.ts` for the new rules.

Everything below depends only on the seam above and can then proceed in parallel:

### Stream A — API-key management [P]
- New `apps/server/src/trpc/routers/apiKeys.ts` (`adminProcedure` create/list/revoke).
- Register router in the tRPC app router.
- Tests for the router.

### Stream B — Web UI [P]
- `apps/web/src/pages/Login.tsx` → Google button only.
- Remove `apps/web/src/pages/Signup.tsx`, its route + links in `App.tsx`.
- `apps/web/src/lib/auth-client.ts`: drop `signUp`.
- Admin UI panel for API keys (depends on Stream A's router types for full wiring;
  the static UI/layout can start immediately, wiring lands after A).

### Stream C — Dev/test tooling [P]
- `POST /dev/login` endpoint (mounted only under `DEV_AUTH_ENABLED` + non-prod).
- `scripts/seed-dev.ts`.
- `scripts/dev-server.sh` wiring + `.gitignore`.

### Integration (after A/B/C)
- Full typecheck/lint/test pass across server + web.
- Manual smoke of `/dev/login` + `.dev-api-key`.

## Out of scope
- Preserving/migrating existing email accounts.
- Data-loss / disaster-recovery hardening.
- Robot/service-account role abstraction.
- Hard-fail on missing Google creds.
- Any dev-auth path reachable in production.
