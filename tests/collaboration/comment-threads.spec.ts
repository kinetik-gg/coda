import { expect } from '@playwright/test';

import {
  expectCollaborationReady,
  expectEditorContains,
  expectEditorsConverged,
  openCommentsPanel,
  selectDocumentStart,
  typeAtDocumentStart,
} from './support/editor';
import { test } from './support/fixtures';

test('comment threads stay anchored and visible to both collaborators', async ({
  collaboration,
}) => {
  const { member, owner, screenplayId } = collaboration;
  await Promise.all([expectCollaborationReady(owner), expectCollaborationReady(member.page)]);

  await selectDocumentStart(member.page, 'FADE IN:'.length);
  await openCommentsPanel(member.page);
  await member.page.getByLabel('New thread comment').fill('Member note on the opening.');
  const threadCreated = member.page.waitForResponse(
    (response) =>
      response.url().endsWith(`/screenplays/${screenplayId}/comment-threads`) &&
      response.request().method() === 'POST',
  );
  await member.page.getByRole('button', { name: 'Start thread' }).click();
  expect((await threadCreated).status()).toBe(201);
  await expect(member.page.getByText('Member note on the opening.')).toBeVisible();

  await typeAtDocumentStart(owner, 'OWNER INSERT ABOVE');
  await expectEditorContains(member.page, 'OWNER INSERT ABOVE');
  await expect(member.page.getByRole('button', { name: /Anchored range/u })).toContainText(
    'FADE IN:',
  );
  await expect(member.page.getByText('Detached thread')).toHaveCount(0);
  await expectEditorsConverged(owner, member.page);

  await openCommentsPanel(owner);
  await expect(owner.getByText('Member note on the opening.')).toBeVisible();
  const reply = owner.getByLabel('Reply to thread about FADE IN:');
  await reply.fill('Owner reply from the second context.');
  const replyCreated = owner.waitForResponse(
    (response) =>
      response.url().includes(`/screenplays/${screenplayId}/comment-threads/`) &&
      response.url().endsWith('/comments') &&
      response.request().method() === 'POST',
  );
  await owner.getByRole('button', { name: 'Reply' }).click();
  expect((await replyCreated).status()).toBe(201);
  await expect(owner.getByText('Owner reply from the second context.')).toBeVisible();

  await member.page.getByRole('button', { name: 'Choose Comments panel function' }).click();
  await member.page.getByRole('menuitemradio', { name: 'Statistics' }).click();
  await openCommentsPanel(member.page);
  await expect(member.page.getByText('Owner reply from the second context.')).toBeVisible();

  const exported = await owner.request.get(`/api/v1/screenplays/${screenplayId}/export.fountain`);
  expect(exported.ok()).toBe(true);
  const fountain = await exported.text();
  expect(fountain).toContain('OWNER INSERT ABOVE');
  expect(fountain).not.toContain('Member note on the opening.');
  expect(fountain).not.toContain('Owner reply from the second context.');
});
