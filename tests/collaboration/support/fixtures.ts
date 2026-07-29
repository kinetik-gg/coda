import { test as base, type BrowserContext, type Page } from '@playwright/test';

import {
  gotoWithThrottlePatience,
  inviteScreenplayEditor,
  waitForThrottleWindow,
} from './invited-member';

interface CollaborationFixture {
  member: { context: BrowserContext; displayName: string; page: Page };
  owner: Page;
  screenplayId: string;
  sourceText: string;
  title: string;
}

async function createScreenplayWithThrottlePatience(
  page: Page,
  input: { sourceText: string; title: string },
): Promise<string> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'coda_csrf');
  if (!csrf) throw new Error('Expected the owner fixture to have a CSRF cookie');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await page.request.post('/api/v1/screenplays', {
      data: input,
      headers: { 'x-coda-csrf': csrf.value },
    });
    if (response.status() !== 429) {
      if (!response.ok()) {
        throw new Error(`Screenplay provisioning failed with status ${String(response.status())}`);
      }
      const body = (await response.json()) as { data: { id: string } };
      return body.data.id;
    }
    await waitForThrottleWindow(page, response);
  }
  throw new Error('Screenplay provisioning remained throttled after one full retry window');
}

export const test = base.extend<{ collaboration: CollaborationFixture }>({
  collaboration: async ({ browser, page: owner }, use, testInfo) => {
    const suffix = `${Date.now().toString(36)}-${testInfo.workerIndex.toString(36)}`;
    const title = `Collaboration gate ${suffix}`;
    const sourceText = 'FADE IN:\n\nINT. WRITERS ROOM - DAY\n\nOriginal line.\n';
    const screenplayId = await createScreenplayWithThrottlePatience(owner, { sourceText, title });
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
