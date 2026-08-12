import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { request, type APIResponse, type APIRequestContext } from '@playwright/test';

import { credentials, storageStatePath } from './harness';

const LOGIN_THROTTLE_WINDOW_MS = 61_000;
const ACTIVE_SPACE_STORAGE_KEY = 'coda:active-space-id';

interface StoredBrowserState {
  cookies: unknown[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

async function storeDefaultSpace(baseURL: string, defaultSpaceId: string): Promise<void> {
  const state = JSON.parse(await readFile(storageStatePath, 'utf8')) as StoredBrowserState;
  const origin = new URL(baseURL).origin;
  const retainedOrigins = state.origins.filter((entry) => entry.origin !== origin);
  retainedOrigins.push({
    origin,
    localStorage: [{ name: ACTIVE_SPACE_STORAGE_KEY, value: defaultSpaceId }],
  });
  await writeFile(storageStatePath, `${JSON.stringify({ ...state, origins: retainedOrigins })}\n`);
}

async function resolveDefaultSpaceId(context: APIRequestContext): Promise<string> {
  const response = await context.get('/api/v1/spaces');
  if (!response.ok()) throw new Error(`Listing Spaces failed with status ${response.status()}`);
  const body = (await response.json()) as { data: Array<{ id: string; isDefault: boolean }> };
  const defaultSpace = body.data.find((space) => space.isDefault);
  if (!defaultSpace) throw new Error('Expected the signed-in account to have a Default Space');
  return defaultSpace.id;
}

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
    const defaultSpaceId = await resolveDefaultSpaceId(context);
    await mkdir(dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: storageStatePath });
    await storeDefaultSpace(baseURL, defaultSpaceId);
  } finally {
    await context.dispose();
  }
}
