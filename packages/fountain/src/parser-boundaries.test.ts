import { describe, expect, it } from 'vitest';
import { parseFountain } from './parser';

describe('automatic Fountain element boundaries', () => {
  it.each([
    ['scene heading', 'INT. ROOM - DAY\nAction immediately.', 'scene_heading'],
    ['transition', 'Action.\n\nCUT TO:\nNext immediately.', 'transition'],
  ])('requires blank context after an automatic %s', (_label, source, excludedKind) => {
    const elements = parseFountain(source).elements;

    expect(elements.some(({ kind }) => kind === excludedKind)).toBe(false);
    expect(elements.some(({ kind }) => kind === 'character')).toBe(false);
    expect(elements).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'action' })]));
  });

  it('recognizes a blank-bounded transition at the start of the document', () => {
    const elements = parseFountain('CUT TO:\n\nAction.').elements;

    expect(elements[0]).toMatchObject({ kind: 'transition', text: 'CUT TO:', forced: false });
    expect(elements.some(({ kind }) => kind === 'title_page')).toBe(false);
  });

  it('treats trailing whitespace after an automatic transition candidate as Action', () => {
    const source = 'CUT TO:   \nFollowing action.';
    const elements = parseFountain(source).elements;

    expect(elements).toEqual([
      expect.objectContaining({
        kind: 'action',
        text: 'CUT TO:   \nFollowing action.',
        forced: false,
      }),
    ]);
  });

  it('keeps forced scene headings and transitions independent of blank context', () => {
    const source = '.OPENING IMAGE\nAction.\n>SMASH TO:\nAction.';

    expect(parseFountain(source).elements).toEqual([
      expect.objectContaining({ kind: 'scene_heading', forced: true, text: 'OPENING IMAGE' }),
      expect.objectContaining({ kind: 'action', text: 'Action.' }),
      expect.objectContaining({ kind: 'transition', forced: true, text: 'SMASH TO:' }),
      expect.objectContaining({ kind: 'action', text: 'Action.' }),
    ]);
  });
});
