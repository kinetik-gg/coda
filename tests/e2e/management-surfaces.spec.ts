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

test('every breakdown management URL resolves to the same section state as modal navigation', async ({
  page,
}) => {
  const projectName = `Managed Breakdown ${Date.now()}`;
  const projectId = await createBreakdownViaApi(page, projectName);

  const assertSection = async (section: string, heading: string) => {
    const dialog = page.getByRole('dialog', { name: projectName });
    const navigation = dialog.getByRole('navigation', {
      name: 'Breakdown management sections',
    });
    await expect(navigation.getByRole('button', { name: section })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  };

  // The default management address lands on Details. Moving to Share inside the modal produces
  // the same URL and selected-section state as loading the Share deep link directly.
  await page.goto(`/breakdowns/${projectId}/manage`);
  await expect(page.getByRole('heading', { name: 'Breakdowns', exact: true })).toBeVisible();
  const defaultDialog = page.getByRole('dialog', { name: projectName });
  await expect(defaultDialog).toHaveAttribute('aria-modal', 'true');
  await assertSection('Details', 'Details');
  await defaultDialog
    .getByRole('navigation', { name: 'Breakdown management sections' })
    .getByRole('button', { name: 'Share' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/breakdowns/${projectId}/manage/share$`));
  await assertSection('Share', 'Share');

  for (const { route, section, heading } of [
    {
      route: `/breakdowns/${projectId}/manage`,
      section: 'Details',
      heading: 'Details',
    },
    {
      route: `/breakdowns/${projectId}/manage/share`,
      section: 'Share',
      heading: 'Share',
    },
    {
      route: `/breakdowns/${projectId}/manage/structure`,
      section: 'Entities & fields',
      heading: 'Entities & fields',
    },
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Breakdowns', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Breakdown settings' })).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: projectName });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await assertSection(section, heading);
    // Focus enters the dialog rather than staying on the library behind it.
    await expect(dialog.locator(':focus')).toHaveCount(1);

    if (section === 'Share') {
      await expect(dialog.getByRole('heading', { name: 'Members' })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();
      // The role picker is a portalled popup; interacting with it pins the stacking order.
      const rolePicker = dialog.getByRole('button', { name: 'Breakdown role' });
      await rolePicker.click();
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: projectName })).toHaveCount(0);
    await expect(page).toHaveURL(/\/breakdowns$/);
  }

  // A shell nested inside the structure section is topmost: the first Escape closes only the
  // field editor, and the second closes management. This protects dialog-stack ordering and
  // confirms the schema editor remains interactive inside the large configuration.
  await page.goto(`/breakdowns/${projectId}/manage/structure`);
  const structureDialog = page.getByRole('dialog', { name: projectName });
  await expect(structureDialog.getByRole('heading', { name: 'Custom fields' })).toBeVisible();
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
  expect(pageScrolls).toBe(false);
  await structureDialog.getByRole('button', { name: 'Add field' }).click();
  const fieldEditor = page.getByRole('dialog', { name: 'Add custom field' });
  await expect(fieldEditor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fieldEditor).toHaveCount(0);
  await expect(structureDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(structureDialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/breakdowns$/);

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

  const pane = page.getByRole('complementary', { name: 'Properties' });
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
    'Manage breakdown…',
    'Move to trash',
  ]);
  await actions.getByRole('button', { name: 'Details…' }).click();
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Breakdown details' })).toHaveCount(0);
});
