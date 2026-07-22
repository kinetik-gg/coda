import { type PDFDocument, type PDFFont } from 'pdf-lib';
import type { Font as FontkitFont } from '@pdf-lib/fontkit';
import fontkitUmdUrl from '@pdf-lib/fontkit/dist/fontkit.umd.min.js?url';
import courierPrimeBoldUrl from '../assets/fonts/courier-prime/CourierPrime-Bold.ttf?url';
import courierPrimeBoldItalicUrl from '../assets/fonts/courier-prime/CourierPrime-BoldItalic.ttf?url';
import courierPrimeItalicUrl from '../assets/fonts/courier-prime/CourierPrime-Italic.ttf?url';
import courierPrimeRegularUrl from '../assets/fonts/courier-prime/CourierPrime-Regular.ttf?url';

export type ScreenplayPdfFontStyle = 'bold' | 'bold-italic' | 'italic' | 'regular';

export type ScreenplayPdfFonts = Readonly<Record<ScreenplayPdfFontStyle, PDFFont>>;

const fontSources: Readonly<Record<ScreenplayPdfFontStyle, string>> = Object.freeze({
  regular: courierPrimeRegularUrl,
  bold: courierPrimeBoldUrl,
  italic: courierPrimeItalicUrl,
  'bold-italic': courierPrimeBoldItalicUrl,
});

type PdfLibFontkit = Parameters<PDFDocument['registerFontkit']>[0];
let fontkitPromise: Promise<PdfLibFontkit> | undefined;
let coverageFontPromise: Promise<FontkitFont> | undefined;

export async function embedCourierPrimeFonts(document: PDFDocument): Promise<ScreenplayPdfFonts> {
  document.registerFontkit(await loadFontkit());
  const [regular, bold, italic, boldItalic] = await Promise.all([
    embedFont(document, 'regular'),
    embedFont(document, 'bold'),
    embedFont(document, 'italic'),
    embedFont(document, 'bold-italic'),
  ]);
  return { regular, bold, italic, 'bold-italic': boldItalic };
}

export async function courierPrimeSupportsText(text: string): Promise<boolean> {
  const font = await courierPrimeCoverageFont();
  return Array.from(text).every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && font.hasGlyphForCodePoint(codePoint);
  });
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
