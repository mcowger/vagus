import type { MiddlewareHandler } from "hono";

export type LogMeta = Record<string, unknown>;

function emit(level: string, message: string, meta?: LogMeta): void {
	const line = { level, message, time: new Date().toISOString(), ...meta };
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(line));
}

export const log = {
	debug: (message: string, meta?: LogMeta) => emit("debug", message, meta),
	info: (message: string, meta?: LogMeta) => emit("info", message, meta),
	warn: (message: string, meta?: LogMeta) => emit("warn", message, meta),
	error: (message: string, meta?: LogMeta) => emit("error", message, meta),
};

export function requestId(): string {
	return crypto.randomUUID();
}

export function requestLogger(): MiddlewareHandler {
	return async (c, next) => {
		const start = performance.now();
		const headerReqId = c.req.header("x-request-id");
		const reqId =
			headerReqId && headerReqId.trim().length > 0
				? headerReqId
				: requestId();

		c.set("requestId", reqId);

		await next();

		const duration_ms = Math.round(performance.now() - start);
		c.header("x-request-id", reqId);

		log.info("request", {
			method: c.req.method,
			path: c.req.path,
			status: c.res.status,
			duration_ms,
			requestId: reqId,
		});
	};
}
