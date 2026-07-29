import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';

const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };
const THROTTLE_WINDOW_MS = 61_000;
const e2eOrigin = process.env.CODA_E2E_URL ?? 'http://localhost:3000';

interface ThrottleResponse {
  headers(): Record<string, string>;
}

function throttleDelay(response: ThrottleResponse): number {
  const retryAfterSeconds = Number(response.headers()['retry-after']);
  return Number.isFinite(retryAfterSeconds) ? (retryAfterSeconds + 1) * 1_000 : THROTTLE_WINDOW_MS;
}

export async function waitForThrottleWindow(page: Page, response: ThrottleResponse): Promise<void> {
  await page.waitForTimeout(throttleDelay(response));
}

export async function gotoWithThrottlePatience(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const setupStatus = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/setup/status') && response.request().method() === 'GET',
    );
    await page.goto(url);
    const response = await setupStatus;
    if (response.status() !== 429) return;
    await waitForThrottleWindow(page, response);
  }
  throw new Error(`Setup status remained throttled while opening ${url}`);
}

export async function openScreenplayWithThrottlePatience(
  page: Page,
  screenplayId: string,
): Promise<void> {
  let throttledResponse: Response | undefined;
  const detailPath = `/api/v1/screenplays/${screenplayId}`;
  const captureThrottle = (response: Response) => {
    if (
      response.status() === 429 &&
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === detailPath
    ) {
      throttledResponse = response;
    }
  };
  page.on('response', captureThrottle);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throttledResponse = undefined;
      await gotoWithThrottlePatience(page, `/screenplays/${screenplayId}`);
      const editor = page.locator('.cm-content[contenteditable="true"]');
      const openError = page.getByText('Screenplay could not be opened.');
      await editor.or(openError).waitFor({ state: 'visible', timeout: 15_000 });
      if (await editor.isVisible()) return;
      if (!throttledResponse) {
        throw new Error(`Screenplay ${screenplayId} could not be opened without a 429 response`);
      }
      await waitForThrottleWindow(page, throttledResponse);
    }
  } finally {
    page.off('response', captureThrottle);
  }
  throw new Error(`Screenplay ${screenplayId} remained throttled after one full retry window`);
}

async function createEditorInvitation(
  owner: Page,
  screenplayId: string,
  title: string,
  email: string,
): Promise<string> {
  await gotoWithThrottlePatience(owner, `/screenplays/${screenplayId}/manage`);
  const dialog = owner.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill(email);
  const role = dialog.getByRole('button', { name: 'Role for invitation' });
  await role.click();
  await owner.getByRole('option', { name: 'editor' }).click();
  await expect(role).toContainText('editor');

  const invitationResponse = owner.waitForResponse(
    (response) =>
      response.url().includes(`/screenplays/${screenplayId}/invitations`) &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  const response = await invitationResponse;
  if (!response.ok()) {
    throw new Error(`Screenplay invitation failed with status ${String(response.status())}`);
  }
  const body = (await response.json()) as { data: { invitationUrl: string } };
  return body.data.invitationUrl;
}

async function submitInvitationAcceptance(page: Page): Promise<void> {
  const accept = page.getByRole('button', { name: 'Accept invitation' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acceptance = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/invitations/accept') &&
        response.request().method() === 'POST',
    );
    await accept.click();
    const response = await acceptance;
    if (response.status() !== 429) {
      if (!response.ok()) {
        throw new Error(`Invitation acceptance failed with status ${String(response.status())}`);
      }
      return;
    }
    await waitForThrottleWindow(page, response);
  }
  throw new Error('Invitation acceptance remained throttled after one full retry window');
}

export interface InvitedMember {
  context: BrowserContext;
  page: Page;
  displayName: string;
}

export async function inviteScreenplayEditor(
  browser: Browser,
  owner: Page,
  screenplay: { id: string; title: string },
  suffix: string,
): Promise<InvitedMember> {
  const displayName = `Morgan Member ${suffix}`;
  const invitationUrl = await createEditorInvitation(
    owner,
    screenplay.id,
    screenplay.title,
    `collab-${suffix}@example.test`,
  );
  const context = await browser.newContext({
    baseURL: e2eOrigin,
    storageState: EMPTY_STORAGE_STATE,
  });
  const page = await context.newPage();
  try {
    await gotoWithThrottlePatience(page, invitationUrl);
    await page.getByLabel('Name').fill(displayName);
    await page.getByRole('button', { name: /Continue/u }).click();
    const password = `collab-pass-${suffix}`;
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await submitInvitationAcceptance(page);
    await page.waitForURL(new RegExp(`/screenplays/${screenplay.id}$`));
    await openScreenplayWithThrottlePatience(page, screenplay.id);
    return { context, displayName, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
