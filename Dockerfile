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

# Expose server port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/vagus.sqlite

# Run server
CMD ["bun", "run", "apps/server/src/index.ts"]
