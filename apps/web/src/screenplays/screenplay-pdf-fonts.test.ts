import { type PDFDocument, type PDFFont } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embedCourierPrimeFonts } from './screenplay-pdf-fonts';

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

describe('Courier Prime PDF font embedding', () => {
  it('registers fontkit and embeds each production face as a subset', async () => {
    const regular = fakeFont('regular');
    const bold = fakeFont('bold');
    const italic = fakeFont('italic');
    const boldItalic = fakeFont('bold-italic');
    const registerFontkit = vi.fn();
    const embedFont = vi
      .fn()
      .mockResolvedValueOnce(regular)
      .mockResolvedValueOnce(bold)
      .mockResolvedValueOnce(italic)
      .mockResolvedValueOnce(boldItalic);

    const fonts = await embedCourierPrimeFonts(fakeDocument({ registerFontkit, embedFont }));

    expect(registerFontkit).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(embedFont).toHaveBeenCalledTimes(4);
    for (const [bytes, options] of embedFont.mock.calls) {
      expect(bytes).toEqual(Uint8Array.from([0, 1, 2, 3]));
      expect(options).toEqual({ subset: true });
    }
    expect(fonts).toEqual({ regular, bold, italic, 'bold-italic': boldItalic });
  });

  it('reuses the loaded fontkit module across documents', async () => {
    const firstRegister = vi.fn();
    const secondRegister = vi.fn();

    await embedCourierPrimeFonts(fakeDocument({ registerFontkit: firstRegister }));
    await embedCourierPrimeFonts(fakeDocument({ registerFontkit: secondRegister }));

    expect(firstRegister).toHaveBeenCalledOnce();
    expect(secondRegister).toHaveBeenCalledOnce();
    expect(secondRegister.mock.calls[0]?.[0]).toBe(firstRegister.mock.calls[0]?.[0]);
  });

  it('reports an HTTP font asset failure with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );

    await expect(embedCourierPrimeFonts(fakeDocument())).rejects.toThrow(
      'Unable to load Courier Prime (503).',
    );
  });

  it('propagates a font asset network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    await expect(embedCourierPrimeFonts(fakeDocument())).rejects.toThrow('offline');
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
