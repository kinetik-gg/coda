import { defineConfig } from '@playwright/test';

import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/collaboration',
  timeout: 120_000,
});
