import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  createScreenplayViaApi,
  createSpaceViaApi,
  moveResourceToSpaceViaApi,
} from './support/harness';

function sourceText(title: string): string {
  return `Title: ${title}\n\nINT. SPACE STATION - DAY\n\nADA\nOnly Space members can read this.\n`;
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'coda_csrf');
  if (!csrf) throw new Error('Expected the authenticated browser to have a CSRF cookie');
  return { 'content-type': 'application/json', 'x-coda-csrf': csrf.value };
}

async function acceptInvitation(browser: Browser, invitationUrl: string, name: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(invitationUrl);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: /Continue/ }).click();
  const password = `spaces-pass-${Date.now()}-${name}`;
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(/\/$/);
  return { context, page };
}

async function createInvitationThroughSettings(
  page: Page,
  spaceId: string,
  email: string,
  role: 'viewer' | 'contributor',
): Promise<string> {
  await page.goto(`/spaces/${spaceId}/manage`);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Invitations' }).click();
  await dialog.getByRole('textbox').fill(email);
  await dialog.getByRole('button', { name: 'Invitation role' }).click();
  await page.getByRole('option', { name: role }).click();
  const invitationPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/spaces/${spaceId}/invitations`) &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create invitation' }).click();
  const response = await invitationPromise;
  const body = (await response.json()) as { data: { invitationUrl: string } };
  return body.data.invitationUrl;
}

test('Space sharing reveals only moved screenplays and enforces viewer and contributor tiers', async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const spaceName = `E2E Space ${suffix}`;
  const sharedTitle = `Space screenplay ${suffix}`;
  const privateTitle = `Default screenplay ${suffix}`;
  const spaceId = await createSpaceViaApi(page, spaceName);
  const sharedScreenplayId = await createScreenplayViaApi(page, {
    title: sharedTitle,
    sourceText: sourceText(sharedTitle),
  });
  const privateScreenplayId = await createScreenplayViaApi(page, {
    title: privateTitle,
    sourceText: sourceText(privateTitle),
  });
  await moveResourceToSpaceViaApi(page, 'screenplay', sharedScreenplayId, spaceId);

  const viewerInvitation = await createInvitationThroughSettings(
    page,
    spaceId,
    `space-viewer-${suffix}@example.test`,
    'viewer',
  );
  const contributorInvitation = await createInvitationThroughSettings(
    page,
    spaceId,
    `space-contributor-${suffix}@example.test`,
    'contributor',
  );
  const viewer = await acceptInvitation(browser, viewerInvitation, 'Vera Viewer');
  const contributor = await acceptInvitation(browser, contributorInvitation, 'Connie Contributor');
  try {
    await expect(
      viewer.page.getByRole('heading', { name: 'Screenplays', exact: true }),
    ).toBeVisible();
    await expect(viewer.page.getByText(sharedTitle, { exact: true })).toBeVisible();
    await expect(viewer.page.getByText(privateTitle, { exact: true })).toHaveCount(0);

    const viewerHeaders = await csrfHeaders(viewer.page);
    const viewerShared = await viewer.page.request.get(`/api/v1/screenplays/${sharedScreenplayId}`);
    const viewerPrivate = await viewer.page.request.get(
      `/api/v1/screenplays/${privateScreenplayId}`,
    );
    const viewerDetail = (await viewerShared.json()) as {
      data: { version: number; access: { permissions: string[] } };
    };
    expect(viewerPrivate.status()).toBe(404);
    expect(viewerDetail.data.access.permissions).toEqual(['read_screenplay']);
    expect(
      (
        await viewer.page.request.patch(`/api/v1/screenplays/${sharedScreenplayId}`, {
          headers: viewerHeaders,
          data: { title: 'Viewer cannot edit', version: viewerDetail.data.version },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewer.page.request.delete(`/api/v1/screenplays/${sharedScreenplayId}`, {
          headers: viewerHeaders,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewer.page.request.post(`/api/v1/spaces/${spaceId}/invitations`, {
          headers: viewerHeaders,
          data: {
            email: `blocked-${suffix}@example.test`,
            roleId: '00000000-0000-4000-8000-000000000001',
          },
        })
      ).status(),
    ).toBe(403);

    const contributorHeaders = await csrfHeaders(contributor.page);
    const contributorShared = await contributor.page.request.get(
      `/api/v1/screenplays/${sharedScreenplayId}`,
    );
    const contributorDetail = (await contributorShared.json()) as {
      data: { version: number; access: { permissions: string[] } };
    };
    expect(contributorDetail.data.access.permissions).toEqual([
      'read_screenplay',
      'edit_screenplay',
    ]);
    expect(
      (
        await contributor.page.request.patch(`/api/v1/screenplays/${sharedScreenplayId}`, {
          headers: contributorHeaders,
          data: {
            sourceText: `${sourceText(sharedTitle)}\nCONNIE\nI can contribute.\n`,
            version: contributorDetail.data.version,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await contributor.page.request.delete(`/api/v1/screenplays/${sharedScreenplayId}`, {
          headers: contributorHeaders,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await contributor.page.request.post(`/api/v1/spaces/${spaceId}/invitations`, {
          headers: contributorHeaders,
          data: {
            email: `blocked-contributor-${suffix}@example.test`,
            roleId: '00000000-0000-4000-8000-000000000001',
          },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await viewer.context.close();
    await contributor.context.close();
  }
});
