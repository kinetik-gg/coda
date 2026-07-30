import { describe, expect, it } from 'vitest';
import { ScreenplayAdapterSourceError } from '@coda/contracts';
import {
  deeplyNestedRtfGroups,
  rtfAbsurdParameters,
  rtfControlWordFlood,
  rtfDestinationFlood,
  rtfLyingBinaryRun,
  unterminatedRtfGroups,
} from '../../../parser-qualification/adversarial-zip-fixtures';
import { parseRtfParagraphs, RTF_MAX_GROUP_DEPTH, type RtfParseResult } from './rtf-paragraphs';

const limits = { maxParagraphs: 50_001, maxTextCharacters: 5_000_000, maxWarnings: 1_000 };

function parse(source: string, overrides: Partial<typeof limits> = {}): Promise<RtfParseResult> {
  return parseRtfParagraphs(new Uint8Array(Buffer.from(source, 'latin1')), {
    limits: { ...limits, ...overrides },
    throwIfCancelled: () => {
      /* never cancelled in these tests */
    },
  });
}

function texts(result: RtfParseResult): string[] {
  return result.paragraphs.map((paragraph) => paragraph.text);
}

function warningCodes(result: RtfParseResult): string[] {
  return result.warnings.map((warning) => warning.code).sort();
}

