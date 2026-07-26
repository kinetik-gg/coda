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
});
