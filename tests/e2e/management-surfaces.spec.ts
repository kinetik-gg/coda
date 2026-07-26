import { expect, test } from '@playwright/test';

import { createBreakdownViaApi } from './support/harness';

/*
 * #169 turned the management pages into modals over the surfaces they belong to. The hard
 * requirement attached to that change is that no management URL is retired: a link someone saved
 * to a screenplay's or a breakdown's sharing settings must still resolve, and must still land on
 * the equivalent surface. The screenplay half is asserted in `screenplay-sharing.spec.ts`, which
 * already provisions a screenplay — this suite shares one per-client create budget, so the
 * breakdown half lives here rather than provisioning a second screenplay for it.
 */

test('the breakdown management URL opens the settings surface with its share modal', async ({
  page,
}) => {
  const projectId = await createBreakdownViaApi(page, `Managed Breakdown ${Date.now()}`);

  await page.goto(`/breakdowns/${projectId}/manage`);

  await expect(page.getByRole('heading', { name: 'Breakdown settings' })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Members' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/breakdowns/${projectId}/manage/structure$`));

  // The structure sub-route resolves directly, without the modal.
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
  await expect(actions.getByRole('button')).toHaveText(['Open', 'Details…', 'Share…', 'Manage…']);
  await actions.getByRole('button', { name: 'Details…' }).click();
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toHaveCount(0);
});
