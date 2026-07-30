import {
  ScreenplayAdapterSourceError,
  type ScreenplayAdapter,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterInput,
  type ScreenplayAdapterOutput,
  type ScreenplayConversionElement,
} from '@coda/contracts';
import {
  importHtml,
  parseFountain,
  ScreenplayInterchangeError,
  type FountainElement,
  type ScreenplayImportResult,
} from '@coda/fountain';

/**
 * The source-format slug this adapter answers for, matching the `html` value
 * `@coda/fountain`'s `ScreenplayInterchangeFormat` and format detection use.
 */
export const HTML_SOURCE_FORMAT = 'html';

/**
 * Mirrors the shape of {@link ../adapters/fdx.adapter.ts}, the reference
 * adapter #246 established: it wraps `@coda/fountain`'s `importHtml` (an
 * inert, no-DOM, no-network HTML-to-Fountain tokenizer hardened against
 * hostile input by its own preflight scan) and turns its flat warning list
 * into the runtime's per-element report by re-parsing the resulting Fountain
 * text with `parseFountain`, exactly as the FDX adapter does. See
 * `packages/fountain/src/interchange/html.ts` for the conversion itself and
 * `html-preflight.ts` for the hardening it depends on.
 */
class HtmlAdapter implements ScreenplayAdapter {
  readonly id = 'coda.html';
  readonly version = '1';
  readonly sourceFormats = [HTML_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    // Cooperative yield, matching the FDX adapter: HTML conversion is
    // synchronous CPU work bounded by a small input ceiling, so this `await`
    // exists only to turn a synchronous throw into a rejected Promise before
    // any conversion work begins.
    await Promise.resolve();
    context.throwIfCancelled();
    const result = importHtmlForAdapter(input);
    context.throwIfCancelled();
    return {
      convertedFountain: result.fountain,
      elements: buildElements(result, input.bytes.byteLength),
      warnings: [],
    };
  }
}

function importHtmlForAdapter(input: ScreenplayAdapterInput): ScreenplayImportResult {
  try {
    return importHtml(input.bytes);
  } catch (error) {
    if (error instanceof ScreenplayInterchangeError) {
      throw new ScreenplayAdapterSourceError(error.message);
    }
    throw error;
  }
}

function buildElements(
  result: ScreenplayImportResult,
  originalByteLength: number,
): ScreenplayConversionElement[] {
  const documentSource = {
    kind: 'html-document',
    location: { unit: 'byte' as const, start: 0, end: originalByteLength },
  };
  const parsed = parseFountain(result.fountain);
  const contentElements = parsed.elements.map((element, index) =>
    toContentElement(element, index, documentSource),
  );
  const warningElements = result.warnings.map((warning, index) =>
    toWarningElement(warning, index, documentSource),
  );
  return [...contentElements, ...warningElements];
}

function toContentElement(
  element: FountainElement,
  index: number,
  documentSource: ScreenplayConversionElement['source'],
): ScreenplayConversionElement {
  return {
    id: `content-${index + 1}`,
    status: 'converted',
    source: documentSource,
    target: {
      kind: element.kind,
      location: { unit: 'character', start: element.start, end: element.end },
    },
    summary: `Converted an HTML construct to Fountain ${element.kind.replace('_', ' ')}.`,
    warnings: [],
  };
}

function toWarningElement(
  warning: string,
  index: number,
  documentSource: ScreenplayConversionElement['source'],
): ScreenplayConversionElement {
  return {
    id: `warning-${index + 1}`,
    status: 'uncertain',
    source: documentSource,
    target: null,
    summary: warning,
    warnings: [{ code: 'HTML_CONVERSION_WARNING', message: warning }],
  };
}

export function createHtmlAdapter(): ScreenplayAdapter {
  return new HtmlAdapter();
}
