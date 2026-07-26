# Repository Guide

This file is a compact repository map for contributors.

## Workspace map

- `apps/web` — React and Vite client.
- `apps/api` — NestJS API, Prisma schema, migrations, and seed utilities.
- `packages/contracts` — shared TypeScript and Zod contracts.
- `packages/design-tokens` — shared spacing, typography, and chrome tokens.
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
- New UI work must use `packages/design-tokens` for spacing, typography, and chrome sizing — import `@coda/design-tokens/tokens.css` (already wired into `apps/web/src/global.css`) for CSS, or the typed constants in `@coda/design-tokens` for non-CSS consumers. Do not hardcode a px value that already has a token in that package; color tokens remain in `apps/web/src/global.css`.
- Put database changes in `apps/api/prisma/schema.prisma` and add a matching migration.
- Keep API behavior within the relevant feature module under `apps/api/src`.
- Keep shared interface primitives under `apps/web/src/components` and workspace-specific UI under `apps/web/src/workspace`.
- Add tests beside the implementation using the existing `*.test.ts` or `*.test.tsx` convention.

## Interface type scale

Coda is a desktop application. Interface type comes from the six-step
`--coda-font-*` ladder in `packages/design-tokens/tokens.css`, which documents
the surface role that owns each step: `2xs` uppercase micro-labels, `xs` chrome
and dense data, `sm` supporting text, `md` page and dashboard body, `lg` section
headings, `xl` the single page header. Pick a step by role, not by eye.

`pnpm quality:font-tokens` fails any stylesheet under `apps/web/src` that spells
a pixel font size, and any `var(--coda-font-*)` reference to a token the design
tokens do not declare. Two exceptions are permitted, both matched on the
declaration value rather than a file path:

- `--screenplay-editor-font-size` and `--screenplay-effective-font-size`, the
  user-controlled script typography that drives PDF page fidelity. It is not
  part of the interface ladder and its `14px` fallback is the default script
  size.
- Sizes expressed relative to that script font (`0.75em`, `0.92em`, `1.08em` in
  `FountainEditor.module.css`) must stay em-relative and carry no pixel value.

Dense workspace surfaces scale a step with the user density control —
`calc(var(--coda-font-xs) * var(--workspace-text-scale, 1))`. Never multiply a
raw pixel base: the token is the readability floor.

## Data compatibility

Any change that touches a durable artifact — the `.codabk` backup format, the database schema, or an encrypted instance-configuration blob — must follow the standing rules in [`docs/data-compatibility.md`](docs/data-compatibility.md): versioned archive formats with the N / N-1 / N-2 import window, expand–contract migrations for breaking schema changes, and schema-versioned config blobs. Ship the migration path in the same change and keep the CI compatibility gates green.

## Verification

Before submitting a change, run the checks that cover the edited packages. Changes spanning the full workspace should pass quality checks, type-checking, tests, and the production build. Keep production modules within the enforced file, function, nesting, parameter, statement, complexity, and duplication limits; extract focused modules instead of suppressing a rule.
