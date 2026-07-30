import { describe, expect, it } from 'vitest';
import {
  screenplayConversionReportSchema,
  ScreenplayAdapterAbortError,
  ScreenplayAdapterSourceError,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterLimits,
  type ScreenplayAdapterOutput,
} from '@coda/contracts';
import { parseFountain } from '@coda/fountain';
import {
  deeplyNestedRtfGroups,
  rtfAbsurdParameters,
  rtfControlWordFlood,
  rtfDestinationFlood,
  rtfLyingBinaryRun,
  unterminatedRtfGroups,
} from '../../parser-qualification/adversarial-zip-fixtures';
import { createRtfAdapter, RTF_SOURCE_FORMAT } from './rtf.adapter';

const DEFAULT_LIMITS: ScreenplayAdapterLimits = {
  timeoutMs: 30_000,
  maxInputBytes: 20_971_520,
  maxOutputCharacters: 5_000_000,
  maxElements: 50_000,
  maxWarnings: 1_000,
};

/**
 * A styled RTF screenplay of the shape a word processor exports: a font table
 * and a `\*\generator` destination to skip, a centred title, right-aligned
 * transitions, indented cues and dialogue, a parenthetical, emphasis, a
 * Windows-1252 escape, a Unicode escape with its code-page fallback, an
 * embedded picture, and an explicit page break.
 */
const STYLED_SCREENPLAY = [
  '{\\rtf1\\ansi\\ansicpg1252\\deff0',
  '{\\fonttbl{\\f0\\fmodern Courier New;}}',
  '{\\*\\generator Some Word Processor 1.0;}',
  '\\pard\\qc\\b THE LONG WAY HOME\\b0\\par',
  '\\pard\\ql INT. KITCHEN - MORNING\\par',
  '\\par',
  'Rain taps the window. MARA pours coffee she will not drink, then ',
  '\\i stares\\i0  at the door.\\par',
  '\\par',
  '\\pard\\li2160 MARA\\par',
  '\\pard\\li1440 (to herself)\\par',
  '\\pard\\li1440 You said you would call. Caf\\u233 ?, you said.\\par',
  '\\par',
  '\\pard\\ql {\\pict\\pngblip 89504e47}A door closes somewhere upstairs.\\par',
  '\\par',
  '\\pard\\qr CUT TO:\\par',
  '\\page',
  '\\pard\\ql EXT. DRIVEWAY - CONTINUOUS\\par',
  '\\par',
  '\\pard\\ql The car is gone. Only the outline of it in dry asphalt remains, ',
  "and the smell of \\'93wet stone\\'94.\\par",
  '}',
].join('');