describe('RTF paragraph walker', () => {
  it('rejects a document without an RTF header', async () => {
    await expect(parse('<html><body>no</body></html>')).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('accepts a header behind a UTF-8 BOM and leading whitespace', async () => {
    const source = '﻿\n  {\\rtf1\\ansi Kept\\par}';
    await expect(parse(Buffer.from(source, 'utf8').toString('latin1'))).resolves.toBeDefined();
  });

  it('splits paragraphs on \\par and keeps one separator between them', async () => {
    const result = await parse('{\\rtf1\\ansi One\\par\\par\\par\\par Two\\par}');
    expect(texts(result)).toEqual(['One', '', 'Two']);
  });

  it('records the byte range each paragraph came from', async () => {
    const result = await parse('{\\rtf1\\ansi One\\par Two\\par}');
    const [first, second] = result.paragraphs;
    expect(first!.sourceStart).toBe(0);
    expect(first!.sourceEnd).toBeGreaterThan(first!.sourceStart);
    expect(second!.sourceStart).toBeGreaterThanOrEqual(first!.sourceEnd);
    expect(second!.sourceEnd).toBeGreaterThan(second!.sourceStart);
  });

  it('skips a font table and a stylesheet without emitting their contents', async () => {
    const result = await parse(
      '{\\rtf1\\ansi{\\fonttbl{\\f0\\froman Times New Roman;}}' +
        '{\\stylesheet{\\s0 Normal;}}Body text\\par}',
    );
    expect(texts(result)).toEqual(['Body text']);
  });

  it('skips an ignorable destination and restores skip state when it closes', async () => {
    const result = await parse('{\\rtf1\\ansi{\\*\\generator Coda;}Kept\\par}');
    expect(texts(result)).toEqual(['Kept']);
  });

  it('keeps a field result while dropping its instruction', async () => {
    const result = await parse('{\\rtf1\\ansi{\\field{\\*\\fldinst PAGE}{\\fldrslt 7}}\\par}');
    expect(texts(result)).toEqual(['7']);
  });

  it('warns about an embedded image and drops its payload', async () => {
    const result = await parse('{\\rtf1\\ansi{\\pict\\pngblip ffffffff}Visible\\par}');
    expect(texts(result)).toEqual(['Visible']);
    expect(warningCodes(result)).toContain('RTF_DESTINATION_SKIPPED');
  });

  it('decodes Windows-1252 high bytes exactly', async () => {
    const result = await parse("{\\rtf1\\ansi Caf\\'e9 \\'97 \\'93quoted\\'94\\par}");
    expect(texts(result)).toEqual(['Café — “quoted”']);
  });

  it('warns when the document declares a code page it cannot decode exactly', async () => {
    const result = await parse('{\\rtf1\\mac\\ansicpg10000 Text\\par}');
    expect(warningCodes(result)).toContain('RTF_UNSUPPORTED_CODE_PAGE');
  });

  it('prefers \\uN over its code-page fallback and skips exactly \\uc characters', async () => {
    const result = await parse("{\\rtf1\\ansi\\uc1 na\\u239 ?ve\\par}");
    expect(texts(result)).toEqual(['naïve']);
  });

  it('skips a multi-character \\uc fallback run', async () => {
    const result = await parse("{\\rtf1\\ansi\\uc3 \\u9731 XXXsnow\\par}");
    expect(texts(result)).toEqual(['☃snow']);
  });

  it('never lets a fallback run swallow a paragraph break', async () => {
    const result = await parse('{\\rtf1\\ansi\\uc5 \\u65 \\par Second\\par}');
    expect(texts(result)).toEqual(['A', 'Second']);
  });

  it('replaces an out-of-range Unicode escape rather than throwing', async () => {
    const result = await parse('{\\rtf1\\ansi\\u99999999 ?x\\par}');
    expect(warningCodes(result)).toContain('RTF_UNICODE_OUT_OF_RANGE');
    expect(texts(result)[0]).toBe('�x');
  });

  it('carries bold, italic and underline into Fountain emphasis', async () => {
    const result = await parse('{\\rtf1\\ansi \\b bold\\b0  \\i italic\\i0  \\ul under\\ulnone\\par}');
    expect(result.paragraphs[0]!.markup).toBe('**bold** *italic* _under_');
  });

  it('escapes literal emphasis delimiters so they survive a Fountain round trip', async () => {
    const result = await parse('{\\rtf1\\ansi 2 * 3 and snake_case\\par}');
    expect(result.paragraphs[0]!.markup).toBe('2 \\* 3 and snake\\_case');
  });

  it('uppercases text under \\caps', async () => {
    const result = await parse('{\\rtf1\\ansi \\caps quiet\\caps0  loud\\par}');
    expect(texts(result)).toEqual(['QUIET loud']);
  });

  it('drops hidden text entirely', async () => {
    const result = await parse('{\\rtf1\\ansi Shown {\\v hidden }end\\par}');
    expect(texts(result)).toEqual(['Shown end']);
  });

  it('keeps struck-through text but records the formatting as dropped', async () => {
    const result = await parse('{\\rtf1\\ansi \\strike cut\\strike0  kept\\par}');
    expect(texts(result)).toEqual(['cut kept']);
    expect(result.paragraphs[0]!.unrepresentableFormatting).toBe(true);
    expect(warningCodes(result)).toContain('RTF_FORMATTING_DROPPED');
  });

  it('records alignment and left indent per paragraph', async () => {
    const result = await parse('{\\rtf1\\ansi\\qr\\li2160 Right\\par}');
    expect(result.paragraphs[0]).toMatchObject({ alignment: 'right', leftIndentTwips: 2160 });
  });

  it('resets paragraph formatting on \\pard', async () => {
    const result = await parse('{\\rtf1\\ansi\\qc\\li1440 Centered\\par\\pard Plain\\par}');
    expect(result.paragraphs[0]!.alignment).toBe('center');
    expect(result.paragraphs[1]).toMatchObject({ alignment: 'left', leftIndentTwips: 0 });
  });

  it('marks a page break on the paragraph that follows it', async () => {
    const result = await parse('{\\rtf1\\ansi One\\page Two\\par}');
    expect(result.paragraphs.at(-1)).toMatchObject({ text: 'Two', pageBreakBefore: true });
  });

  it('flattens table cells into paragraphs and says so', async () => {
    const result = await parse('{\\rtf1\\ansi A\\cell B\\cell\\row}');
    expect(texts(result)).toEqual(['A', 'B']);
    expect(warningCodes(result)).toContain('RTF_TABLE_FLATTENED');
  });

  it('rejects group nesting past the depth cap instead of exhausting the call stack', async () => {
    // The exact shape that crashed `rtf-parser` with an uncaught RangeError.
    await expect(parse(deeplyNestedRtfGroups(200_000))).rejects.toThrow(
      new RegExp(`${RTF_MAX_GROUP_DEPTH}-level limit`, 'u'),
    );
  });

  it('accepts nesting right up to the depth cap', async () => {
    const depth = RTF_MAX_GROUP_DEPTH - 2;
    const source = `{\\rtf1\\ansi ${'{'.repeat(depth)}deep${'}'.repeat(depth)}\\par}`;
    expect(texts(await parse(source))).toEqual(['deep']);
  });

  it('recovers text from unterminated groups and warns', async () => {
    const result = await parse(unterminatedRtfGroups(64));
    expect(texts(result)).toContain('Orphaned text');
    expect(warningCodes(result)).toContain('RTF_UNBALANCED_GROUPS');
  });

  it('ignores unmatched closing braces and warns', async () => {
    const result = await parse('{\\rtf1\\ansi Kept\\par}}}}');
    expect(texts(result)).toEqual(['Kept']);
    expect(warningCodes(result)).toContain('RTF_STRAY_GROUP_END');
  });

  it('survives a control-word flood and produces no spurious paragraphs', async () => {
    const result = await parse(rtfControlWordFlood(200_000));
    expect(result.paragraphs).toHaveLength(0);
  });

  it('survives absurd numeric parameters and keeps the readable text', async () => {
    const result = await parse(rtfAbsurdParameters());
    expect(texts(result).join(' ')).toContain('Text survives');
  });

  it('skips a lying \\bin run, keeps surrounding text and reports the skip', async () => {
    const result = await parse(rtfLyingBinaryRun(1_000_000_000));
    expect(texts(result)).toContain('Before');
    expect(warningCodes(result)).toContain('RTF_BINARY_SKIPPED');
  });

  it('skips a flood of sibling destinations without leaking skip state', async () => {
    const result = await parse(rtfDestinationFlood(20_000));
    expect(texts(result)).toEqual(['Visible']);
  });

  it('stops once the kept text crosses its ceiling, reporting truncation', async () => {
    const body = `${'word '.repeat(40)}\\par`.repeat(200);
    const result = await parse(`{\\rtf1\\ansi ${body}}`, { maxTextCharacters: 500 });
    expect(result.truncated).toBe(true);
    expect(result.paragraphs.length).toBeLessThan(200);
  });

  it('stops once the paragraph ceiling is crossed, reporting truncation', async () => {
    const result = await parse(`{\\rtf1\\ansi ${'line\\par '.repeat(50)}}`, { maxParagraphs: 5 });
    expect(result.truncated).toBe(true);
    expect(result.paragraphs).toHaveLength(5);
  });

  it('propagates cancellation out of the walk', async () => {
    const bytes = new Uint8Array(Buffer.from(rtfControlWordFlood(100_000), 'latin1'));
    await expect(
      parseRtfParagraphs(bytes, {
        limits,
        throwIfCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });
});
