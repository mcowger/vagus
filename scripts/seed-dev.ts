#!/usr/bin/env bun
/**
 * Idempotent dev/test seeder: ensures a seeded admin user exists and mints an
 * API key for robot/API testing, writing the raw key to a gitignored
 * `.dev-api-key` file at the repo root.
 *
 * Gated: no-ops unless DEV_AUTH_ENABLED=true and NODE_ENV !== "production".
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auth, initAuthSchema } from "../apps/server/src/auth";
import { db } from "../apps/server/src/db/connection";

const ROOT = join(import.meta.dir, "..");
const KEY_FILE = join(ROOT, ".dev-api-key");

async function main(): Promise<void> {
	if (
		process.env.DEV_AUTH_ENABLED !== "true" ||
		process.env.NODE_ENV === "production"
	) {
		console.log("[seed-dev] skipped (DEV_AUTH_ENABLED != true or production)");
		return;
	}

	const adminEmail = (process.env.ADMIN_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean)[0];

	if (!adminEmail) {
		console.warn("[seed-dev] ADMIN_EMAILS is empty; cannot seed admin. Skipping.");
		return;
	}

	await initAuthSchema(auth);

	// Ensure the seeded admin user exists.
	let admin = db.sqlite
		.query("SELECT id FROM user WHERE email = ?")
		.get(adminEmail) as { id: string } | null;

	if (!admin) {
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		db.sqlite.run(
			"INSERT INTO user (id,email,name,role,isDisabled,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)",
			[id, adminEmail, adminEmail.split("@")[0], "admin", 0, 1, now, now],
		);
		admin = { id };
		console.log(`[seed-dev] created admin user ${adminEmail}`);
	}

	// Idempotent: skip minting if a key file already exists and is non-empty.
	if (existsSync(KEY_FILE) && readFileSync(KEY_FILE, "utf8").trim()) {
		console.log("[seed-dev] .dev-api-key already present; skipping key mint");
		return;
	}

	const created = await auth.api.createApiKey({
		body: { name: "dev-seed", userId: admin.id },
	});

	writeFileSync(KEY_FILE, `${created.key}\n`, { mode: 0o600 });
	console.log(`[seed-dev] minted dev API key -> ${KEY_FILE}`);
	console.log(`[seed-dev] key: ${created.key}`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[seed-dev] failed:", err);
		process.exit(1);
	});
