/**
 * Deterministic, branch-stable port allocation shared by the dev server and
 * Paseo's `servicePorts.portScript`.
 *
 * The same (service, branch) pair always maps to the same port within a fixed
 * range, so a given worktree/branch is stable across restarts while parallel
 * worktrees on different branches land on different ports and never collide.
 * Because it is pure (no socket probing, no shared state), the dev server and
 * Paseo independently compute the identical port for a branch.
 *
 * Range is `PASEO_PORT_RANGE` (e.g. "4300-4399") or DEFAULT_RANGE.
 */

export interface PortRange {
	start: number;
	end: number;
}

/** Project-specific band, chosen to avoid clashing with other local dev apps. */
export const DEFAULT_RANGE = "4300-4399";

export function parseRange(spec: string): PortRange {
	const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(spec);
	if (!match) {
		throw new Error(`Invalid port range: "${spec}" (expected "START-END")`);
	}
	const start = Number(match[1]);
	const end = Number(match[2]);
	if (start < 1 || end > 65535 || end < start) {
		throw new Error(
			`Invalid port range: "${spec}" (bounds must be 1-65535 and START <= END)`,
		);
	}
	return { start, end };
}

export function resolveRange(env: NodeJS.ProcessEnv = process.env): PortRange {
	return parseRange(env.PASEO_PORT_RANGE ?? DEFAULT_RANGE);
}

/** FNV-1a 32-bit hash — small, fast, stable across runtimes. */
function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export interface AllocateOptions {
	service: string;
	branch?: string;
	range?: PortRange;
}

/** Map (service, branch) to a stable port inside the range. */
export function allocatePort({
	service,
	branch = "",
	range,
}: AllocateOptions): number {
	const { start, end } = range ?? resolveRange();
	const span = end - start + 1;
	const key = `${service}@${branch}`;
	return start + (fnv1a(key) % span);
}

/** Current git branch, or "" when detached / not a repo. */
export function currentGitBranch(): string {
	try {
		const proc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
		if (proc.exitCode !== 0) return "";
		const branch = proc.stdout.toString().trim();
		return branch === "HEAD" ? "" : branch;
	} catch {
		return "";
	}
}

/**
 * Resolve the port a service should bind to.
 *
 * Prefers Paseo's injected `$PASEO_PORT` (so the daemon's reverse proxy and our
 * process always agree). Outside Paseo (plain `bun run dev`), it computes a
 * branch-stable port with the shared allocator, using `$PASEO_BRANCH_NAME` when
 * present, else the current git branch.
 */
export function resolveServerPort(
	service = "web",
	env: NodeJS.ProcessEnv = process.env,
): number {
	const injected = env.PASEO_PORT;
	if (injected) {
		const port = Number(injected);
		if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
	}
	const branch = env.PASEO_BRANCH_NAME ?? currentGitBranch();
	return allocatePort({ service, branch, range: resolveRange(env) });
}
