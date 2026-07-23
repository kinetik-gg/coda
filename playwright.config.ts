import { defineConfig, devices } from '@playwright/test';

import { storageStatePath } from './tests/e2e/support/harness';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
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
