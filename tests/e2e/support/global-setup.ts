import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { request, type APIResponse, type APIRequestContext } from '@playwright/test';

import { credentials, storageStatePath } from './harness';

const LOGIN_THROTTLE_WINDOW_MS = 61_000;

/**
 * The integration suite may run against the same stack immediately before this gate and can
 * legitimately spend the per-IP login budget (for example while exercising account lockout).
 * A 429 here is therefore expected backpressure, not a failure: wait one throttle window and
 * retry once before giving up.
 */
async function login(
  context: APIRequestContext,
  data: { email: string; password: string },
): Promise<APIResponse> {
  const first = await context.post('/api/v1/auth/login', { data });
  if (first.status() !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, LOGIN_THROTTLE_WINDOW_MS));
  return context.post('/api/v1/auth/login', { data });
}

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
    const response = await login(context, { email, password });
    if (!response.ok()) {
      throw new Error(`Global login failed with status ${response.status()}`);
    }
    await mkdir(dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.dispose();
  }
}
