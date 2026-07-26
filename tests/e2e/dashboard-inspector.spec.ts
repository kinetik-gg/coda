import { expect, test, type Locator, type Page } from '@playwright/test';

import { createScreenplayViaApi } from './support/harness';

function fountainFixture(title: string): string {
  return `Title: ${title}\nAuthor: E. Tester\n\nINT. INSPECTOR BAY - DAY\n\nThe pane resolves.\n\nADA\nEvery field agrees with the document.\n\nEXT. CORRIDOR - LATER\n\nShe walks.\n`;
}

function pane(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

/** Reads a metadata value by its label, so assertions never depend on field ordering. */
function field(page: Page, label: string): Locator {
  return pane(page).locator(`dt:text-is("${label}") + dd`);
}

function renameDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Rename screenplay' });
}

/**
 * One journey rather than several, deliberately: `/api/v1/screenplays` is rate
 * limited per client and this suite shares one budget across every spec, so a
 * scenario that provisions a fresh pair of screenplays per test would push the
 * later specs into 429s. Two screenplays cover everything here — the second is
 * what makes keyboard traversal observable.
 */
test('inspects a selected screenplay, acts on it, and remembers its pane', async ({ page }) => {
  const prefix = `Inspector Subject ${Date.now()}`;
  for (const suffix of ['Alpha', 'Beta']) {
    const title = `${prefix} ${suffix}`;
    await createScreenplayViaApi(page, { title, sourceText: fountainFixture(title) });
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search screenplays' }).fill(prefix);

  const rows = page.getByRole('row').filter({ hasText: prefix });
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).getAttribute('aria-label');
  const second = await rows.nth(1).getAttribute('aria-label');
  if (!first || !second) throw new Error('Expected both filtered rows to be labelled');

  // Nothing selected: the pane states what it needs rather than showing empty fields.
  await expect(pane(page)).toContainText('Select a screenplay');

  // Select → inspect.
  await page.getByRole('row', { name: first }).click();
  await expect(pane(page).getByRole('heading', { name: first, level: 2 })).toBeVisible();
  await expect(page.getByRole('row', { name: first })).toHaveAttribute('aria-selected', 'true');

  // Metadata resolves from the document itself: two scene headings, and a page count
  // from the real layout engine rather than an estimate.
  await expect(field(page, 'Scenes')).toHaveText('2');
  await expect(field(page, 'Pages')).toHaveText('2');
  await expect(field(page, 'Revision')).toHaveText('1');
  await expect(field(page, 'Format')).toContainText('letter');
  await expect(field(page, 'Owner')).toContainText('you');
  await expect(pane(page).getByRole('region', { name: 'Recent revisions' })).toContainText(
    'no revision marks',
  );
  await expect(pane(page).getByRole('region', { name: 'Members' })).toBeVisible();

  // Act: the pane's quick actions are the row menu's actions, in the row menu's order.
  const actions = pane(page).getByRole('group', { name: 'Quick actions' });
  await expect(actions.getByRole('button')).toHaveText([
    'Open',
    'Rename…',
    'Share…',
    'Move to trash',
  ]);
  await actions.getByRole('button', { name: 'Rename…' }).click();
  await expect(renameDialog(page)).toBeVisible();
  await renameDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // The same verb reached from the row context menu runs the same handler.
  await page
    .getByRole('row', { name: first })
    .getByRole('button', { name: `Actions for ${first}` })
    .click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await expect(renameDialog(page)).toBeVisible();
  await renameDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // Selection follows the keyboard, and the pane follows the selection.
  await page.getByRole('row', { name: first }).press('ArrowDown');
  await expect(pane(page).getByRole('heading', { name: second, level: 2 })).toBeVisible();
  await expect(page.getByRole('row', { name: second })).toHaveAttribute('aria-selected', 'true');
  await expect(field(page, 'Pages')).toHaveText('2');

  // Resize and collapse, then prove both survive a reload.
  const separator = page.getByRole('separator', { name: 'Resize inspector' });
  const initialWidth = Number(await separator.getAttribute('aria-valuenow'));
  await separator.press('ArrowLeft');
  const widenedWidth = Number(await separator.getAttribute('aria-valuenow'));
  expect(widenedWidth).toBeGreaterThan(initialWidth);

  await page.getByRole('button', { name: 'Hide inspector' }).click();
  await expect(pane(page)).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show inspector' })).toBeVisible();
  await page.getByRole('button', { name: 'Show inspector' }).click();
  await expect(page.getByRole('separator', { name: 'Resize inspector' })).toHaveAttribute(
    'aria-valuenow',
    String(widenedWidth),
  );
});
