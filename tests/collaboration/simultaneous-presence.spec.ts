import { expect } from '@playwright/test';

import {
  editor,
  expectCollaborationReady,
  expectEditorContains,
  expectEditorsConverged,
  typeAtDocumentEnd,
} from './support/editor';
import { test } from './support/fixtures';

const injectDivergence = process.env.CODA_COLLAB_INJECT_DIVERGENCE === '1';

test('invited editors converge after simultaneous edits with visible presence', async ({
  collaboration,
}) => {
  const { member, owner } = collaboration;
  await Promise.all([expectCollaborationReady(owner), expectCollaborationReady(member.page)]);

  const ownerPresence = owner.getByLabel('2 collaborators present');
  const memberPresence = member.page.getByLabel('2 collaborators present');
  await expect(ownerPresence).toContainText(member.displayName);
  await expect(memberPresence).toContainText(`${member.displayName} (You)`);

  await member.page.bringToFront();
  await editor(member.page).click();
  await member.page.keyboard.press('ControlOrMeta+End');
  await member.page.keyboard.down('Shift');
  await member.page.keyboard.press('ArrowLeft');
  await member.page.keyboard.press('ArrowLeft');
  await member.page.keyboard.up('Shift');
  await expect(owner.locator('.cm-ySelection')).toBeVisible();
  await expect(owner.locator('.cm-ySelectionCaret')).toContainText(member.displayName);

  await Promise.all([
    typeAtDocumentEnd(owner, 'OWNER SIMULTANEOUS'),
    typeAtDocumentEnd(member.page, 'MEMBER SIMULTANEOUS'),
  ]);
  await Promise.all([
    expectEditorContains(owner, 'OWNER SIMULTANEOUS'),
    expectEditorContains(owner, 'MEMBER SIMULTANEOUS'),
    expectEditorContains(member.page, 'OWNER SIMULTANEOUS'),
    expectEditorContains(member.page, 'MEMBER SIMULTANEOUS'),
  ]);

  // This opt-in mutation proves the convergence oracle is live: the documented local sanity run
  // must fail while one client is isolated, whereas normal runs leave this branch disabled.
  if (injectDivergence) {
    await member.context.setOffline(true);
    await expect(member.page.getByText('CONNECTION OFFLINE')).toBeVisible();
    await typeAtDocumentEnd(member.page, 'INJECTED DIVERGENCE');
  }
  await expectEditorsConverged(owner, member.page);
});
