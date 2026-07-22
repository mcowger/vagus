#!/usr/bin/env bun
/**
 * Paseo `servicePorts.portScript`.
 *
 * Paseo runs this executable directly (no shell) in the worktree directory with
 * four positional args — service name, workspace ID, branch name, worktree path
 * — and the same values as env vars: PASEO_SCRIPTNAME, PASEO_WORKSPACE_ID,
 * PASEO_BRANCH_NAME, PASEO_WORKTREE_PATH. It prints exactly one branch-stable
 * TCP port to stdout.
 *
 * The `bun run dev` target inlines `port-allocator.ts` (same allocator), so the
 * dev server and Paseo agree on the port for a given branch with no shared
 * state. The server itself just binds `$PORT` / `--port`.
 */
import { allocatePort, resolveRange } from "./port-allocator";

// Positional args: [serviceName, workspaceId, branchName, worktreePath].
const [argService, , argBranch] = process.argv.slice(2);

const service = process.env.PASEO_SCRIPTNAME ?? argService ?? "web";
// A missing branch is passed as an empty string (default branch → stable port).
const branch = process.env.PASEO_BRANCH_NAME ?? argBranch ?? "";

const port = allocatePort({ service, branch, range: resolveRange() });
process.stdout.write(String(port));
