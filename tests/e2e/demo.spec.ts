import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  createBreakdownViaApi,
  createScreenplayViaApi,
  credentials,
  expectPersistedSourceText,
  slug,
} from './support/harness';

const editorContent = '.cm-content[contenteditable="true"]';

function fountainFixture(title: string): string {
  return `Title: ${title}\n\nINT. TEST STAGE - DAY\n\nADA\nIt works.\n`;
}

// Every test starts from the session saved by global setup (a single shared login) and then
// provisions its own fixtures — a fresh browser context plus API-created screenplays or breakdowns.
// Only the running demo stack is shared; they run in declaration order under a single worker
// (playwright.config sets fullyParallel: false) and no test depends on another's UI state, so a
// failure in one scenario no longer masks the rest.

// The authentication scenario intentionally starts signed out to exercise the login UI itself.
test.describe('unauthenticated entry', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logs in and edits a screenplay with autosave persistence', async ({ page }) => {
    const { email, password } = credentials();

    await page.goto('/');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();

    const screenplayTitle = `Automated Screenplay ${Date.now()}`;
    await page.getByRole('button', { name: 'New screenplay' }).click();
    await page.getByLabel('Title').fill(screenplayTitle);
    await page.getByRole('button', { name: 'Create screenplay' }).click();
    await page.waitForURL(/\/screenplays\/[0-9a-f-]+$/i);

    const fountainSource = fountainFixture(screenplayTitle);
    const editor = page.locator(editorContent);
    await editor.click();
    await page.getByRole('button', { name: 'Open the command palette' }).click();
    const screenplayPalette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(screenplayPalette.getByRole('option').filter({ hasText: 'Find…' })).toBeVisible();
    await expect(
      screenplayPalette.getByRole('option').filter({ hasText: 'Check Spelling and Grammar' }),
    ).toBeVisible();
    await expect(
      screenplayPalette.getByRole('option').filter({ hasText: 'Documentation' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+K');
    await expect(screenplayPalette).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Find…/u }).click();
    const searchPanel = page.locator('.cm-search');
    await expect(searchPanel).toHaveAttribute('data-coda-search-mode', 'find');
    await expect(searchPanel.locator('input[name="replace"]')).toBeHidden();
    await searchPanel.locator('button[name="close"]').click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Find and Replace…/u }).click();
    await expect(searchPanel).toHaveAttribute('data-coda-search-mode', 'replace');
    await expect(searchPanel.locator('input[name="replace"]')).toBeVisible();
    await searchPanel.locator('button[name="close"]').click();

    // ControlOrMeta maps to Cmd on macOS and Ctrl elsewhere, matching CodeMirror's select-all.
    await editor.press('ControlOrMeta+A');
    await editor.press('Backspace');
    await page.keyboard.insertText(fountainSource);
    await expect(page.getByRole('status')).toHaveText(/SAVED/);
    const screenplayId = new URL(page.url()).pathname.split('/').pop();
    if (!screenplayId) throw new Error('Expected a screenplay identifier in the editor URL');
    await expectPersistedSourceText(page, screenplayId, fountainSource);
    await expect(editor).toContainText('INT. TEST STAGE - DAY');
    await editor.press('Control+End');
    await editor.press('ArrowUp');
    const cursorTextOffset = await editor.evaluate((content) => {
      const selection = window.getSelection();
      if (!selection?.anchorNode) return -1;
      const range = document.createRange();
      range.setStart(content, 0);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return range.toString().length;
    });
    expect(cursorTextOffset).toBeGreaterThan(fountainSource.indexOf('ADA'));
  });
});

