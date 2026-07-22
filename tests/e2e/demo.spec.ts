import { expect, test } from '@playwright/test';

function requiredEnvironment(name: 'CODA_E2E_EMAIL' | 'CODA_E2E_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the end-to-end gate.`);
  return value;
}

test('completes the authenticated project creation loop', async ({ page }) => {
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
  await page.getByLabel('Project name').fill('Automated Acceptance Project');
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
});
