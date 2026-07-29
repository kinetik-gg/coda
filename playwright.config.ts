import { defineConfig, devices } from '@playwright/test';

import { storageStatePath } from './tests/e2e/support/harness';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Every browser file restores the same authenticated account. Space selection is account-visible,
  // so worker-level parallelism can make a newly created Space filter another file's library.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/support/global-setup.ts',
  use: {
    baseURL: process.env.CODA_E2E_URL ?? 'http://localhost:3000',
    storageState: storageStatePath,
    launchOptions: process.env.CODA_E2E_CHROME_PATH
      ? { executablePath: process.env.CODA_E2E_CHROME_PATH }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
