# syntax=docker/dockerfile:1

# ---- base: runtime OS packages and the package manager ----
FROM node:24-slim AS base
# OpenSSL is required by Prisma's query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.28.3
WORKDIR /app

# ---- deps: exact dependencies from the lockfile, Prisma client generated ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

# ---- build: compile TypeScript ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---- runtime: the image that actually runs ----
FROM base AS runtime
ENV NODE_ENV=production
# node_modules includes the Prisma CLI, used by the migrate service
# ("prisma migrate deploy"). A further split into separate migrate and app
# images would shrink the app image; kept as one image for simplicity.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma

# Never run as root inside the container.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health', { headers: { 'x-health-key': process.env.HEALTH_API_KEY } }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
