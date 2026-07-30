import { describe, expect, it } from 'vitest';
import {
  deeplyNestedRtfGroups,
  rtfControlWordFlood,
} from '../../../parser-qualification/adversarial-zip-fixtures';
import { RTF_MAX_PARAMETER, RtfTokenizer } from './rtf-tokenizer';

interface CapturedToken {
  type: string;
  word: string;
  param: number;
  hasParam: boolean;
  malformed: boolean;
  text: string;
}

function tokenize(source: string | Uint8Array): CapturedToken[] {
  const bytes = typeof source === 'string' ? Buffer.from(source, 'latin1') : source;
  const tokenizer = new RtfTokenizer(new Uint8Array(bytes));
  const tokens: CapturedToken[] = [];
  while (tokenizer.next()) {
    tokens.push({
      type: tokenizer.type,
      word: tokenizer.word,
      param: tokenizer.param,
      hasParam: tokenizer.hasParam,
      malformed: tokenizer.malformed,
      text:
        tokenizer.type === 'text'
          ? Buffer.from(bytes.subarray(tokenizer.start, tokenizer.end)).toString('latin1')
          : '',
    });
  }
  return tokens;
}

describe('RTF tokenizer', () => {
  it('reads groups, control words, parameters and literal text', () => {
    expect(tokenize('{\\rtf1\\ansi Hello}')).toEqual([
      { type: 'group-start', word: '', param: 0, hasParam: false, malformed: false, text: '' },
      { type: 'control-word', word: 'rtf', param: 1, hasParam: true, malformed: false, text: '' },
      { type: 'control-word', word: 'ansi', param: 0, hasParam: false, malformed: false, text: '' },
      { type: 'text', word: '', param: 0, hasParam: false, malformed: false, text: 'Hello' },
      { type: 'group-end', word: '', param: 0, hasParam: false, malformed: false, text: '' },
    ]);
  });

  it('reads a negative parameter and consumes only one delimiting space', () => {
    const tokens = tokenize('\\li-720  x');
    expect(tokens[0]).toMatchObject({ word: 'li', param: -720, hasParam: true });
    expect(tokens[1]).toMatchObject({ type: 'text', text: ' x' });
  });

  it('treats CR and LF between tokens as whitespace rather than text', () => {
    expect(tokenize('a\r\nb').map((token) => token.text)).toEqual(['a', 'b']);
  });

  it('decodes a hex escape as a control symbol carrying the byte value', () => {
    expect(tokenize("\\'e9")[0]).toMatchObject({
      type: 'control-symbol',
      word: "'",
      param: 0xe9,
      hasParam: true,
    });
  });

  it('flags a hex escape without two hex digits instead of consuming the next token', () => {
    const tokens = tokenize("\\'zz");
    expect(tokens[0]).toMatchObject({ word: "'", hasParam: false, malformed: true });
    expect(tokens[1]).toMatchObject({ type: 'text', text: 'zz' });
  });

  it('clamps an absurd numeric parameter to a safe integer', () => {
    const tokens = tokenize('\\fs99999999999999999999 x');
    expect(tokens[0]).toMatchObject({ param: RTF_MAX_PARAMETER, malformed: true });
    expect(Number.isSafeInteger(tokens[0]!.param)).toBe(true);
  });

  it('clamps an absurd negative parameter symmetrically', () => {
    expect(tokenize('\\li-99999999999999999999 x')[0]).toMatchObject({
      param: -RTF_MAX_PARAMETER,
      malformed: true,
    });
  });

  it('truncates an over-long control word but still consumes all of it', () => {
    const tokens = tokenize(`\\${'a'.repeat(400)} tail`);
    expect(tokens[0]!.word).toHaveLength(32);
    expect(tokens[0]!.malformed).toBe(true);
    expect(tokens[1]).toMatchObject({ type: 'text', text: 'tail' });
  });

  it('skips a \\bin payload so binary bytes are never rescanned as markup', () => {
    const bytes = Buffer.concat([
      Buffer.from('\\bin4 ', 'latin1'),
      Buffer.from([0x5c, 0x7b, 0x7d, 0x5c]),
      Buffer.from('after', 'latin1'),
    ]);
    const tokens = tokenize(new Uint8Array(bytes));
    expect(tokens[0]).toMatchObject({ word: 'bin', param: 4, malformed: false });
    expect(tokens[1]).toMatchObject({ type: 'text', text: 'after' });
  });

  it('clamps a \\bin run that claims more bytes than remain, and flags it', () => {
    const tokens = tokenize('\\bin1000000000 tiny');
    expect(tokens[0]).toMatchObject({ word: 'bin', malformed: true });
    expect(tokens).toHaveLength(1);
  });

  it('flags a trailing backslash at end of input rather than looping', () => {
    const tokens = tokenize('text\\');
    expect(tokens[1]).toMatchObject({ type: 'control-symbol', malformed: true });
  });

  it('emits control symbols for escaped braces and backslashes', () => {
    expect(tokenize('\\{\\}\\\\').map((token) => token.word)).toEqual(['{', '}', '\\']);
  });

  it('walks a 200,000-level nested-group fixture as flat tokens without recursing', () => {
    // This is the fixture that crashed `rtf-parser` with an uncaught RangeError
    // (see docs/adr-rtf-docx-parser-qualification.md). The tokenizer has no
    // recursion at all, so depth costs it nothing; bounding depth is the
    // walker's job, not the scanner's.
    const bytes = new Uint8Array(Buffer.from(deeplyNestedRtfGroups(200_000), 'latin1'));
    const tokenizer = new RtfTokenizer(bytes);
    let opens = 0;
    let closes = 0;
    while (tokenizer.next()) {
      if (tokenizer.type === 'group-start') opens += 1;
      if (tokenizer.type === 'group-end') closes += 1;
    }
    expect(opens).toBe(200_001);
    expect(closes).toBe(200_001);
  });

  it('tokenizes a large control-word flood without materialising a token list', () => {
    const bytes = new Uint8Array(Buffer.from(rtfControlWordFlood(200_000), 'latin1'));
    const tokenizer = new RtfTokenizer(bytes);
    let controlWords = 0;
    while (tokenizer.next()) {
      if (tokenizer.type === 'control-word' && tokenizer.word === 'b') controlWords += 1;
    }
    expect(controlWords).toBe(200_000);
  });
});