function makeContext(
  overrides: Partial<ScreenplayAdapterLimits> = {},
  controller = new AbortController(),
): ScreenplayAdapterContext {
  return {
    signal: controller.signal,
    limits: { ...DEFAULT_LIMITS, ...overrides },
    reportProgress: () => {
      /* progress is best effort and not asserted here */
    },
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
}

function convert(
  source: string,
  context: ScreenplayAdapterContext = makeContext(),
): Promise<ScreenplayAdapterOutput> {
  return createRtfAdapter().convert(
    {
      sourceFormat: RTF_SOURCE_FORMAT,
      originalFilename: 'draft.rtf',
      bytes: new Uint8Array(Buffer.from(source, 'latin1')),
    },
    context,
  );
}

/** The Fountain kind at a given character offset, as the shared parser reads it. */
function parsedKindsByStart(fountain: string): Map<number, string> {
  const kinds = new Map<number, string>();
  for (const element of parseFountain(fountain).elements) kinds.set(element.start, element.kind);
  return kinds;
}

describe('RTF adapter', () => {
  it('declares its identity and source format', () => {
    const adapter = createRtfAdapter();
    expect(adapter.id).toBe('coda.rtf');
    expect(adapter.version).toBe('1');
    expect(adapter.sourceFormats).toEqual([RTF_SOURCE_FORMAT]);
  });

  it('recovers every readable line of a styled screenplay', async () => {
    const { convertedFountain } = await convert(STYLED_SCREENPLAY);
    expect(convertedFountain).toContain('THE LONG WAY HOME');
    expect(convertedFountain).toContain('INT. KITCHEN - MORNING');
    expect(convertedFountain).toContain('MARA');
    expect(convertedFountain).toContain('(to herself)');
    expect(convertedFountain).toContain('You said you would call.');
    expect(convertedFountain).toContain('CUT TO:');
    expect(convertedFountain).toContain('EXT. DRIVEWAY - CONTINUOUS');
  });

  it('decodes code-page and Unicode escapes into real characters', async () => {
    const { convertedFountain } = await convert(STYLED_SCREENPLAY);
    expect(convertedFountain).toContain('Café');
    expect(convertedFountain).toContain('“wet stone”');
  });

  it('keeps italic emphasis as Fountain markup', async () => {
    const { convertedFountain } = await convert(STYLED_SCREENPLAY);
    expect(convertedFountain).toContain('*stares*');
  });

  it('classifies every source block, and never emits a block without a target range', async () => {
    const { elements } = await convert(STYLED_SCREENPLAY);
    expect(elements.length).toBeGreaterThan(8);
    for (const element of elements) {
      expect(element.target).not.toBeNull();
      expect(element.source.location.unit).toBe('byte');
      expect(element.source.location.end).toBeGreaterThanOrEqual(element.source.location.start);
    }
  });

  /**
   * The acceptance criterion, stated as a property: emission forces `.`, `@`,
   * `>` and `!` wherever Fountain's own inference would disagree with the
   * classification, so re-parsing the emitted text has to reproduce every
   * classification exactly. If it ever does not, the report is lying about the
   * screenplay the user will actually see.
   */
  it('round-trips: every reported target kind is what Fountain itself parses there', async () => {
    const { convertedFountain, elements } = await convert(STYLED_SCREENPLAY);
    const parsed = parsedKindsByStart(convertedFountain);
    const observed = elements.map((element) => ({
      expected: element.target!.kind,
      actual: parsed.get(element.target!.location.start),
    }));
    expect(observed.filter((entry) => entry.expected !== entry.actual)).toEqual([]);
  });

  it('produces the expected screenplay structure end to end', async () => {
    const { elements } = await convert(STYLED_SCREENPLAY);
    expect(elements.map((element) => element.target!.kind)).toEqual([
      'centered',
      'scene_heading',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'action',
      'transition',
      'scene_heading',
      'action',
    ]);
  });

  it('emits a page break as its own Fountain construct', async () => {
    const { convertedFountain } = await convert(STYLED_SCREENPLAY);
    expect(convertedFountain).toContain('\n===\n');
  });

  it('produces a schema-valid report with a mix of statuses', async () => {
    const output = await convert(STYLED_SCREENPLAY);
    const statuses = output.elements.map((element) => element.status);
    const report = screenplayConversionReportSchema.parse({
      schemaVersion: 1,
      sourceFormat: RTF_SOURCE_FORMAT,
      adapter: { id: 'coda.rtf', version: '1' },
      generatedAt: new Date().toISOString(),
      warnings: output.warnings,
      elements: output.elements,
      summary: {
        total: statuses.length,
        preserved: statuses.filter((status) => status === 'preserved').length,
        converted: statuses.filter((status) => status === 'converted').length,
        uncertain: statuses.filter((status) => status === 'uncertain').length,
        unsupported: statuses.filter((status) => status === 'unsupported').length,
      },
    });
    expect(report.summary.total).toBe(output.elements.length);
    expect(new Set(statuses).size).toBeGreaterThan(1);
  });

  it('reports the embedded image it could not carry as a document warning', async () => {
    const { warnings } = await convert(STYLED_SCREENPLAY);
    expect(warnings.map((warning) => warning.code)).toContain('RTF_DESTINATION_SKIPPED');
  });

  it('marks a paragraph whose formatting Fountain cannot express as unsupported', async () => {
    const { elements } = await convert(
      '{\\rtf1\\ansi \\strike Struck through action line.\\strike0\\par}',
    );
    expect(elements[0]).toMatchObject({ status: 'unsupported' });
    expect(elements[0]!.warnings[0]?.code).toBe('RTF_FORMATTING_DROPPED');
  });

  it('forces an uppercase action line so Fountain does not read it as a cue', async () => {
    const { convertedFountain } = await convert('{\\rtf1\\ansi A LOUD CRASH OFFSCREEN.\\par}');
    expect(convertedFountain).toBe('!A LOUD CRASH OFFSCREEN.');
    expect(parseFountain(convertedFountain).elements[0]?.kind).toBe('action');
  });

  it('forces an action line whose first character is a Fountain sigil', async () => {
    const { convertedFountain } = await convert('{\\rtf1\\ansi .45 casings on the floor.\\par}');
    expect(convertedFountain).toBe('!.45 casings on the floor.');
    expect(parseFountain(convertedFountain).elements[0]?.kind).toBe('action');
  });

  it('forces a right-aligned transition that Fountain would not infer', async () => {
    const { convertedFountain } = await convert('{\\rtf1\\ansi\\qr FADE OUT.\\par}');
    expect(convertedFountain).toBe('> FADE OUT.');
    expect(parseFountain(convertedFountain).elements[0]?.kind).toBe('transition');
  });

  it('rejects a document that is not RTF as invalid source', async () => {
    await expect(convert('<html><body>Not RTF</body></html>')).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('rejects an RTF document with no readable text as invalid source', async () => {
    await expect(convert('{\\rtf1\\ansi{\\fonttbl{\\f0 Courier;}}\\par}')).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('rejects deeply nested groups as invalid source rather than exhausting the stack', async () => {
    // The fixture that crashed `rtf-parser` with an uncaught RangeError in #247.
    // A `RangeError` here would surface as an unattributable worker crash; a
    // `ScreenplayAdapterSourceError` is reported as `invalid-source`.
    const failure = await convert(deeplyNestedRtfGroups(200_000)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ScreenplayAdapterSourceError);
    expect(failure).not.toBeInstanceOf(RangeError);
  });

  it('survives a control-word flood and rejects it as empty rather than hanging', async () => {
    await expect(convert(rtfControlWordFlood(200_000))).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('survives unterminated groups and still converts the text they contained', async () => {
    const { convertedFountain, warnings } = await convert(unterminatedRtfGroups(64));
    expect(convertedFountain).toContain('Orphaned text');
    expect(warnings.map((warning) => warning.code)).toContain('RTF_UNBALANCED_GROUPS');
  });

  it('survives a lying \\bin run and converts the text around it', async () => {
    const { convertedFountain } = await convert(rtfLyingBinaryRun(1_000_000_000));
    expect(convertedFountain).toContain('Before');
  });

  it('survives absurd numeric parameters', async () => {
    const { convertedFountain } = await convert(rtfAbsurdParameters());
    expect(convertedFountain).toContain('Text survives');
  });

  it('survives a flood of ignorable destinations without emitting their contents', async () => {
    const { convertedFountain } = await convert(rtfDestinationFlood(20_000));
    expect(convertedFountain).toBe('Visible');
    expect(convertedFountain).not.toContain('hidden');
  });

  it('returns output over the character ceiling so the runtime can reject it', async () => {
    const body = `${'word '.repeat(20)}\\par `.repeat(60);
    const output = await convert(
      `{\\rtf1\\ansi ${body}}`,
      makeContext({ maxOutputCharacters: 200 }),
    );
    expect(output.convertedFountain.length).toBeGreaterThan(200);
  });

  it('returns more elements than the ceiling so the runtime can reject it', async () => {
    const output = await convert(
      `{\\rtf1\\ansi ${'line\\par '.repeat(40)}}`,
      makeContext({ maxElements: 5 }),
    );
    expect(output.elements.length).toBeGreaterThan(5);
  });

  it('caps document warnings at the runtime ceiling', async () => {
    const { warnings } = await convert(STYLED_SCREENPLAY, makeContext({ maxWarnings: 1 }));
    expect(warnings.length).toBeLessThanOrEqual(1);
  });

  it('cooperates with cancellation before doing any conversion work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(convert(STYLED_SCREENPLAY, makeContext({}, controller))).rejects.toThrow(
      ScreenplayAdapterAbortError,
    );
  });
});
