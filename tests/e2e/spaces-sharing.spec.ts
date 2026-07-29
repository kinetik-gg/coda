import { expect, test } from '@playwright/test';

import { createScreenplayViaApi, createSpaceViaApi } from './support/harness';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const ACTIVE_SPACE_STORAGE_KEY = 'coda:active-space-id';

test('a Space member sees the moved screenplay and nothing left in Default', async ({
  page,
  browser,
}) => {
  const suffix = Date.now();
  const sharedTitle = `Space-only screenplay ${suffix}`;
  const privateTitle = `Default-only screenplay ${suffix}`;
  const spaceName = `Shared Space ${suffix}`;
  const sharedScreenplayId = await createScreenplayViaApi(page, {
    title: sharedTitle,
    sourceText: `Title: ${sharedTitle}\n\nINT. SPACE - DAY\n`,
  });
  await createScreenplayViaApi(page, {
    title: privateTitle,
    sourceText: `Title: ${privateTitle}\n\nINT. DEFAULT - DAY\n`,
  });
  const spaceId = await createSpaceViaApi(page, spaceName);

  // Default intentionally has no memberships. Its direct owner can nevertheless move a resource
  // out through the same UI path that operators use in production.
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: ACTIVE_SPACE_STORAGE_KEY,
    value: DEFAULT_SPACE_ID,
  });
  await page.goto('/screenplays');
  const row = page.getByRole('row', { name: sharedTitle, exact: true });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Actions for ${sharedTitle}` }).click();
  await page
    .getByRole('menu', { name: `Actions for ${sharedTitle}` })
    .getByRole('menuitem', { name: 'Move screenplay to Space…' })
    .click();
  const moveDialog = page.getByRole('dialog', { name: 'Move to Space' });
  await expect(moveDialog).toBeVisible();
  const destination = moveDialog.getByRole('button', { name: 'Destination Space' });
  await destination.click();
  await page.getByRole('option', { name: spaceName }).click();
  await expect(moveDialog.getByLabel('Members who gain access')).toContainText('None.');
  await moveDialog.getByRole('button', { name: 'Move to Space' }).click();
  await expect(moveDialog).toHaveCount(0);

  // Space invitations are the UI share path. A viewer is deliberately selected to exercise the
  // lowest tier, including its read-only editor state after acceptance.
  await page.goto(`/spaces/${spaceId}/manage`);
  const spaceDialog = page.getByRole('dialog', { name: spaceName });
  await expect(spaceDialog).toBeVisible();
  await spaceDialog
    .getByRole('navigation', { name: 'Space settings sections' })
    .getByRole('button', { name: 'Invitations' })
    .click();
  const inviteEmail = `space-viewer-${suffix}@example.test`;
  await spaceDialog.getByRole('textbox').fill(inviteEmail);
  const rolePicker = spaceDialog.getByRole('button', { name: 'Invitation role' });
  await rolePicker.click();
  await page.getByRole('option', { name: 'viewer' }).click();
  const invitePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/spaces/${spaceId}/invitations`) &&
      response.request().method() === 'POST',
  );
  await spaceDialog.getByRole('button', { name: 'Create invitation' }).click();
  const invite = (await (await invitePromise).json()) as { data: { invitationUrl: string } };

  const memberContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(invite.data.invitationUrl);
    await expect(memberPage.getByText(new RegExp(`join .${spaceName}. as viewer`))).toBeVisible();
    await memberPage.getByLabel('Name').fill('Space Viewer');
    await memberPage.getByRole('button', { name: /Continue/ }).click();
    const password = `space-viewer-pass-${suffix}`;
    await memberPage.getByLabel('Password', { exact: true }).fill(password);
    await memberPage.getByLabel('Confirm password').fill(password);
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click();

    await memberPage.goto('/screenplays');
    const library = memberPage.getByRole('table', { name: 'Screenplays' });
    await expect(library.getByRole('row')).toHaveCount(1);
    await expect(library.getByRole('row', { name: sharedTitle, exact: true })).toBeVisible();
    await expect(library).not.toContainText(privateTitle);
    const memberScreenplays = await memberPage.evaluate(async () => {
      const response = await fetch('/api/v1/screenplays?limit=100');
      const body = (await response.json()) as { data: Array<{ id: string }> };
      return body.data.map((screenplay) => screenplay.id);
    });
    expect(memberScreenplays).toEqual([sharedScreenplayId]);

    await library.getByRole('row', { name: sharedTitle, exact: true }).dblclick();
    await expect(memberPage).toHaveURL(new RegExp(`/screenplays/${sharedScreenplayId}$`));
    const permissions = await memberPage.evaluate(async (id) => {
      const response = await fetch(`/api/v1/screenplays/${id}`);
      const body = (await response.json()) as { data: { access: { permissions: string[] } } };
      return body.data.access.permissions;
    }, sharedScreenplayId);
    expect(permissions).toEqual(['read_screenplay']);
    await expect(memberPage.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
    await expect(memberPage.getByRole('textbox', { name: 'Rename screenplay' })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
