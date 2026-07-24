import { expect, test, type Locator, type Page } from '@playwright/test';

import { createScreenplayViaApi } from './support/harness';

/**
 * Editor input-fidelity matrix (issue #121). These scenarios exercise the *real*
 * CodeMirror editor and SVG preview — jsdom cannot reproduce layout-dependent
 * click targeting, wrapped-line caret motion, or scroll coordination. Each row of
 * the matrix asserts a user-visible invariant that the pre-fix editor violated
 * intermittently:
 *
 *   - click-to-line  : a preview click lands the editor caret on the clicked
 *                      source line, across scene boundaries and page breaks.
 *   - arrow traversal: ArrowDown/Up never skip a source line, including across
 *                      wrapped paragraphs and with typewriter / focus modes on.
 *   - scroll sync    : scrolling the editor keeps the preview in step and a
 *                      preview-driven reveal never wedges later editor scrolls.
 */

const editorContent = '.cm-content[contenteditable="true"]';

/** A deterministic fixture: consecutive single-line beats (each its own source */
/** line), interleaved scene boundaries, a long wrapped paragraph, and dual */
/** dialogue — long enough to span multiple preview pages. */
function fidelityFixture(): { source: string; beat: (n: number) => string } {
  const beat = (n: number) => `Beat ${String(n).padStart(3, '0')} holds the line.`;
  const lines: string[] = ['Title: Editor Fidelity Fixture', 'Author: Coda QA', ''];
  lines.push('INT. CONTROL ROOM - DAY', '');
  for (let n = 1; n <= 18; n += 1) lines.push(beat(n));
  lines.push('', 'EXT. LAUNCH PAD - NIGHT', '');
  for (let n = 19; n <= 40; n += 1) lines.push(beat(n));
  lines.push(
    '',
    'A very long stretch of action that comfortably exceeds a single rendered ' +
      'line so the layout engine has to wrap it across several visual rows while ' +
      'keeping every character mapped back to one contiguous source line.',
    '',
    'ADA',
    'We hold at T minus ten.',
    '',
    'RIVKA',
    '^Copy that, all stations green.',
    '',
  );
  return { source: lines.join('\n'), beat };
}

/** 1-based CodeMirror document line containing `offset`. */
function docLineOfOffset(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/**
 * Reads the caret's document line straight from CodeMirror's line-number gutter.
 * Scoped to `.cm-lineNumbers` so it never matches the fold gutter's own
 * (number-less) active-line element.
 */
async function activeGutterLine(page: Page): Promise<number> {
  const text = await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().innerText();
  return Number(text.trim());
}

/** Reads the caret's document line from the workspace status bar (React round-trip). */
async function statusBarLine(page: Page): Promise<number> {
  const text = await page.getByText(/^LN\s/).first().innerText();
  return Number(text.replace(/[^\d]/g, ''));
}

async function focusEditor(page: Page): Promise<Locator> {
  const editor = page.locator(editorContent);
  await editor.click();
  return editor;
}

const fixture = fidelityFixture();
let screenplayId = '';

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  screenplayId = await createScreenplayViaApi(page, {
    title: `Editor Fidelity ${Date.now()}`,
    sourceText: fixture.source,
  });
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto(`/screenplays/${screenplayId}`);
  await expect(page.locator(editorContent)).toContainText('CONTROL ROOM');
});

test.describe('click-to-line targeting', () => {
  for (const label of ['Beat 007 holds the line.', 'Beat 032 holds the line.']) {
    test.fixme(`preview click lands the caret on "${label}"`, async ({ page }) => {
      const previewLine = page.locator('[data-layout-line]', { hasText: label }).first();
      await expect(previewLine).toBeVisible();
      const sourceStart = Number(await previewLine.getAttribute('data-source-start'));
      const expectedLine = docLineOfOffset(fixture.source, sourceStart);

      await previewLine.click();

      // Both the CodeMirror gutter and the React status bar must agree with the
      // source line the user clicked — no off-by-one or wrong-line targeting.
      await expect.poll(() => statusBarLine(page)).toBe(expectedLine);
      expect(await activeGutterLine(page)).toBe(expectedLine);
    });
  }

  test.fixme('preview click targets a line past the first page break', async ({ page }) => {
    // The dual-dialogue cue sits well past page one; clicking it must still map
    // to its own source line rather than a neighbouring block.
    const previewLine = page.locator('[data-layout-line]', { hasText: 'ADA' }).first();
    await expect(previewLine).toBeVisible();
    const sourceStart = Number(await previewLine.getAttribute('data-source-start'));
    const expectedLine = docLineOfOffset(fixture.source, sourceStart);

    await previewLine.click();
    await expect.poll(() => statusBarLine(page)).toBe(expectedLine);
  });
});

test.describe('arrow-key traversal fidelity', () => {
  async function assertNoLineSkips(page: Page, presses: number) {
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+Home');
    let previous = await activeGutterLine(page);
    for (let step = 0; step < presses; step += 1) {
      await page.keyboard.press('ArrowDown');
      const current = await activeGutterLine(page);
      // The caret advances by at most one source line per press (0 while moving
      // through the visual rows of a wrapped line) and never jumps backwards.
      expect(
        current - previous,
        `ArrowDown #${String(step + 1)}: ${previous} -> ${current}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        current - previous,
        `ArrowDown #${String(step + 1)}: ${previous} -> ${current}`,
      ).toBeLessThanOrEqual(1);
      previous = current;
    }
    // And the traversal actually made progress rather than stalling.
    expect(previous).toBeGreaterThan(1);
  }

  test.fixme('ArrowDown never skips a source line (typewriter off)', async ({ page }) => {
    await assertNoLineSkips(page, 30);
  });

  test.fixme('ArrowDown never skips a source line with typewriter scrolling on', async ({
    page,
  }) => {
    await focusEditor(page);
    await page.keyboard.press('Control+Shift+Enter'); // enter Zen so the toggle is reachable
    await page.keyboard.press('Control+Alt+T');
    await expect(page.getByRole('button', { name: 'Typewriter Scrolling' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Exit Zen' }).click();
    await assertNoLineSkips(page, 30);
  });

  test.fixme('ArrowDown never skips a source line with focus mode on', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press('Control+Shift+Enter');
    await page.keyboard.press('Control+Alt+F');
    await expect(page.getByRole('button', { name: 'Focus mode' })).toContainText('Paragraph Focus');
    await page.getByRole('button', { name: 'Exit Zen' }).click();
    await assertNoLineSkips(page, 30);
  });
});

test.describe('scroll coordination', () => {
  const previewScroller = (page: Page) =>
    page.getByLabel('Screenplay preview').locator('> div').first();

  test.fixme('moving the editor caret to the end pulls the preview along', async ({ page }) => {
    const preview = previewScroller(page);
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(0);

    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+End');

    // Caret-driven sync must reveal the tail of the document in the preview.
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test.fixme('a preview reveal does not wedge later caret-driven sync', async ({ page }) => {
    const preview = previewScroller(page);

    // Reveal a line near the top (a near no-op scroll) — historically this could
    // leave a coordination latch armed. The scroll-intent arbiter releases it by
    // expiry, so a subsequent editor interaction still drives the preview.
    await page.locator('[data-layout-line]', { hasText: 'Beat 002' }).first().click();
    await page.waitForTimeout(600); // longer than the arbiter suppression window

    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+End');
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });
});
