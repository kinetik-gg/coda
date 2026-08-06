import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';

import {
  createScreenplayViaApi,
  createSpaceViaApi,
  defaultSpaceIdViaApi,
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

/**
 * A 429 and a 403 both mean "the request did not succeed", so an assertion of
 * `expect(response.status()).toBe(403)` cannot tell a working permission
 * check apart from a request the app's own per-IP throttle rejected before it
 * ever reached authorization (issue #289). Every permission assertion in this
 * spec goes through here instead, so a throttled run fails with an explicit
 * message naming the throttle rather than reporting a false permission
 * result — one that could as easily read as a pass on a luckier run.
 */
function expectPermissionStatus(response: APIResponse, expected: number, what: string): void {
  const status = response.status();
  if (status === 429 && expected !== 429) {
    throw new Error(
      `${what} was throttled (429) instead of returning ${expected}. This is the app's own ` +
        'per-IP request budget rejecting the request, not a permission result — it does not ' +
        'confirm or refute the authorization check under test.',
    );
  }
  expect(status, what).toBe(expected);
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
  const accept = page.getByRole('button', { name: 'Accept invitation' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/v1/invitations/accept') &&
        candidate.request().method() === 'POST',
    );
    await accept.click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(61_000);
  }
  await page.waitForURL(/\/$/);
  const bootstrapError = page.getByText('Coda could not reach its API.');
  if (await bootstrapError.isVisible()) {
    // The collaboration scenarios add browser contexts ahead of this test. If they exhaust the
    // shared setup-status IP window, let that fixed one-minute window roll before bootstrapping
    // the newly accepted member's authenticated dashboard.
    await page.waitForTimeout(61_000);
    await page.reload();
  }
  return { context, page };
}

interface SpaceRole {
  id: string;
  name: string;
}

interface SpaceManagement {
  data: {
    roles: SpaceRole[];
    memberships: Array<{ id: string; version: number; user: { email: string } | null }>;
  };
}

async function fetchSpaceManagement(page: Page, spaceId: string): Promise<SpaceManagement> {
  const response = await page.request.get(`/api/v1/spaces/${spaceId}/management`);
  expectPermissionStatus(response, 200, `Fetching management for space ${spaceId}`);
  return (await response.json()) as SpaceManagement;
}

/**
 * Creates the invitation via the same endpoint the settings dialog calls, instead of driving that
 * dialog through a full page navigation. The management surface's invite UI already has its own
 * coverage in the sharing settings suite; a full app boot here only spent this spec's own request
 * budget without exercising anything this test asserts on (issue #289).
 */
async function createSpaceInvitationViaApi(
  page: Page,
  spaceId: string,
  email: string,
  roleId: string,
): Promise<string> {
  const response = await page.request.post(`/api/v1/spaces/${spaceId}/invitations`, {
    headers: await csrfHeaders(page),
    data: { email, roleId },
  });
  expectPermissionStatus(response, 201, `Inviting ${email} to space ${spaceId}`);
  const body = (await response.json()) as { data: { invitationUrl: string } };
  return body.data.invitationUrl;
}

test('Space sharing reveals only moved screenplays and enforces viewer and contributor tiers', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
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

  const initialManagement = await fetchSpaceManagement(page, spaceId);
  const viewerRole = initialManagement.data.roles.find((role) => role.name === 'viewer');
  const contributorRole = initialManagement.data.roles.find((role) => role.name === 'contributor');
  expect(viewerRole, 'space ships a viewer role').toBeDefined();
  expect(contributorRole, 'space ships a contributor role').toBeDefined();

  const viewerInvitation = await createSpaceInvitationViaApi(
    page,
    spaceId,
    `space-viewer-${suffix}@example.test`,
    viewerRole!.id,
  );
  const viewer = await acceptInvitation(browser, viewerInvitation, 'Vera Viewer');
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
    expectPermissionStatus(viewerPrivate, 404, 'Viewer reading the unshared screenplay');
    expect(viewerDetail.data.access.permissions).toEqual(['read_screenplay']);
    expectPermissionStatus(
      await viewer.page.request.patch(`/api/v1/screenplays/${sharedScreenplayId}`, {
        headers: viewerHeaders,
        data: { title: 'Viewer cannot edit', version: viewerDetail.data.version },
      }),
      403,
      'Viewer renaming the shared screenplay',
    );
    expectPermissionStatus(
      await viewer.page.request.delete(`/api/v1/screenplays/${sharedScreenplayId}`, {
        headers: viewerHeaders,
      }),
      403,
      'Viewer deleting the shared screenplay',
    );
    expectPermissionStatus(
      await viewer.page.request.post(`/api/v1/spaces/${spaceId}/invitations`, {
        headers: viewerHeaders,
        data: {
          email: `blocked-${suffix}@example.test`,
          roleId: '00000000-0000-4000-8000-000000000001',
        },
      }),
      403,
      'Viewer creating a space invitation',
    );

    const management = await fetchSpaceManagement(page, spaceId);
    const viewerMembership = management.data.memberships.find(
      (membership) => membership.user?.email === `space-viewer-${suffix}@example.test`,
    );
    expect(viewerMembership, 'the accepted viewer has a membership').toBeDefined();
    const ownerHeaders = await csrfHeaders(page);
    expectPermissionStatus(
      await page.request.patch(`/api/v1/spaces/${spaceId}/memberships/${viewerMembership!.id}`, {
        headers: ownerHeaders,
        data: { roleId: contributorRole!.id, version: viewerMembership!.version },
      }),
      200,
      'Owner promoting the viewer to contributor',
    );

    const contributorHeaders = await csrfHeaders(viewer.page);
    const contributorShared = await viewer.page.request.get(
      `/api/v1/screenplays/${sharedScreenplayId}`,
    );
    const contributorDetail = (await contributorShared.json()) as {
      data: { version: number; access: { permissions: string[] } };
    };
    expect(contributorDetail.data.access.permissions).toEqual([
      'read_screenplay',
      'edit_screenplay',
    ]);
    expectPermissionStatus(
      await viewer.page.request.patch(`/api/v1/screenplays/${sharedScreenplayId}`, {
        headers: contributorHeaders,
        data: {
          sourceText: `${sourceText(sharedTitle)}\nCONNIE\nI can contribute.\n`,
          version: contributorDetail.data.version,
        },
      }),
      200,
      'Contributor editing the shared screenplay',
    );
    expectPermissionStatus(
      await viewer.page.request.delete(`/api/v1/screenplays/${sharedScreenplayId}`, {
        headers: contributorHeaders,
      }),
      403,
      'Contributor deleting the shared screenplay',
    );
    expectPermissionStatus(
      await viewer.page.request.post(`/api/v1/spaces/${spaceId}/invitations`, {
        headers: contributorHeaders,
        data: {
          email: `blocked-contributor-${suffix}@example.test`,
          roleId: '00000000-0000-4000-8000-000000000001',
        },
      }),
      403,
      'Contributor creating a space invitation',
    );
  } finally {
    await viewer.context.close();
    const defaultSpaceId = await defaultSpaceIdViaApi(page);
    await moveResourceToSpaceViaApi(
      page,
      'screenplay',
      sharedScreenplayId,
      defaultSpaceId,
      spaceId,
    );
    const ownerHeaders = await csrfHeaders(page);
    expect(
      (await page.request.delete(`/api/v1/spaces/${spaceId}`, { headers: ownerHeaders })).ok(),
    ).toBe(true);
  }
});
