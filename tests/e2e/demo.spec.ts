import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function requiredEnvironment(name: 'CODA_E2E_EMAIL' | 'CODA_E2E_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the end-to-end gate.`);
  return value;
}

test('completes screenplay writing and breakdown management loops', async ({ page }) => {
  const email = requiredEnvironment('CODA_E2E_EMAIL');
  const password = requiredEnvironment('CODA_E2E_PASSWORD');

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

  const fountainSource = `Title: ${screenplayTitle}\n\nINT. TEST STAGE - DAY\n\nADA\nIt works.\n`;
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.keyboard.insertText(fountainSource);
  await expect(page.getByRole('status')).toHaveText(/SAVED/);
  const screenplayId = new URL(page.url()).pathname.split('/').pop();
  if (!screenplayId) throw new Error('Expected a screenplay identifier in the editor URL');
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/screenplays/${id}`);
        const body = (await response.json()) as { data?: { sourceText?: string } };
        return body.data?.sourceText;
      }, screenplayId),
    )
    .toBe(fountainSource);
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

  const fountainDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Save Fountain Copy/ }).click();
  const fountainDownload = await fountainDownloadPromise;
  expect(fountainDownload.suggestedFilename()).toBe(
    `${screenplayTitle.toLowerCase().replace(/ /g, '-')}.fountain`,
  );
  expect(await fountainDownload.failure()).toBeNull();

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

  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^PDF/u }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe(
    `${screenplayTitle.toLowerCase().replace(/ /g, '-')}.pdf`,
  );
  expect(await pdfDownload.failure()).toBeNull();
  const pdfPath = await pdfDownload.path();
  if (!pdfPath) throw new Error('Expected the generated PDF to be available on disk.');
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');

  const fdxDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^Final Draft/ }).click();
  const fdxDownload = await fdxDownloadPromise;
  expect(fdxDownload.suggestedFilename()).toBe(
    `${screenplayTitle.toLowerCase().replace(/ /g, '-')}.fdx`,
  );
  expect(await fdxDownload.failure()).toBeNull();
  const fdxPath = await fdxDownload.path();
  if (!fdxPath) throw new Error('Expected the Final Draft export to be available on disk.');
  expect((await readFile(fdxPath, 'utf8')).slice(0, 100)).toContain('FinalDraft');

  await page.getByRole('button', { name: 'Back to screenplays' }).click();
  await page.waitForURL('/');

  const importedTitle = `Imported Final Draft ${Date.now()}`;
  const finalDraftXml = `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script" Template="No"><Content><Paragraph Type="Scene Heading"><Text>INT. IMPORT LAB - DAY</Text></Paragraph><Paragraph Type="Character"><Text>ADA</Text></Paragraph><Paragraph Type="Dialogue"><Text>${importedTitle}</Text></Paragraph></Content></FinalDraft>`;
  await page.locator('input[type="file"]').setInputFiles({
    name: `${importedTitle}.fdx`,
    mimeType: 'application/xml',
    buffer: Buffer.from(finalDraftXml),
  });
  await page.waitForURL(/\/screenplays\/[0-9a-f-]+$/i);
  await expect(page.locator('.cm-content[contenteditable="true"]')).toContainText('IMPORT LAB');
  await expect(page.locator('.cm-content[contenteditable="true"]')).toContainText(importedTitle);
  await page.getByRole('button', { name: 'Back to screenplays' }).click();
  await page.waitForURL('/');

  await page.getByRole('button', { name: 'Developer' }).click();
  await expect(page.getByRole('heading', { name: 'Developer', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a credential' })).toBeVisible();
  await page.getByRole('button', { name: 'Breakdowns' }).first().click();

  await page.getByRole('button', { name: 'New breakdown' }).click();
  await expect(page.getByRole('heading', { name: 'Breakdown details' })).toBeVisible();
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

  await page.getByRole('menuitem', { name: 'Breakdown', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage current breakdown' }).click();
  await page.waitForURL(/\/breakdowns\/[0-9a-f-]+\/manage$/i);
  const renamedProject = `${projectName} verified`;
  const projectInformation = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Breakdown information' }),
  });
  await projectInformation.getByLabel('Name', { exact: true }).fill(renamedProject);
  const saveProject = projectInformation.getByRole('button', { name: 'Save changes' });
  await saveProject.click();
  await expect(saveProject).toBeDisabled();
  await expect(projectInformation.getByLabel('Name', { exact: true })).toHaveValue(renamedProject);

  await page.getByRole('button', { name: 'Danger' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Breakdown JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('project.json');
  expect(await download.failure()).toBeNull();

  await page.getByRole('button', { name: 'Move to trash…' }).click();
  const trashDialog = page.getByRole('dialog', { name: 'Move breakdown to trash?' });
  await trashDialog.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL('/breakdowns');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trashedProject = page.getByRole('article').filter({ hasText: renamedProject });
  await expect(trashedProject).toBeVisible();
  await trashedProject.getByRole('button', { name: 'Restore' }).click();
  await expect(trashedProject).toBeHidden();
  await page.getByRole('button', { name: 'Breakdowns', exact: true }).first().click();
  await expect(page.getByText(renamedProject, { exact: true }).first()).toBeVisible();
});
