import { defineConfig } from 'vitest/config';

// The SQLite portability lane (issue #77). Runs a curated, integration-adjacent subset directly
// against a throwaway SQLite file database (materialized by tests/sqlite/support/global-setup.ts via
// `prisma db push` from the derived schema.sqlite.prisma). Single-worker and no file parallelism:
// SQLite is single-writer, so concurrent workers would spuriously hit SQLITE_BUSY. Nothing ships on
// SQLite — this lane exists purely as the portability tripwire.
export default defineConfig({
  test: {
    include: ['tests/sqlite/**/*.test.ts'],
    globalSetup: ['tests/sqlite/support/global-setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
