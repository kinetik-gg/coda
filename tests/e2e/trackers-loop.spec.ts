import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createTrackerFieldViaApi } from './support/harness';

/**
 * The tracker product loop (#384 S21): create a tracker from the library, give it an enum
 * field and records, group the board by that field and move a card between lanes, open the
 * share modal from the row menu, then move the tracker to trash. Field creation has no UI of
 * its own yet, so it rides the same API the workspace's socket invalidation listens to —
 * everything else happens through real controls.
 */

interface TrackerRecordSummary {
  id: string;
  title: string;
  version: number;
  values: Array<{ fieldId: string; option?: { id: string; label: string } | null }>;
}

async function listTrackerRecords(
  request: APIRequestContext,
  trackerId: string,
): Promise<TrackerRecordSummary[]> {
  const response = await request.get(`/api/v1/trackers/${trackerId}/records`);
  expect(response.ok(), 'listing tracker records').toBe(true);
  return ((await response.json()) as { data: TrackerRecordSummary[] }).data;
}

async function renameRecord(
  request: APIRequestContext,
  csrfToken: string,
  trackerId: string,
  record: TrackerRecordSummary,
  title: string,
): Promise<void> {
  const response = await request.patch(`/api/v1/trackers/${trackerId}/records/${record.id}`, {
    headers: { 'x-coda-csrf': csrfToken },
    data: { title, version: record.version },
  });
  expect(response.ok(), `renaming record to ${title}`).toBe(true);
}

/** Adds one record through the grid panel's Record menu and waits for its row to appear. */
async function addRecordFromUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Record panel actions' });
  await menu.waitFor();
  await menu.getByRole('menuitem', { name: 'Add record…' }).click();
  await page.getByText('New record', { exact: true }).first().waitFor();
}

async function openRowMenu(page: Page, trackerName: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${trackerName}` }).click();
  await page.getByRole('menu', { name: `Actions for ${trackerName}` }).waitFor();
}

test('creates a tracker, shapes fields and records, moves a board card, shares, and trashes it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const trackerName = `E2E Tracker ${suffix}`;
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'coda_csrf');
  if (!csrf) throw new Error('Expected the authenticated browser to have a CSRF cookie');

  // Create from the library; success lands directly in the new workspace.
  await page.goto('/trackers');
  await page.getByRole('button', { name: 'New tracker' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(trackerName);
  await page.getByRole('button', { name: 'Create tracker' }).click();
  await page.waitForURL(/\/trackers\/[0-9a-f-]+$/i);
  const trackerId = new URL(page.url()).pathname.split('/').at(-1)!;
  if (!/^[0-9a-f-]+$/i.test(trackerId)) throw new Error(`Unexpected tracker URL ${page.url()}`);
  await expect(page.getByText(trackerName.toUpperCase())).toBeVisible();

  // An enum field added via API arrives live through realtime field invalidation…
  await createTrackerFieldViaApi(page, trackerId, {
    name: 'Status',
    key: `status_${suffix.replaceAll('-', '_')}`,
    type: 'enum',
    options: [{ label: 'Backlog' }, { label: 'In progress', color: '#3873bb' }],
  });

  // …and two records are created with the grid panel's own Record menu.
  await addRecordFromUi(page);
  await addRecordFromUi(page);
  const created = await listTrackerRecords(page.request, trackerId);
  expect(created.map((record) => record.title).sort()).toEqual(['New record', 'New record']);
  const [draft, locked] = created;
  await renameRecord(page.request, csrf.value, trackerId, draft!, 'Draft beat');
  await renameRecord(page.request, csrf.value, trackerId, locked!, 'Locked cut');

  // Switch the panel to Board via the panel picker.
  await page.getByRole('button', { name: 'Records', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Board' }).click();
  await expect(
    page.getByText(/Choose a single-select field to group by in this panel.s View menu\./),
  ).toBeVisible();

  // The board's View menus list one entry per field, so they only render once the workspace
  // knows about the API-created field. It normally lands live over the socket; if creation
  // raced the room join, reloading recovers it — the board choice itself is already saved.
  if ((await page.getByRole('button', { name: 'Group by' }).count()) === 0) {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Group by' })).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(page.getByRole('button', { name: 'Group by' })).toBeVisible();

  // Group by the enum field; lanes materialize per option plus Unassigned.
  await page.getByRole('button', { name: 'Group by' }).click();
  await page
    .getByRole('menu', { name: 'Group by panel actions' })
    .getByRole('menuitemcheckbox', { name: 'Status' })
    .click();
  const unassignedLane = page.getByRole('region', { name: 'Unassigned lane' });
  await expect(unassignedLane).toBeVisible();
  await expect(unassignedLane.getByText('Draft beat')).toBeVisible();

  // Move a card between lanes through the card's move menu — the keyboard-reachable path.
  await page.getByRole('button', { name: 'Move Draft beat' }).click();
  await page
    .getByRole('menu', { name: 'Move Draft beat panel actions' })
    .getByRole('menuitem', { name: 'Move to In progress' })
    .click();
  const inProgressLane = page.getByRole('region', { name: 'In progress lane' });
  await expect(inProgressLane.getByText('Draft beat')).toBeVisible();
  await expect(unassignedLane).not.toContainText('Draft beat');
  // The move persists as a real enum cell write on the record.
  await expect
    .poll(async () => {
      const records = await listTrackerRecords(page.request, trackerId);
      return records
        .find((record) => record.id === draft!.id)
        ?.values.some((value) => value.option?.label === 'In progress');
    })
    .toBe(true);

  // Back to the library; share modal opens over it from the row menu.
  await page.getByRole('button', { name: '‹ Trackers' }).click();
  await page.waitForURL(/\/trackers$/);
  await openRowMenu(page, trackerName);
  await page.getByRole('menuitem', { name: 'Share…' }).click();
  const shareDialog = page.getByRole('dialog');
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.getByRole('heading', { name: trackerName })).toBeVisible();
  await expect(shareDialog.getByText('Control who can read and edit this tracker.')).toBeVisible();
  await shareDialog.getByRole('button', { name: 'Done' }).click();

  // Trash from the same row menu behind its confirmation.
  await openRowMenu(page, trackerName);
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  const confirmation = page.getByRole('dialog');
  await expect(confirmation.getByRole('heading', { name: 'Move tracker to trash?' })).toBeVisible();
  await confirmation.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByRole('button', { name: `Actions for ${trackerName}` })).toHaveCount(0);
});
