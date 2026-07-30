import { describe, expect, it, vi } from 'vitest';
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext } from '@coda/contracts';
import { extractPdfPages } from './pdf-extract';
import { buildScreenplayPdf } from './pdf-test-fixtures';

function context(controller = new AbortController()): ScreenplayAdapterContext {
  return {
    signal: controller.signal,
    limits: {
      timeoutMs: 30_000,
      maxInputBytes: 20_971_520,
      maxOutputCharacters: 5_000_000,
      maxElements: 50_000,
      maxWarnings: 1_000,
    },
    reportProgress: () => {
      /* not exercised here */
    },
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
}

describe('extractPdfPages', () => {
  it('extracts positioned text from every page', async () => {
    const bytes = await buildScreenplayPdf([
      [{ kind: 'scene_heading', text: 'EXT. STREET - DAY' }],
      [{ kind: 'action', text: 'Rain falls.' }],
    ]);
    const result = await extractPdfPages(bytes, {
      maxPages: 10,
      maxCharacters: 1_000_000,
      context: context(),
    });
    expect(result.truncated).toBe(false);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.lines).toEqual([
      expect.objectContaining({ text: 'EXT. STREET - DAY' }),
    ]);
    expect(result.pages[1]?.lines).toEqual([expect.objectContaining({ text: 'Rain falls.' })]);
  });

  it('rejects a document whose page count exceeds the configured ceiling', async () => {
    const bytes = await buildScreenplayPdf([
      [{ kind: 'action', text: 'Page one.' }],
      [{ kind: 'action', text: 'Page two.' }],
    ]);
    await expect(
      extractPdfPages(bytes, { maxPages: 1, maxCharacters: 1_000_000, context: context() }),
    ).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('stops reading further pages once the cumulative character ceiling is crossed', async () => {
    const bytes = await buildScreenplayPdf([
      [{ kind: 'action', text: 'x'.repeat(40) }],
      [{ kind: 'action', text: 'y'.repeat(40) }],
      [{ kind: 'action', text: 'z'.repeat(40) }],
    ]);
    const result = await extractPdfPages(bytes, {
      maxPages: 10,
      maxCharacters: 50,
      context: context(),
    });
    expect(result.truncated).toBe(true);
    expect(result.pages.length).toBeLessThan(3);
  });

  it('rejects a document that is not a valid PDF', async () => {
    const bytes = new TextEncoder().encode('this is not a pdf');
    await expect(
      extractPdfPages(bytes, { maxPages: 10, maxCharacters: 1_000_000, context: context() }),
    ).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('cooperates with cancellation between pages', async () => {
    const bytes = await buildScreenplayPdf([
      [{ kind: 'action', text: 'Page one.' }],
      [{ kind: 'action', text: 'Page two.' }],
    ]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPdfPages(bytes, {
        maxPages: 10,
        maxCharacters: 1_000_000,
        context: context(controller),
      }),
    ).rejects.toThrow(ScreenplayAdapterAbortError);
  });

  it('reports a password-protected PDF as invalid-source rather than throwing an unclassified error', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('needs a password'), { name: 'PasswordException' }),
        ),
        destroy: () => Promise.resolve(),
      }),
    }));
    const { extractPdfPages: extractWithMock } = await import('./pdf-extract');
    const bytes = await buildScreenplayPdf([[{ kind: 'action', text: 'Secret.' }]]);
    await expect(
      extractWithMock(bytes, { maxPages: 10, maxCharacters: 1_000_000, context: context() }),
    ).rejects.toThrow(/password-protected/u);
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
    vi.resetModules();
  });
});
