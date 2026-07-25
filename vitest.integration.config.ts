import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The integration suites share one live stack, and api.integration.test.ts
 * must run first (it bootstraps the owner from a virgin instance and spends
 * the per-IP login-throttle budget deliberately). Vitest's default sequencer
 * reorders files by cached duration, which can differ between machines —
 * sort by path so every environment runs the same order as CI.
 */
class PathOrderSequencer extends BaseSequencer {
  override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return Promise.resolve([...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId)));
  }
}

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    sequence: { sequencer: PathOrderSequencer },
  },
});
