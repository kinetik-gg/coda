FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm db:generate && pnpm build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime
RUN apk add --no-cache tini && corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
RUN pnpm install --prod --frozen-lockfile
RUN pnpm --filter @coda/api prisma:generate
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node ops/container-entrypoint.sh /usr/local/bin/coda-entrypoint
RUN chmod 0555 /usr/local/bin/coda-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/coda-entrypoint"]
