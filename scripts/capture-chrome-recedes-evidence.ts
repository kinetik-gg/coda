import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const themes = [
  ['coda-dark', 'Coda Dark'],
  ['light', 'Light'],
  ['catppuccin-mocha', 'Catppuccin Mocha'],
  ['dracula', 'Dracula'],
  ['nord', 'Nord'],
  ['gruvbox-dark', 'Gruvbox Dark'],
  ['solarized-dark', 'Solarized Dark'],
  ['tokyo-night', 'Tokyo Night'],
  ['one-dark', 'One Dark'],
  ['everforest', 'Everforest'],
  ['rose-pine', 'Rosé Pine'],
] as const;

const captures = [
  ['coda-dark', 'Coda Dark'],
  ['light', 'Light'],
  ['nord', 'Nord'],
] as const;

async function separatorWidth(page: Page): Promise<number> {
  const value = await page
    .getByRole('separator', { name: 'Resize sidebar' })
    .getAttribute('aria-valuenow');
  assert(value, 'The sidebar separator must expose aria-valuenow.');
  return Number(value);
}

async function chooseTheme(page: Page, id: string, label: string): Promise<void> {
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
  await page.locator(`html[data-theme="${id}"]`).waitFor();
}

async function toggleSidebar(page: Page, action: 'Hide' | 'Show'): Promise<void> {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${action} Sidebar`) }).click();
}

async function verifySplitterTone(page: Page, id: string, label: string): Promise<void> {
  await chooseTheme(page, id, label);
  const separator = page.getByRole('separator', { name: 'Resize sidebar' });
  await separator.hover();
  await page.waitForTimeout(220);
  const colors = await separator.evaluate((element) => {
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.backgroundColor = 'var(--coda-border-active)';
    const borderActive = getComputedStyle(probe).backgroundColor;
    probe.style.backgroundColor = 'var(--coda-selection)';
    const selection = getComputedStyle(probe).backgroundColor;
    const result = {
      actual: getComputedStyle(element).backgroundColor,
      borderActive,
      selection,
    };
    probe.remove();
    return result;
  });
  assert.equal(
    colors.actual,
    colors.borderActive,
    `${id} splitter must use the quiet border tone.`,
  );
  assert.notEqual(colors.actual, colors.selection, `${id} splitter must not use selection blue.`);
}

async function main(): Promise<void> {
  const email = process.env.CODA_E2E_EMAIL;
  const password = process.env.CODA_E2E_PASSWORD;
  const baseUrl = process.env.CODA_E2E_URL ?? 'http://127.0.0.1:3000';
  assert(email && password, 'CODA_E2E_EMAIL and CODA_E2E_PASSWORD are required.');

  const output = resolve('docs/assets/chrome-recedes-181');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(baseUrl);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Screenplays', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Breakdowns', exact: true }).click();
    await page.getByRole('heading', { name: 'Breakdowns', exact: true }).waitFor();

    const separator = page.getByRole('separator', { name: 'Resize sidebar' });
    const initialWidth = await separatorWidth(page);
    const bounds = await separator.boundingBox();
    assert(bounds, 'The visible sidebar separator must have bounds.');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + bounds.height / 2);
    await page.mouse.up();
    const draggedWidth = await separatorWidth(page);
    assert(draggedWidth > initialWidth, 'Dragging right must grow the leading sidebar.');

    await page.reload();
    await page.getByRole('heading', { name: 'Breakdowns', exact: true }).waitFor();
    assert.equal(
      await separatorWidth(page),
      draggedWidth,
      'Dragged width must persist after reload.',
    );

    await separator.focus();
    await separator.press('ArrowLeft');
    assert.equal(
      await separatorWidth(page),
      draggedWidth - 16,
      'ArrowLeft must shrink the sidebar.',
    );
    await separator.press('ArrowRight');
    assert.equal(await separatorWidth(page), draggedWidth, 'ArrowRight must grow the sidebar.');
    await separator.press('Home');
    assert.equal(await separatorWidth(page), 176, 'Home must select the minimum width.');
    await separator.press('End');
    assert.equal(await separatorWidth(page), 360, 'End must select the maximum width.');
    await separator.press('Home');
    for (let index = 0; index < 6; index += 1) await separator.press('ArrowRight');
    assert.equal(
      await separatorWidth(page),
      272,
      'Keyboard resizing must restore the evidence width.',
    );

    await toggleSidebar(page, 'Hide');
    await page.getByRole('complementary', { name: 'Sidebar' }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('separator', { name: 'Resize sidebar' }).count(), 0);
    await toggleSidebar(page, 'Show');
    await page.getByRole('complementary', { name: 'Sidebar' }).waitFor();
    assert.equal(await separatorWidth(page), 272, 'Show must restore the persisted sidebar width.');

    for (const [id, label] of themes) await verifySplitterTone(page, id, label);

    for (const [id, label] of captures) {
      await chooseTheme(page, id, label);
      await page.mouse.move(1000, 500);
      await page.waitForTimeout(220);
      await page.screenshot({ path: resolve(output, `dashboard-${id}.png`) });
    }

    console.log(
      `Captured ${captures.length} dashboard themes; verified drag/reload/keyboard/hide-show and ${themes.length} splitter tones.`,
    );
  } finally {
    await browser.close();
  }
}

void main();
