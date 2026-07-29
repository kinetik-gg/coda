import { test as base, type BrowserContext, type Page } from '@playwright/test';

import { createScreenplayViaApi } from '../../e2e/support/harness';
import { gotoWithThrottlePatience, inviteScreenplayEditor } from './invited-member';

interface CollaborationFixture {
  member: { context: BrowserContext; displayName: string; page: Page };
  owner: Page;
  screenplayId: string;
  sourceText: string;
  title: string;
}

export const test = base.extend<{ collaboration: CollaborationFixture }>({
  collaboration: async ({ browser, page: owner }, use, testInfo) => {
    const suffix = `${Date.now().toString(36)}-${testInfo.workerIndex.toString(36)}`;
    const title = `Collaboration gate ${suffix}`;
    const sourceText = 'FADE IN:\n\nINT. WRITERS ROOM - DAY\n\nOriginal line.\n';
    const screenplayId = await createScreenplayViaApi(owner, { sourceText, title });
    const member = await inviteScreenplayEditor(
      browser,
      owner,
      { id: screenplayId, title },
      suffix,
    );
    try {
      await gotoWithThrottlePatience(owner, `/screenplays/${screenplayId}`);
      await use({ member, owner, screenplayId, sourceText, title });
    } finally {
      await member.context.close();
    }
  },
});
