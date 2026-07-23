import { type PDFDocument, type PDFFont } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embedScreenplayPdfFonts } from './screenplay-pdf-fonts';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(Uint8Array.from([0, 1, 2, 3]).buffer, { status: 200 })),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screenplay PDF font embedding', () => {
  it('embeds standard primary faces and Unicode fallback subsets', async () => {
    const primaryRegular = fakeFont('primary-regular');
    const primaryBold = fakeFont('primary-bold');
    const primaryItalic = fakeFont('primary-italic');
    const primaryBoldItalic = fakeFont('primary-bold-italic');
    const fallbackRegular = fakeFont('fallback-regular');
    const fallbackBold = fakeFont('fallback-bold');
    const fallbackItalic = fakeFont('fallback-italic');
    const fallbackBoldItalic = fakeFont('fallback-bold-italic');
    const registerFontkit = vi.fn();
    const embedFont = vi
      .fn()
      .mockResolvedValueOnce(primaryRegular)
      .mockResolvedValueOnce(primaryBold)
      .mockResolvedValueOnce(primaryItalic)
      .mockResolvedValueOnce(primaryBoldItalic)
      .mockResolvedValueOnce(fallbackRegular)
      .mockResolvedValueOnce(fallbackBold)
      .mockResolvedValueOnce(fallbackItalic)
      .mockResolvedValueOnce(fallbackBoldItalic);

    const fonts = await embedScreenplayPdfFonts(fakeDocument({ registerFontkit, embedFont }));

    expect(registerFontkit).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(embedFont).toHaveBeenCalledTimes(8);
    expect(embedFont.mock.calls.slice(0, 4).map(([name]) => String(name))).toEqual([
      'Courier',
      'Courier-Bold',
      'Courier-Oblique',
      'Courier-BoldOblique',
    ]);
    for (const [bytes, options] of embedFont.mock.calls.slice(4)) {
      expect(bytes).toEqual(Uint8Array.from([0, 1, 2, 3]));
      expect(options).toEqual({ subset: true });
    }
    expect(fonts).toEqual({
      regular: { primary: primaryRegular, fallback: fallbackRegular },
      bold: { primary: primaryBold, fallback: fallbackBold },
      italic: { primary: primaryItalic, fallback: fallbackItalic },
      'bold-italic': { primary: primaryBoldItalic, fallback: fallbackBoldItalic },
    });
  });

  it('reuses the loaded fontkit module across documents', async () => {
    const firstRegister = vi.fn();
    const secondRegister = vi.fn();

    await embedScreenplayPdfFonts(fakeDocument({ registerFontkit: firstRegister }));
    await embedScreenplayPdfFonts(fakeDocument({ registerFontkit: secondRegister }));

    expect(firstRegister).toHaveBeenCalledOnce();
    expect(secondRegister).toHaveBeenCalledOnce();
    expect(secondRegister.mock.calls[0]?.[0]).toBe(firstRegister.mock.calls[0]?.[0]);
  });

  it('uses the embedded fallback faces as primary faces when requested', async () => {
    const regular = fakeFont('regular');
    const bold = fakeFont('bold');
    const italic = fakeFont('italic');
    const boldItalic = fakeFont('bold-italic');
    const embedFont = vi
      .fn()
      .mockResolvedValueOnce(regular)
      .mockResolvedValueOnce(bold)
      .mockResolvedValueOnce(italic)
      .mockResolvedValueOnce(boldItalic);

    const fonts = await embedScreenplayPdfFonts(fakeDocument({ embedFont }), false);

    expect(embedFont).toHaveBeenCalledTimes(4);
    expect(fonts).toEqual({
      regular: { primary: regular, fallback: regular },
      bold: { primary: bold, fallback: bold },
      italic: { primary: italic, fallback: italic },
      'bold-italic': { primary: boldItalic, fallback: boldItalic },
    });
  });

  it('reports an HTTP font asset failure with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );

    await expect(embedScreenplayPdfFonts(fakeDocument())).rejects.toThrow(
      'Unable to load Courier Prime (503).',
    );
  });

  it('propagates a font asset network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    await expect(embedScreenplayPdfFonts(fakeDocument())).rejects.toThrow('offline');
  });
});

function fakeDocument(
  overrides: {
    registerFontkit?: ReturnType<typeof vi.fn>;
    embedFont?: ReturnType<typeof vi.fn>;
  } = {},
): PDFDocument {
  return {
    registerFontkit: overrides.registerFontkit ?? vi.fn(),
    embedFont: overrides.embedFont ?? vi.fn(() => Promise.resolve(fakeFont('embedded'))),
  } as unknown as PDFDocument;
}

function fakeFont(name: string): PDFFont {
  return { name } as unknown as PDFFont;
}
