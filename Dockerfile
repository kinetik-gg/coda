FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
# Node 26 no longer bundles corepack, so install it (pinned) before enabling the
# pnpm shim declared by the root packageManager field.
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

FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS runtime
# tini reaps zombies; postgresql17-client supplies pg_dump/pg_restore for the in-app
# backup engine (issue #52). The client major matches the postgres 17 server image.
# Pinned to an exact apk revision so the recovery-relevant runtime stays reproducible.
# node:26-alpine tracks alpine 3.24 (same base as the prior node:24-alpine pin), so
# the 17.10-r0 revision is unchanged and remains available for x86_64 and aarch64.
RUN apk add --no-cache tini postgresql17-client=17.10-r0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
RUN npm install -g corepack@0.35.0 \
  && corepack enable \
  && pnpm install --prod --frozen-lockfile \
  && pnpm --filter @coda/api prisma:generate \
  && corepack disable \
  && rm -rf \
    /root/.cache/node \
    /root/.local/share/pnpm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node ops/container-entrypoint.sh /usr/local/bin/coda-entrypoint
RUN chmod 0555 /usr/local/bin/coda-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/coda-entrypoint"]
