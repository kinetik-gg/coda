import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

export function requiredEnvironment(name: 'CODA_E2E_EMAIL' | 'CODA_E2E_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the end-to-end gate.`);
  return value;
}

export const credentials = () => ({
  email: requiredEnvironment('CODA_E2E_EMAIL'),
  password: requiredEnvironment('CODA_E2E_PASSWORD'),
});

/**
 * The whole suite authenticates the shared demo account exactly once (via global setup) and every
 * test restores this saved session, which keeps us well under the login rate limit. Only the
 * running demo stack is shared; each test still provisions its own screenplays and breakdowns.
 * Playwright always runs from the repository root, so the path resolves consistently from cwd.
 */
export const storageStatePath = join(process.cwd(), 'tests', 'e2e', '.auth', 'user.json');

export function slug(title: string): string {
  return title.toLowerCase().replace(/ /g, '-');
}

async function csrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'coda_csrf');
  if (!csrf) throw new Error('Expected a coda_csrf cookie in the restored session');
  return csrf.value;
}

async function authenticatedPost<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: { 'x-coda-csrf': await csrfToken(page) },
  });
  if (!response.ok()) {
    throw new Error(`POST ${path} failed with status ${response.status()}`);
  }
  return (await response.json()) as T;
}

/** Provisions a screenplay via API so editor scenarios can open it directly without UI chaining. */
export async function createScreenplayViaApi(
  page: Page,
  input: { title: string; sourceText: string },
): Promise<string> {
  const body = await authenticatedPost<{ data: { id: string } }>(
    page,
    '/api/v1/screenplays',
    input,
  );
  return body.data.id;
}

/** Provisions a movie-template breakdown via API for breakdown-management scenarios. */
export async function createBreakdownViaApi(page: Page, name: string): Promise<string> {
  const body = await authenticatedPost<{ data: { id: string } }>(
    page,
    '/api/v1/projects/from-template',
    { name, description: 'End-to-end fixture breakdown', templateId: 'movie' },
  );
  return body.data.id;
}

export async function expectPersistedSourceText(
  page: Page,
  screenplayId: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/screenplays/${id}`);
        const body = (await response.json()) as { data?: { sourceText?: string } };
        return body.data?.sourceText;
      }, screenplayId),
    )
    .toBe(expected);
}
