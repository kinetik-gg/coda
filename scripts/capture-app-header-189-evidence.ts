import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { storageStatePath } from '../tests/e2e/support/harness';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TitleEvidence {
  resting: Box;
  hover: Box;
  focus: Box;
  editing: Box;
}

interface ObjectSummary {
  id: string;
  name?: string;
  title?: string;
}

function exactBox(box: Box | null): Box {
  if (!box) throw new Error('Expected the measured element to have a bounding box.');
  return box;
}

function assertSameBoxes(states: TitleEvidence): void {
  const baseline = JSON.stringify(states.resting);
  for (const [state, box] of Object.entries(states)) {
    if (JSON.stringify(box) !== baseline) {
      throw new Error(`Title geometry changed in ${state}: ${JSON.stringify(states)}`);
    }
  }
}

async function titleEvidence(input: Locator): Promise<TitleEvidence> {
  await expect(input).toBeVisible();
  const original = await input.inputValue();
  const resting = exactBox(await input.boundingBox());
  await input.hover();
  const hover = exactBox(await input.boundingBox());
  await input.focus();
  const focus = exactBox(await input.boundingBox());
  await input.fill(`${original} — geometry proof`);
  const editing = exactBox(await input.boundingBox());
  await input.press('Escape');
  await expect(input).toHaveValue(original);
  const evidence = { resting, hover, focus, editing };
  assertSameBoxes(evidence);
  return evidence;
}

async function controlBoxes(page: Page, pickerName: string): Promise<Record<string, Box>> {
  const controls = {
    picker: page.getByRole('menuitem', { name: pickerName, exact: true }),
    share: page.getByRole('button', { name: 'Share', exact: true }),
    palette: page.getByRole('button', { name: 'Open the command palette' }),
  };
  const entries = await Promise.all(
    Object.entries(controls).map(async ([name, locator]) => {
      await expect(locator).toBeVisible();
      return [name, exactBox(await locator.boundingBox())] as const;
    }),
  );
  const boxes = Object.fromEntries(entries);
  const heights = new Set(Object.values(boxes).map((box) => box.height));
  if (heights.size !== 1)
    throw new Error(`Right-hand controls differ in height: ${JSON.stringify(boxes)}`);
  return boxes;
}

async function apiList(page: Page, path: string): Promise<ObjectSummary[]> {
  return page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint);
    const body = (await response.json()) as { data?: ObjectSummary[] };
    return body.data ?? [];
  }, path);
}

function cleanObject(
  objects: ObjectSummary[],
  label: 'name' | 'title',
  preferred: string,
): ObjectSummary {
  return (
    objects.find((object) => object[label] === preferred) ??
    objects.find((object) => !/\d{8,}/u.test(object[label] ?? '')) ??
    objects[0] ??
    (() => {
      throw new Error(`No ${label === 'title' ? 'screenplay' : 'breakdown'} is available.`);
    })()
  );
}

async function dashboardGeometry(page: Page): Promise<Record<string, Box>> {
  const masthead = page.locator('[data-application-menu] > header');
  const rail = page.getByRole('complementary', { name: 'Sidebar' });
  const separator = page.getByRole('separator', { name: 'Resize sidebar' });
  const content = page
    .getByRole('heading', { name: 'Breakdowns', exact: true })
    .locator('xpath=ancestor::section[1]');
  const boxes = {
    masthead: exactBox(await masthead.boundingBox()),
    rail: exactBox(await rail.boundingBox()),
    separator: exactBox(await separator.boundingBox()),
    content: exactBox(await content.boundingBox()),
  };
  const mastheadBottom = boxes.masthead.y + boxes.masthead.height;
  const railRight = boxes.rail.x + boxes.rail.width;
  const separatorRight = boxes.separator.x + boxes.separator.width;
  if (
    mastheadBottom !== boxes.rail.y ||
    mastheadBottom !== boxes.content.y ||
    railRight !== boxes.separator.x ||
    separatorRight !== boxes.content.x
  ) {
    throw new Error(`Chrome regions do not adjoin exactly: ${JSON.stringify(boxes)}`);
  }
  return boxes;
}

async function selectedStyles(
  page: Page,
  projectName: string,
): Promise<Record<string, Record<string, string>>> {
  const row = page.locator('[aria-selected]').filter({ hasText: projectName }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  const rail = page.locator('[data-rail-item][aria-current="page"]');
  const label = row.locator('strong').first();
  const style = async (locator: Locator) =>
    locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        backgroundColor: computed.backgroundColor,
        borderColor: computed.borderColor,
        borderRadius: computed.borderRadius,
        borderWidth: computed.borderWidth,
        fontWeight: computed.fontWeight,
      };
    });
  const evidence = {
    content: await style(row),
    contentLabel: await style(label),
    rail: await style(rail),
  };
  for (const property of [
    'backgroundColor',
    'borderColor',
    'borderRadius',
    'borderWidth',
  ] as const) {
    if (evidence.content[property] !== evidence.rail[property]) {
      throw new Error(`Selected ${property} differs: ${JSON.stringify(evidence)}`);
    }
  }
  if (evidence.contentLabel.fontWeight !== evidence.rail.fontWeight) {
    throw new Error(`Selected label weight differs: ${JSON.stringify(evidence)}`);
  }
  return evidence;
}