test('drives preview and editor view controls including zen mode', async ({ page }) => {
  const title = `View Controls ${Date.now()}`;
  const screenplayId = await createScreenplayViaApi(page, {
    title,
    sourceText: fountainFixture(title),
  });
  await page.goto(`/screenplays/${screenplayId}`);
  const editor = page.locator(editorContent);
  await expect(editor).toContainText('INT. TEST STAGE - DAY');

  const preview = page.getByLabel('Screenplay preview');
  await expect(preview).toHaveAttribute('data-preview-zoom', 'fit-width');
  await page.getByRole('button', { name: 'Preview zoom' }).click();
  await page.getByRole('option', { name: 'Fit Page' }).click();
  await expect(preview).toHaveAttribute('data-preview-zoom', 'fit-page');
  await page.getByRole('button', { name: 'Two-page view' }).click();
  await expect(preview).toHaveAttribute('data-page-view', 'two-page');

  const editorControls = page.getByRole('navigation', { name: 'Editor controls' });
  await editorControls.getByRole('button', { name: 'View' }).click();
  const pageBreaks = page.getByRole('menuitemcheckbox', { name: 'Estimated Page Breaks' });
  const pageBreaksInitially = await pageBreaks.getAttribute('aria-checked');
  expect(['true', 'false']).toContain(pageBreaksInitially);
  await pageBreaks.click();
  await editorControls.getByRole('button', { name: 'View' }).click();
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Estimated Page Breaks' }),
  ).toHaveAttribute('aria-checked', pageBreaksInitially === 'true' ? 'false' : 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const lineNumbers = page.getByRole('menuitemcheckbox', { name: 'Line Numbers' });
  await expect(lineNumbers).toHaveAttribute('aria-checked', 'true');
  await lineNumbers.click();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.getByRole('toolbar', { name: 'Zen writing controls' })).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await page.keyboard.press('Control+Alt+T');
  await expect(page.getByRole('button', { name: 'Typewriter Scrolling' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Control+Alt+F');
  await expect(page.getByRole('button', { name: 'Focus mode' })).toContainText('Paragraph Focus');
  await page.getByRole('button', { name: 'Exit Zen' }).click();
});

test('exports the screenplay to Fountain, PDF, and Final Draft', async ({ page }) => {
  const title = `Export Fixture ${Date.now()}`;
  const screenplayId = await createScreenplayViaApi(page, {
    title,
    sourceText: fountainFixture(title),
  });
  await page.goto(`/screenplays/${screenplayId}`);
  await expect(page.locator(editorContent)).toContainText('INT. TEST STAGE - DAY');

  const fountainDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Save Fountain Copy/ }).click();
  const fountainDownload = await fountainDownloadPromise;
  expect(fountainDownload.suggestedFilename()).toBe(`${slug(title)}.fountain`);
  expect(await fountainDownload.failure()).toBeNull();

  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^PDF/u }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe(`${slug(title)}.pdf`);
  expect(await pdfDownload.failure()).toBeNull();
  const pdfPath = await pdfDownload.path();
  if (!pdfPath) throw new Error('Expected the generated PDF to be available on disk.');
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');

  const fdxDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^Final Draft/ }).click();
  const fdxDownload = await fdxDownloadPromise;
  expect(fdxDownload.suggestedFilename()).toBe(`${slug(title)}.fdx`);
  expect(await fdxDownload.failure()).toBeNull();
  const fdxPath = await fdxDownload.path();
  if (!fdxPath) throw new Error('Expected the Final Draft export to be available on disk.');
  expect((await readFile(fdxPath, 'utf8')).slice(0, 100)).toContain('FinalDraft');
});

test('imports a Final Draft document into a new screenplay', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();

  const importedTitle = `Imported Final Draft ${Date.now()}`;
  const finalDraftXml = `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script" Template="No"><Content><Paragraph Type="Scene Heading"><Text>INT. IMPORT LAB - DAY</Text></Paragraph><Paragraph Type="Character"><Text>ADA</Text></Paragraph><Paragraph Type="Dialogue"><Text>${importedTitle}</Text></Paragraph></Content></FinalDraft>`;
  await page.locator('input[type="file"]').setInputFiles({
    name: `${importedTitle}.fdx`,
    mimeType: 'application/xml',
    buffer: Buffer.from(finalDraftXml),
  });
  await page.waitForURL(/\/screenplays\/[0-9a-f-]+$/i);
  await expect(page.locator(editorContent)).toContainText('IMPORT LAB');
  await expect(page.locator(editorContent)).toContainText(importedTitle);
});

