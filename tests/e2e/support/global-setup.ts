import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { request } from '@playwright/test';

import { credentials, storageStatePath } from './harness';

/**
 * Signs the shared demo account in once and persists the session so every test starts
 * authenticated. Doing the single login here (instead of per test) keeps the suite comfortably
 * under the API login rate limit.
 */
export default async function globalSetup(): Promise<void> {
  const { email, password } = credentials();
  const baseURL = process.env.CODA_E2E_URL ?? 'http://localhost:3000';
  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post('/api/v1/auth/login', { data: { email, password } });
    if (!response.ok()) {
      throw new Error(`Global login failed with status ${response.status()}`);
    }
    await mkdir(dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.dispose();
  }
}