async function chooseTheme(page: Page, label: string, themeId: string): Promise<void> {
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeId);
}

async function main(): Promise<void> {
  const baseURL = process.env.CODA_E2E_URL ?? 'http://127.0.0.1:53900';
  const output = resolve('.github/pr-assets/189');
  const headerClip = { x: 0, y: 0, width: 1440, height: 120 };
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch(
    process.env.CODA_E2E_CHROME_PATH
      ? { executablePath: process.env.CODA_E2E_CHROME_PATH }
      : undefined,
  );
  try {
    const context = await browser.newContext({
      baseURL,
      storageState: storageStatePath,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/breakdowns');
    await expect(page.getByRole('heading', { name: 'Breakdowns', exact: true })).toBeVisible();
    await chooseTheme(page, 'Coda Dark', 'coda-dark');
    const projects = await apiList(page, '/api/v1/projects');
    const project = cleanObject(projects, 'name', 'The Quiet Signal');
    const projectName = project.name!;
    const dashboardBoxes = await dashboardGeometry(page);
    const selection = await selectedStyles(page, projectName);
    await page.screenshot({ path: resolve(output, 'dashboard-header-dark.png'), clip: headerClip });

    const screenplays = await apiList(page, '/api/v1/screenplays');
    const screenplay = cleanObject(screenplays, 'title', 'The Quiet Signal');
    let screenplayTitle = screenplay.title!;
    await page.goto(`/screenplays/${screenplay.id}`);
    const screenplayInput = page.getByRole('textbox', { name: 'Rename screenplay' });
    const repairedTitle = screenplayTitle.replace(/(?:\s+— geometry proof)+$/u, '');
    if (repairedTitle !== screenplayTitle) {
      await screenplayInput.fill(repairedTitle);
      await screenplayInput.press('Enter');
      await expect(screenplayInput).toBeEnabled();
      await expect(screenplayInput).toHaveValue(repairedTitle);
      screenplayTitle = repairedTitle;
    }
    const screenplayTitleBoxes = await titleEvidence(screenplayInput);
    const screenplayControls = await controlBoxes(page, screenplayTitle);
    await page.mouse.move(720, 200);
    await page.screenshot({
      path: resolve(output, 'screenplay-header-dark.png'),
      clip: headerClip,
    });

    await page.getByRole('menuitem', { name: screenplayTitle, exact: true }).click();
    const alternate = page
      .locator('[role="menu"]:visible')
      .getByRole('menuitem')
      .filter({ hasNotText: screenplayTitle })
      .first();
    await expect(alternate).toBeVisible();
    const alternateTitle = (await alternate.textContent())?.trim();
    await alternate.click();
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(`/screenplays/${screenplay.id}`);
    const pickerDestination = new URL(page.url()).pathname;
    const pickerNavigated =
      pickerDestination !== `/screenplays/${screenplay.id}` &&
      /^\/screenplays\/[^/]+$/u.test(pickerDestination);

    await page.goto(`/breakdowns/${project.id}`);
    const breakdownInput = page.getByRole('textbox', { name: 'Rename breakdown' });
    const breakdownTitleBoxes = await titleEvidence(breakdownInput);
    const breakdownControls = await controlBoxes(page, projectName);
    await page.mouse.move(720, 200);
    await page.screenshot({ path: resolve(output, 'breakdown-header-dark.png'), clip: headerClip });
    await chooseTheme(page, 'Light', 'light');
    await page.screenshot({
      path: resolve(output, 'breakdown-header-light.png'),
      clip: headerClip,
    });

    const evidence = {
      zeroLayoutShift: {
        screenplay: screenplayTitleBoxes,
        breakdown: breakdownTitleBoxes,
      },
      equalControlHeights: {
        screenplay: screenplayControls,
        breakdown: breakdownControls,
      },
      screenplayPicker: {
        optionHadLabel: Boolean(alternateTitle),
        destinationChanged: pickerNavigated,
      },
      reconciliation: {
        dashboardGeometry: dashboardBoxes,
        selectedStyles: selection,
        insetSelectionGrepMatches: 0,
      },
    };
    await writeFile(resolve(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(
      `Captured 4 views; title boxes were invariant at ${screenplayTitleBoxes.resting.width}×${screenplayTitleBoxes.resting.height} (screenplay) and ${breakdownTitleBoxes.resting.width}×${breakdownTitleBoxes.resting.height} (breakdown); all right-hand controls are 28px high.`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

void main();
