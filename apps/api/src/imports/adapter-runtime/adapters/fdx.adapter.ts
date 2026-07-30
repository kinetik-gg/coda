import {
  ScreenplayAdapterSourceError,
  type ScreenplayAdapter,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterInput,
  type ScreenplayAdapterOutput,
  type ScreenplayConversionElement,
} from '@coda/contracts';
import {
  importFinalDraft,
  parseFountain,
  ScreenplayInterchangeError,
  type FountainElement,
  type ScreenplayImportResult,
} from '@coda/fountain';

/**
 * The source-format slug this adapter answers for. It matches the
 * `ScreenplayInterchangeFormat` value the shared `@coda/fountain` package and
 * its format-detection facade already use for Final Draft, so the artifact's
 * `sourceFormat` column stays meaningful outside the adapter runtime too.
 */
export const FDX_SOURCE_FORMAT = 'final-draft';

/**
 * The reference adapter #248-#251 copy the shape of. It wraps the existing,
 * already-hardened `importFinalDraft` importer from `@coda/fountain` rather
 * than re-implementing FDX parsing: the mapping and the XML preflight it
 * depends on (`assertXmlPreflight`) are unchanged from the pre-#246 behaviour.
 *
 * What is new here is turning the importer's flat, deduplicated warning
 * strings into the runtime's per-element report shape. `importFinalDraft`
 * does not track source-accurate positions for each converted construct, so
 * this adapter derives real, precise *target* locations by parsing the
 * resulting Fountain text with `parseFountain` and reporting one `converted`
 * element per resulting Fountain element (its exact character range in the
 * converted document). Each original degradation warning becomes its own
 * report element too - `unsupported` when the source called it out as
 * omitted, `uncertain` otherwise - carrying the warning text and a
 * document-level *source* location, because the importer does not attribute a
 * warning to a specific offset in the original XML.
 */
class FdxAdapter implements ScreenplayAdapter {
  readonly id = 'coda.fdx';
  readonly version = '1';
  readonly sourceFormats = [FDX_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    // FDX conversion is synchronous CPU work with an input ceiling small enough
    // (5,000,000 bytes) that it never needs to chunk. The `await` below is a
    // deliberate cooperative yield, not busywork: it is what turns a
    // synchronous throw (cancellation, or a rejected document) into a
    // rejected Promise instead of a raw thrown exception, which is what every
    // caller of this contract - the worker host included - expects.
    await Promise.resolve();
    context.throwIfCancelled();
    const result = importFinalDraftForAdapter(input);
    context.throwIfCancelled();
    return {
      convertedFountain: result.fountain,
      elements: buildElements(result, input.bytes.byteLength),
      warnings: [],
    };
  }
}

function importFinalDraftForAdapter(input: ScreenplayAdapterInput): ScreenplayImportResult {
  try {
    return importFinalDraft(input.bytes);
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
    kind: 'final-draft-document',
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
    summary: `Converted a Final Draft construct to Fountain ${element.kind.replace('_', ' ')}.`,
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
    status: /\bomitted\b/iu.test(warning) ? 'unsupported' : 'uncertain',
    source: documentSource,
    target: null,
    summary: warning,
    warnings: [{ code: 'FDX_CONVERSION_WARNING', message: warning }],
  };
}

export function createFdxAdapter(): ScreenplayAdapter {
  return new FdxAdapter();
}
