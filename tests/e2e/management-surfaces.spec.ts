import { expect, test } from '@playwright/test';

import { createBreakdownViaApi } from './support/harness';

/*
 * #169 turned the management pages into modals over the surfaces they belong to, and #176 finished
 * the breakdown half. Two requirements ride on this suite. First, no management URL is retired: a
 * link someone saved to a screenplay's or a breakdown's sharing settings must still resolve, and
 * must still land on the equivalent surface. Second, management is reached the same way from the
 * library and from inside the object, for both object types.
 *
 * The screenplay half is asserted in `screenplay-sharing.spec.ts`, which already provisions a
 * screenplay — this suite shares one per-client create budget, so the breakdown half lives here
 * rather than provisioning a second screenplay for it, and both breakdown entry points are folded
 * into the specs that already provision a breakdown.
 */

test('every breakdown management URL resolves, with no management page under the share modal', async ({
  page,
}) => {
  const projectName = `Managed Breakdown ${Date.now()}`;
  const projectId = await createBreakdownViaApi(page, projectName);

  // Both share addresses open the breakdowns *library* with the modal presented — the exact
  // analogue of `/screenplays/:id/manage`. This is the defect #176 was opened for: the settings
  // page used to render underneath.
  for (const route of [
    `/breakdowns/${projectId}/manage`,
    `/breakdowns/${projectId}/manage/share`,
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Breakdowns', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Breakdown settings' })).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: projectName });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();
    // Focus enters the dialog rather than staying on the library behind it.
    await expect(dialog.locator(':focus')).toHaveCount(1);

    // The role picker is a portalled popup; #169 shipped with it rendering *behind* the modal
    // backdrop, which no unit test could catch. Interacting with it here pins the stacking order.
    const rolePicker = dialog.getByRole('button', { name: 'Breakdown role' });
    await rolePicker.click();
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: projectName })).toHaveCount(0);
    await expect(page).toHaveURL(/\/breakdowns$/);
  }

  // The structure sub-route resolves directly, and presents no modal at all.
  await page.goto(`/breakdowns/${projectId}/manage/structure`);
  await expect(page.getByRole('heading', { name: 'Breakdown settings' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Inside the shell frame, obeying the same geometry rule as the libraries: the rail is present
  // and the document itself never scrolls (#169).
  await expect(page.getByRole('navigation', { name: 'Coda pages' })).toBeVisible();
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
  expect(pageScrolls).toBe(false);

  // Even a page inside the breakdown raises sharing over itself rather than navigating (#176).
  await page.getByRole('button', { name: 'Share…' }).click();
  await expect(page.getByRole('dialog', { name: projectName })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/breakdowns/${projectId}/manage/structure$`));

  // And the breakdown workspace itself carries the affordance, in the same masthead position the
  // screenplay editor uses, opening the modal without leaving the breakdown being worked on.
  await page.goto(`/breakdowns/${projectId}`);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const workspaceShare = page.getByRole('dialog', { name: projectName });
  await expect(workspaceShare).toBeVisible();
  await expect(workspaceShare.getByRole('heading', { name: 'Members' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: projectName })).toHaveCount(0);
  // The URL never changed: sharing did not navigate away from the workspace.
  await expect(page).toHaveURL(new RegExp(`/breakdowns/${projectId}$`));
});

test('the breakdowns list inspects the selected breakdown and offers its row actions', async ({
  page,
}) => {
  const projectName = `Inspected Breakdown ${Date.now()}`;
  await createBreakdownViaApi(page, projectName);

  await page.goto('/breakdowns');
  await expect(page.getByRole('heading', { name: 'Breakdowns', exact: true })).toBeVisible();

  const pane = page.getByRole('complementary', { name: 'Inspector' });
  await expect(pane).toContainText('Select a breakdown');

  await page.getByRole('row', { name: projectName }).first().click();
  await expect(pane.getByRole('heading', { name: projectName, level: 2 })).toBeVisible();
  // Persistent detail resolves from the breakdown itself: the movie template seeds three levels.
  await expect(pane.locator('dt:text-is("Levels") + dd')).toHaveText('3');
  await expect(pane.getByRole('region', { name: 'Hierarchy' })).toContainText('Sequences');
  await expect(pane.getByRole('region', { name: 'Members' })).toBeVisible();

  // The pane's quick actions are the row menu's actions, in the row menu's order.
  const actions = pane.getByRole('group', { name: 'Quick actions' });
  // "Share…" is the one word for this operation, for both object types, on every surface (#176).
  await expect(actions.getByRole('button')).toHaveText([
    'Open',
    'Details…',
    'Share…',
    'Breakdown settings…',
    'Move to trash',
  ]);
  await actions.getByRole('button', { name: 'Details…' }).click();
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toHaveCount(0);
});
