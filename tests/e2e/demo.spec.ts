import { expect, test } from '@playwright/test';

function requiredEnvironment(name: 'CODA_E2E_EMAIL' | 'CODA_E2E_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the end-to-end gate.`);
  return value;
}

test('completes an authenticated edit, export, trash, and restore loop', async ({ page }) => {
  const email = requiredEnvironment('CODA_E2E_EMAIL');
  const password = requiredEnvironment('CODA_E2E_PASSWORD');

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Developer' }).click();
  await expect(page.getByRole('heading', { name: 'Developer', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a credential' })).toBeVisible();
  await page.getByRole('button', { name: 'Projects' }).first().click();

  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'Project details' })).toBeVisible();
  await page.getByLabel('Project template').click();
  await page.getByRole('option', { name: /Movie/ }).click();
  const projectName = `Automated Acceptance ${Date.now()}`;
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entity setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source document' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: /Invite a member/ })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Review and create' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and create' }).click();

  await page.waitForURL(/\/projects\/[0-9a-f-]+$/i);
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

  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage current project' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/manage$/i);
  const renamedProject = `${projectName} verified`;
  const projectInformation = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Project information' }),
  });
  await projectInformation.getByLabel('Name', { exact: true }).fill(renamedProject);
  const saveProject = projectInformation.getByRole('button', { name: 'Save changes' });
  await saveProject.click();
  await expect(saveProject).toBeDisabled();
  await expect(projectInformation.getByLabel('Name', { exact: true })).toHaveValue(renamedProject);

  await page.getByRole('button', { name: 'Danger' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Project JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('project.json');
  expect(await download.failure()).toBeNull();

  await page.getByRole('button', { name: 'Move to trash…' }).click();
  const trashDialog = page.getByRole('dialog', { name: 'Move project to trash?' });
  await trashDialog.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL('/');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trashedProject = page.getByRole('article').filter({ hasText: renamedProject });
  await expect(trashedProject).toBeVisible();
  await trashedProject.getByRole('button', { name: 'Restore' }).click();
  await expect(trashedProject).toBeHidden();
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await expect(page.getByText(renamedProject, { exact: true }).first()).toBeVisible();
});
