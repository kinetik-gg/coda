import {
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };
const THROTTLE_WINDOW_MS = 61_000;
const e2eOrigin = process.env.CODA_E2E_URL ?? 'http://localhost:3000';

function throttleDelay(response: APIResponse): number {
  const retryAfterSeconds = Number(response.headers()['retry-after']);
  return Number.isFinite(retryAfterSeconds) ? (retryAfterSeconds + 1) * 1_000 : THROTTLE_WINDOW_MS;
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
    await page.waitForTimeout(throttleDelay(response));
  }
  throw new Error(`Setup status remained throttled while opening ${url}`);
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
    await page.waitForTimeout(throttleDelay(response));
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
    return { context, displayName, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
