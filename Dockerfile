FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Copy package manifests and lockfile
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data

# Expose default server port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/vagus.sqlite

# Healthcheck targeting /healthz endpoint via Bun fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e 'fetch("http://localhost:" + (process.env.PORT || "3000") + "/healthz").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Run server
CMD ["bun", "run", "apps/server/src/index.ts"]
