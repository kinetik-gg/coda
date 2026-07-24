# syntax=docker/dockerfile:1

# Base image pinned by its multi-arch manifest-list (OCI image index) digest, not a
# platform child, so both architectures resolve from the same reference. node:26-alpine
# tracks alpine 3.24. Node 26 unbundles corepack, so it is installed explicitly.

# --- build: runs ONCE on the native builder platform ($BUILDPLATFORM), never emulated.
# Prisma's wasm schema parser misparses schema.prisma under QEMU aarch64 emulation, so
# every prisma invocation (db:generate here, prod-deps below) is confined to this native
# platform. The JS build is architecture-independent, so it also runs here just once.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
RUN npm install -g corepack@0.35.0 && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/fountain/package.json ./packages/fountain/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm db:generate && pnpm build

# --- prod-deps: also pinned to the native $BUILDPLATFORM. Produces the pruned,
# production-only node_modules and regenerates the Prisma client into it. The Prisma
# generator emits query engines for both musl targets (see schema.prisma binaryTargets),
# and argon2 ships all-arch prebuilds selected at runtime by node-gyp-build, so this tree
# is architecture-independent and is copied verbatim into either per-arch runtime.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS prod-deps
RUN npm install -g corepack@0.35.0 && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --prod --frozen-lockfile \
  && pnpm --filter @coda/api prisma:generate

# --- runtime: per-arch ($TARGETPLATFORM). Only copies prebuilt artifacts; no pnpm,
# corepack, or prisma ever executes here, so nothing runs under emulation at build time.
# tini reaps zombies; postgresql17-client supplies pg_dump/pg_restore for the in-app
# backup engine (issue #52). The client major matches the postgres 17 server image, and
# 17.10-r0 is the alpine 3.24 revision this base tracks (verified for x86_64 + aarch64).
# `prisma migrate deploy` still runs at boot (apps/api/src/boot) — but on real hardware,
# never emulated — using the prisma CLI, schema, and generated client copied below.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS runtime
# The bundled npm CLI is never used at runtime (the entrypoint execs node directly and
# boot-time migrations call the prisma CLI JS from node_modules), yet its vendored deps
# carry scanner-blocking CVEs (tar, brace-expansion, undici). Remove it entirely.
RUN apk add --no-cache tini postgresql17-client=17.10-r0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=prod-deps /app/apps/api/prisma ./apps/api/prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node ops/container-entrypoint.sh /usr/local/bin/coda-entrypoint
RUN chmod 0555 /usr/local/bin/coda-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/coda-entrypoint"]
