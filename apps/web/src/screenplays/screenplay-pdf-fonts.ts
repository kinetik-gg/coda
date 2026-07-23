import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import type { Font as FontkitFont } from '@pdf-lib/fontkit';
import fontkitUmdUrl from '@pdf-lib/fontkit/dist/fontkit.umd.min.js?url';
import courierPrimeBoldUrl from '../assets/fonts/courier-prime/CourierPrime-Bold.ttf?url';
import courierPrimeBoldItalicUrl from '../assets/fonts/courier-prime/CourierPrime-BoldItalic.ttf?url';
import courierPrimeItalicUrl from '../assets/fonts/courier-prime/CourierPrime-Italic.ttf?url';
import courierPrimeRegularUrl from '../assets/fonts/courier-prime/CourierPrime-Regular.ttf?url';

export type ScreenplayPdfFontStyle = 'bold' | 'bold-italic' | 'italic' | 'regular';

export interface ScreenplayPdfFontPair {
  primary: PDFFont;
  fallback: PDFFont;
}

export type ScreenplayPdfFonts = Readonly<Record<ScreenplayPdfFontStyle, ScreenplayPdfFontPair>>;

const fontSources: Readonly<Record<ScreenplayPdfFontStyle, string>> = Object.freeze({
  regular: courierPrimeRegularUrl,
  bold: courierPrimeBoldUrl,
  italic: courierPrimeItalicUrl,
  'bold-italic': courierPrimeBoldItalicUrl,
});
const standardFontNames: Readonly<Record<ScreenplayPdfFontStyle, StandardFonts>> = Object.freeze({
  regular: StandardFonts.Courier,
  bold: StandardFonts.CourierBold,
  italic: StandardFonts.CourierOblique,
  'bold-italic': StandardFonts.CourierBoldOblique,
});

type PdfLibFontkit = Parameters<PDFDocument['registerFontkit']>[0];
let fontkitPromise: Promise<PdfLibFontkit> | undefined;
let coverageFontPromise: Promise<FontkitFont> | undefined;
const COVERAGE_YIELD_INTERVAL = 1_024;

export interface CourierPrimeCoverageOptions {
  maximumResults?: number;
  signal?: AbortSignal;
}

export async function embedScreenplayPdfFonts(
  document: PDFDocument,
  standardPrimary = true,
): Promise<ScreenplayPdfFonts> {
  document.registerFontkit(await loadFontkit());
  if (!standardPrimary) {
    const [regular, bold, italic, boldItalic] = await Promise.all([
      embedFont(document, 'regular'),
      embedFont(document, 'bold'),
      embedFont(document, 'italic'),
      embedFont(document, 'bold-italic'),
    ]);
    return {
      regular: { primary: regular, fallback: regular },
      bold: { primary: bold, fallback: bold },
      italic: { primary: italic, fallback: italic },
      'bold-italic': { primary: boldItalic, fallback: boldItalic },
    };
  }
  const [
    primaryRegular,
    primaryBold,
    primaryItalic,
    primaryBoldItalic,
    fallbackRegular,
    fallbackBold,
    fallbackItalic,
    fallbackBoldItalic,
  ] = await Promise.all([
    document.embedFont(standardFontNames.regular),
    document.embedFont(standardFontNames.bold),
    document.embedFont(standardFontNames.italic),
    document.embedFont(standardFontNames['bold-italic']),
    embedFont(document, 'regular'),
    embedFont(document, 'bold'),
    embedFont(document, 'italic'),
    embedFont(document, 'bold-italic'),
  ]);
  return {
    regular: { primary: primaryRegular, fallback: fallbackRegular },
    bold: { primary: primaryBold, fallback: fallbackBold },
    italic: { primary: primaryItalic, fallback: fallbackItalic },
    'bold-italic': { primary: primaryBoldItalic, fallback: fallbackBoldItalic },
  };
}

export async function courierPrimeSupportsText(text: string): Promise<boolean> {
  return (await courierPrimeUnsupportedGraphemes([text])).length === 0;
}

export async function courierPrimeUnsupportedGraphemes(
  graphemes: readonly string[],
  options: CourierPrimeCoverageOptions = {},
): Promise<string[]> {
  options.signal?.throwIfAborted();
  const font = await courierPrimeCoverageFont();
  options.signal?.throwIfAborted();
  const maximumResults = Math.max(
    1,
    Math.floor(options.maximumResults ?? Number.POSITIVE_INFINITY),
  );
  const unsupported: string[] = [];
  const codePointSupport = new Map<number, boolean>();
  for (let index = 0; index < graphemes.length; index += 1) {
    if (index % COVERAGE_YIELD_INTERVAL === 0) options.signal?.throwIfAborted();
    const grapheme = graphemes[index] ?? '';
    if (!graphemeSupported(font, grapheme, codePointSupport)) {
      unsupported.push(grapheme);
      if (unsupported.length >= maximumResults) return unsupported;
    }
    if ((index + 1) % COVERAGE_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
      options.signal?.throwIfAborted();
    }
  }
  return unsupported;
}

function graphemeSupported(
  font: FontkitFont,
  grapheme: string,
  codePointSupport: Map<number, boolean>,
): boolean {
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    let supported = codePointSupport.get(codePoint);
    if (supported === undefined) {
      supported = font.hasGlyphForCodePoint(codePoint);
      codePointSupport.set(codePoint, supported);
    }
    if (!supported) return false;
  }
  return true;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

async function embedFont(document: PDFDocument, style: ScreenplayPdfFontStyle): Promise<PDFFont> {
  return document.embedFont(await fontBytes(fontSources[style]), { subset: true });
}

async function fontBytes(source: string): Promise<Uint8Array> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Unable to load Courier Prime (${String(response.status)}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function courierPrimeCoverageFont(): Promise<FontkitFont> {
  coverageFontPromise ??= Promise.all([loadFontkit(), fontBytes(fontSources.regular)]).then(
    ([fontkit, bytes]) => fontkit.create(bytes),
  );
  return coverageFontPromise;
}

function loadFontkit(): Promise<PdfLibFontkit> {
  fontkitPromise ??= loadFontkitOnce();
  return fontkitPromise;
}

async function loadFontkitOnce(): Promise<PdfLibFontkit> {
  if (import.meta.env.MODE === 'test') {
    return (await import('@pdf-lib/fontkit')).default;
  }
  const existing = globalFontkit();
  if (existing) return existing;
  await loadScript(fontkitUmdUrl);
  const loaded = globalFontkit();
  if (!loaded) throw new Error('Courier Prime font support did not initialize.');
  return loaded;
}

function globalFontkit(): PdfLibFontkit | undefined {
  return (globalThis as typeof globalThis & { fontkit?: PdfLibFontkit }).fontkit;
}

function loadScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Unable to load PDF font support.')), {
      once: true,
    });
    document.head.append(script);
  });
}
