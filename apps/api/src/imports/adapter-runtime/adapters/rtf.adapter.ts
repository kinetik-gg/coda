import {
  ScreenplayAdapterSourceError,
  type ScreenplayAdapter,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterInput,
  type ScreenplayAdapterOutput,
  type ScreenplayConversionWarning,
} from '@coda/contracts';
import { classifyRtfParagraphs } from './rtf/rtf-classification';
import { emitRtfFountain } from './rtf/rtf-fountain';
import { parseRtfParagraphs } from './rtf/rtf-paragraphs';

/**
 * The source-format slug this adapter answers for, matching the extension and
 * the `sourceFormat` value recorded on the import artifact.
 */
export const RTF_SOURCE_FORMAT = 'rtf';

/**
 * The RTF screenplay adapter.
 *
 * Unlike the FDX and HTML adapters, which wrap importers that already live in
 * `@coda/fountain`, this one owns its parser outright. That is the decision
 * #247 recorded in `docs/adr-rtf-docx-parser-qualification.md`: every published
 * RTF library was qualified and every one rejected — `rtf-parser` crashed with
 * an uncaught `RangeError` on a deeply nested-group fixture and has been
 * unmaintained since 2022, `rtf.js` is canvas-oriented, `word-extractor` parses
 * a different format entirely, and `rtf-stream-parser` solves de-encapsulation
 * of HTML wrapped inside RTF rather than general RTF structure. No RTF
 * dependency was added by this change.
 *
 * The parser is deliberately split across `./rtf/`:
 *
 * - `rtf-tokenizer.ts` scans bytes to tokens with no recursion and no per-token
 *   allocation.
 * - `rtf-paragraphs.ts` walks tokens with an explicit, depth-capped group stack.
 * - `rtf-classification.ts` applies the deterministic screenplay heuristics.
 * - `rtf-fountain.ts` renders Fountain and the per-element report, enforcing the
 *   runtime's ceilings as it goes.
 *
 * Everything here is pure computation over a byte array: no configuration, no
 * database, no network, no filesystem, and nothing that would misbehave if the
 * thread were terminated mid-call.
 */
class RtfAdapter implements ScreenplayAdapter {
  readonly id = 'coda.rtf';
  readonly version = '1';
  readonly sourceFormats = [RTF_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    context.throwIfCancelled();
    const { limits } = context;
    const parsed = await parseRtfParagraphs(input.bytes, {
      throwIfCancelled: () => {
        context.throwIfCancelled();
      },
      limits: {
        // One past each runtime ceiling on purpose: crossing a ceiling has to
        // produce a payload the runtime can *see* is over budget, so it reports
        // `output-too-large`/`element-limit` rather than accepting a screenplay
        // that was quietly cut short.
        maxParagraphs: limits.maxElements + 1,
        maxTextCharacters: limits.maxOutputCharacters,
        maxWarnings: limits.maxWarnings,
      },
    });
    context.throwIfCancelled();
    context.reportProgress({
      stage: 'paragraphs',
      completed: parsed.paragraphs.length,
      total: parsed.paragraphs.length,
    });
    const blocks = classifyRtfParagraphs(parsed.paragraphs);
    if (blocks.length === 0) {
      throw new ScreenplayAdapterSourceError('The RTF document contains no readable text');
    }
    const emitted = emitRtfFountain(blocks, {
      limits: {
        maxOutputCharacters: limits.maxOutputCharacters,
        maxElements: limits.maxElements,
      },
      throwIfCancelled: () => {
        context.throwIfCancelled();
      },
    });
    return {
      convertedFountain: emitted.convertedFountain,
      elements: emitted.elements,
      warnings: capWarnings([...parsed.warnings, ...emitted.warnings], limits.maxWarnings),
    };
  }
}

function capWarnings(
  warnings: readonly ScreenplayConversionWarning[],
  maxWarnings: number,
): ScreenplayConversionWarning[] {
  return warnings.slice(0, Math.max(maxWarnings, 0));
}

export function createRtfAdapter(): ScreenplayAdapter {
  return new RtfAdapter();
}
