import { expect, test } from '@playwright/test';

import { createScreenplayViaApi, gotoWithSetupStatusRetry } from './support/harness';

const editorContent = '.cm-content';

// The scene heading deliberately avoids the substring "share" so the outline's scene button never
// collides with the exact-name lookup for the masthead "Share" affordance below.
function fountainFixture(title: string): string {
  return `Title: ${title}\n\nINT. STUDIO FLOOR - DAY\n\nADA\nWe write the page together.\n`;
}

// The screenplay-sharing happy path: an owner invites a collaborator from the management surface,
// a brand-new second user accepts the invitation (which creates their account and signs them in,
// so no login POST is issued and the per-IP login throttle is never touched), and that member then
// lands on the shared screenplay with role-appropriate, read-only UI.
test('owner shares a screenplay; an invited viewer accepts and opens it read-only', async ({
  page,
  browser,
}) => {
  const title = `Shared Screenplay ${Date.now()}`;
  const screenplayId = await createScreenplayViaApi(page, {
    title,
    sourceText: fountainFixture(title),
  });

  // The management URL still resolves. It now opens the screenplay library with this screenplay's
  // share modal presented, rather than a management page of its own (#169).
  await gotoWithSetupStatusRetry(page, `/screenplays/${screenplayId}/manage`);
  await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();
  const shareDialog = page.getByRole('dialog', { name: title });
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog).toHaveAttribute('aria-modal', 'true');
  // Members, invitations, and roles are all inside the one modal; none is a page any more.
  await expect(shareDialog.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(shareDialog.getByRole('heading', { name: 'Invitations' })).toBeVisible();
  await expect(shareDialog.getByRole('heading', { name: 'Roles' })).toBeVisible();
  // Focus enters the dialog rather than staying on the surface behind it.
  await expect(shareDialog.locator(':focus')).toHaveCount(1);

  const inviteEmail = `viewer-${Date.now()}@example.test`;
  await page.getByLabel('Email').fill(inviteEmail);
  // Invite as a read-only viewer so the accepted member gets a read-only editor.
  const roleSelect = page.getByRole('button', { name: 'Role for invitation' });
  await roleSelect.click();
  await page.getByRole('option', { name: 'viewer' }).click();
  // Confirm the selection registered before issuing the invitation.
  await expect(roleSelect).toContainText('viewer');

  const invitePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/screenplays/${screenplayId}/invitations`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const inviteResponse = await invitePromise;
  const invitePayload = (await inviteResponse.json()) as { data: { invitationUrl: string } };
  const invitationUrl = invitePayload.data.invitationUrl;
  expect(invitationUrl).toContain('/accept-invitation?token=');
  await expect(page.getByText('Invitation link created')).toBeVisible();

  // A fresh, unauthenticated browser context stands in for the invited collaborator.
  const memberContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(invitationUrl);
    await expect(memberPage.getByText(new RegExp(`join .${title}. as viewer`))).toBeVisible();

    await memberPage.getByLabel('Name').fill('Vera Viewer');
    await memberPage.getByRole('button', { name: /Continue/ }).click();
    const password = `viewer-pass-${Date.now()}`;
    await memberPage.getByLabel('Password', { exact: true }).fill(password);
    await memberPage.getByLabel('Confirm password').fill(password);
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click();

    // Acceptance lands the member directly on the shared screenplay.
    await memberPage.waitForURL(new RegExp(`/screenplays/${screenplayId}$`));
    // The member's role is exactly viewer: read-only, no management permission.
    const memberAccess = await memberPage.evaluate(async (id) => {
      const r = await fetch(`/api/v1/screenplays/${id}`);
      const b = (await r.json()) as { data: { access: { permissions: string[] } } };
      return b.data.access.permissions;
    }, screenplayId);
    expect(memberAccess).toEqual(['read_screenplay']);
    await expect(memberPage.getByLabel('screenplay name')).toHaveText(title);
    await expect(memberPage.getByRole('textbox', { name: 'Rename screenplay' })).toHaveCount(0);
    await expect(memberPage.locator(editorContent)).toContainText('STUDIO FLOOR');
    // A viewer has no manage access, so the masthead offers no Share affordance. Match the exact
    // accessible name so this never collides with substring matches (e.g. a "SHARE"-containing
    // scene heading rendered as an outline button).
    await expect(memberPage.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }

  // Escape dismisses the modal and returns to the bare library URL.
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: title })).toHaveCount(0);
  await expect(page).toHaveURL(/\/screenplays$/);
});
