# Repository Guide

This file is a compact repository map for contributors.

## Workspace map

- `apps/web` — React and Vite client.
- `apps/api` — NestJS API, Prisma schema, migrations, and seed utilities.
- `packages/contracts` — shared TypeScript and Zod contracts.
- `docs` — public technical documentation that ships with the repository.
- `.github` — continuous integration and release automation.

## Common commands

Run commands from the repository root with pnpm.

- `pnpm install` — install workspace dependencies.
- `pnpm dev` — run the local development services.
- `pnpm quality` — run static analysis, size and complexity limits, duplication checks, and circular-dependency detection.
- `pnpm typecheck` — validate TypeScript projects.
- `pnpm test:unit` — run unit suites with the enforced coverage threshold.
- `pnpm test:integration` — run the API integration suite against disposable services.
- `pnpm test:e2e` — run the browser product-loop suite.
- `pnpm build` — create production builds.

Package-specific commands can be run with `pnpm --filter <package> <command>`.

## Change locations

- Put reusable request and response validation in `packages/contracts`.
- Put database changes in `apps/api/prisma/schema.prisma` and add a matching migration.
- Keep API behavior within the relevant feature module under `apps/api/src`.
- Keep shared interface primitives under `apps/web/src/components` and workspace-specific UI under `apps/web/src/workspace`.
- Add tests beside the implementation using the existing `*.test.ts` or `*.test.tsx` convention.

## Verification

Before submitting a change, run the checks that cover the edited packages. Changes spanning the full workspace should pass quality checks, type-checking, tests, and the production build. Keep production modules within the enforced file, function, nesting, parameter, statement, complexity, and duplication limits; extract focused modules instead of suppressing a rule.
