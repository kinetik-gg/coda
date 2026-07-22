import { describe, expect, it } from 'vitest';
import { detectScreenplayFormat } from './detect';

describe('detectScreenplayFormat', () => {
  it('recognizes Final Draft XML by its root instead of trusting an incorrect extension', () => {
    expect(
      detectScreenplayFormat(
        '<?xml version="1.0"?><!-- Final Draft export --><FinalDraft DocumentType="Script"><Content/></FinalDraft>',
        'draft.txt',
      ),
    ).toEqual({
      format: 'final-draft',
      confidence: 'certain',
      reason: 'FinalDraft XML root element',
    });
  });

  it.each([
    ['Title: Rain\nAuthor: Ada\n\nINT. ROOM - DAY', 'fountain'],
    ['.A deliberately forced heading', 'fountain'],
    ['INT./EXT. CAR - NIGHT', 'fountain'],
    ['Just an ordinary prose document.', 'plain-text'],
  ])('detects content %j as %s', (source, format) => {
    expect(detectScreenplayFormat(source).format).toBe(format);
  });

  it('identifies unsupported proprietary containers by extension', () => {
    expect(detectScreenplayFormat('binary-like payload', 'draft.fadein')).toMatchObject({
      format: 'fade-in',
      confidence: 'certain',
    });
  });

  it('decodes UTF-16 input before inspecting it', () => {
    const payload = new Uint8Array([
      0xff,
      0xfe,
      ...new Uint8Array(Buffer.from('I\0N\0T\0.\0 \0R\0O\0O\0M\0', 'binary')),
    ]);
    expect(detectScreenplayFormat(payload).format).toBe('fountain');
  });

  it('rejects undecodable bytes with a typed encoding error', () => {
    expect(() => detectScreenplayFormat(new Uint8Array([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENCODING' }),
    );
  });
});