test('creates a breakdown through the guided wizard and manages items', async ({ page }) => {
  await page.goto('/');

  // Account pages live behind the rail's Settings entry now (#163) — Developer is no longer a
  // top-level rail row.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings pages' })
    .getByRole('button', { name: 'Developer' })
    .click();
  await expect(page.getByRole('heading', { name: 'Developer', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a credential' })).toBeVisible();
  await page.getByRole('button', { name: 'Breakdowns' }).first().click();

  await page.getByRole('button', { name: 'New breakdown' }).click();
  await expect(page.getByRole('heading', { name: 'Breakdown details' })).toBeVisible();
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Help' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Open Source Credits…' }).click();
  const credits = page.getByRole('dialog', { name: 'Open Source Credits' });
  await expect(credits.getByRole('searchbox', { name: 'Search credits' })).toBeFocused();
  await expect(credits.getByText('Coda', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(credits).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(credits).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Help' })).toBeFocused();

  await page.getByRole('button', { name: 'Open the command palette' }).click();
  const setupPalette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(setupPalette.getByRole('option', { name: 'Breakdowns' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Breakdown template').click();
  await page.getByRole('option', { name: /Movie/ }).click();
  const projectName = `Automated Acceptance ${Date.now()}`;
  await page.getByLabel('Breakdown name').fill(projectName);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entity setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source document' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: /Invite a member/ })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Review and create' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and create' }).click();

  await page.waitForURL(/\/breakdowns\/[0-9a-f-]+$/i);
  await expect(page.getByText('Sequences', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Scenes', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Shots', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Add Sequence…' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New Sequence' });
  await createDialog.getByLabel('Title *').fill('Browser-created sequence');
  await createDialog.getByRole('button', { name: 'Create Sequence' }).click();
  const createdRow = page.getByRole('row').filter({ hasText: 'Browser-created sequence' });
  await expect(createdRow).toBeVisible();

  await createdRow.dblclick();
  const editDialog = page.getByRole('dialog', { name: 'Edit Sequence' });
  await editDialog.getByLabel('Title *').fill('Browser-edited sequence');
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Browser-edited sequence' })).toBeVisible();

  await page.keyboard.press('Control+K');
  const workspacePalette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(
    workspacePalette.getByRole('option').filter({ hasText: 'Reset Workspace…' }),
  ).toBeVisible();
  await expect(workspacePalette.getByRole('option', { name: projectName })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('menuitem', { name: 'Workspace' }).click();
  await page.getByRole('menuitem', { name: 'Reset Workspace…' }).click();
  const resetConfirmation = page.getByRole('dialog', { name: 'Reset workspace layout?' });
  await expect(resetConfirmation).toBeVisible();
  const resetResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/workspace-layout/reset'),
  );
  await resetConfirmation.getByRole('button', { name: 'Reset workspace' }).click();
  expect((await resetResponse).ok()).toBe(true);
  await page.getByRole('menuitem', { name: 'Workspace' }).click();
  await page.getByRole('menuitem', { name: 'Publish Default…' }).click();
  const publishConfirmation = page.getByRole('dialog', {
    name: 'Publish this layout as the default?',
  });
  await expect(publishConfirmation).toBeVisible();
  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/workspace-layout/publish'),
  );
  await publishConfirmation.getByRole('button', { name: 'Publish default' }).click();
  expect((await publishResponse).ok()).toBe(true);
});

test('renames, exports, and runs the trash lifecycle for a breakdown', async ({ page }) => {
  const projectName = `Managed Breakdown ${Date.now()}`;
  const breakdownId = await createBreakdownViaApi(page, projectName);
  await page.goto(`/breakdowns/${breakdownId}/manage`);

  // The default modal section owns breakdown details, so rename without leaving management.
  const renamedProject = `${projectName} verified`;
  const management = page.getByRole('dialog', { name: projectName });
  await management.getByLabel('Name', { exact: true }).fill(renamedProject);
  await management.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('dialog', { name: renamedProject })).toBeVisible();

  // Data operations are another section of the same shell configuration.
  await page
    .getByRole('dialog', { name: renamedProject })
    .getByRole('button', { name: 'Data operations' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/breakdowns/${breakdownId}/manage/data$`));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Breakdown JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('project.json');
  expect(await download.failure()).toBeNull();

  // Moving a breakdown to trash is destructive, so it is a confirmation raised from the library
  // row menu — the screenplay precedent, applied to breakdowns (#176).
  await page.goto('/breakdowns');
  const libraryRow = page.getByRole('row', { name: renamedProject });
  await libraryRow.getByRole('button', { name: `Actions for ${renamedProject}` }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  const trashDialog = page.getByRole('dialog', { name: 'Move breakdown to trash?' });
  await trashDialog.getByRole('button', { name: 'Move to trash' }).click();
  await expect(libraryRow).toBeHidden();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trashedProject = page.getByRole('row', { name: renamedProject });
  await expect(trashedProject).toBeVisible();
  await trashedProject.getByRole('button', { name: `Actions for ${renamedProject}` }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(trashedProject).toBeHidden();
  await page.getByRole('button', { name: 'Breakdowns', exact: true }).first().click();
  await expect(page.getByText(renamedProject, { exact: true }).first()).toBeVisible();
});

test('moves a screenplay to trash and restores it from the unified trash', async ({ page }) => {
  const title = `Trash Screenplay ${Date.now()}`;
  await createScreenplayViaApi(page, { title, sourceText: fountainFixture(title) });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Screenplays', exact: true })).toBeVisible();

  const libraryRow = page.getByRole('row', { name: title });
  await libraryRow.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  // Destructive actions confirm before they act (#169).
  const trashConfirmation = page.getByRole('dialog', { name: 'Move screenplay to trash?' });
  await trashConfirmation.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByRole('row', { name: title })).toBeHidden();

  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trashRow = page.getByRole('row', { name: title });
  await expect(trashRow).toBeVisible();
  await expect(trashRow.getByText('Screenplay', { exact: true })).toBeVisible();
  await trashRow.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(trashRow).toBeHidden();

  await page.getByRole('button', { name: 'Screenplays', exact: true }).first().click();
  await expect(page.getByRole('row', { name: title })).toBeVisible();
});
