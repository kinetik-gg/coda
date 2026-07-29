import { expect } from '@playwright/test';

import {
  editor,
  expectCollaborationReady,
  expectEditorContains,
  expectEditorsConverged,
  typeAtDocumentEnd,
} from './support/editor';
import { test } from './support/fixtures';

test('offline edits recover on reconnect and undo remains per-user', async ({ collaboration }) => {
  const { member, owner, screenplayId } = collaboration;
  await Promise.all([expectCollaborationReady(owner), expectCollaborationReady(member.page)]);

  await member.context.setOffline(true);
  await expect(member.page.getByText('CONNECTION OFFLINE')).toBeVisible();
  await typeAtDocumentEnd(member.page, 'MEMBER OFFLINE');
  await typeAtDocumentEnd(owner, 'OWNER ONLINE');
  await expectEditorContains(owner, 'OWNER ONLINE');
  await expect(editor(owner)).not.toContainText('MEMBER OFFLINE');

  await member.context.setOffline(false);
  await Promise.all([expectCollaborationReady(owner), expectCollaborationReady(member.page)]);
  await Promise.all([
    expectEditorContains(owner, 'MEMBER OFFLINE'),
    expectEditorContains(member.page, 'MEMBER OFFLINE'),
    expectEditorContains(member.page, 'OWNER ONLINE'),
  ]);
  await expectEditorsConverged(owner, member.page);

  // Separate the recovered transaction from the edit that this scenario will explicitly undo.
  await member.page.waitForTimeout(600);
  await typeAtDocumentEnd(owner, 'OWNER SURVIVES UNDO');
  await expectEditorContains(member.page, 'OWNER SURVIVES UNDO');
  await typeAtDocumentEnd(member.page, 'MEMBER UNDO TARGET');
  await expectEditorContains(owner, 'MEMBER UNDO TARGET');

  await editor(member.page).click();
  await member.page.keyboard.press('ControlOrMeta+z');
  await Promise.all([
    expect(editor(owner)).not.toContainText('MEMBER UNDO TARGET'),
    expect(editor(member.page)).not.toContainText('MEMBER UNDO TARGET'),
    expectEditorContains(owner, 'OWNER SURVIVES UNDO'),
    expectEditorContains(member.page, 'OWNER SURVIVES UNDO'),
  ]);
  await expectEditorsConverged(owner, member.page);

  await expect
    .poll(async () => {
      const response = await owner.request.get(`/api/v1/screenplays/${screenplayId}`);
      const body = (await response.json()) as { data: { sourceText: string } };
      return body.data.sourceText;
    })
    .toContain('OWNER SURVIVES UNDO');
});
