import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SCREENPLAY_COLLAB_TEXT_KEY, yTextToString } from './screenplay-collab.constants';
import { rewriteScreenplayText, screenplaySourceSplice } from './screenplay-collab-text-rewrite';

function rewritten(current: string, next: string): string {
  const doc = new Y.Doc();
  const text = doc.getText(SCREENPLAY_COLLAB_TEXT_KEY);
  text.insert(0, current);
  rewriteScreenplayText(text, current, next);
  const result = yTextToString(text);
  doc.destroy();
  return result;
}

describe('screenplaySourceSplice', () => {
  it('keeps the shared prefix and suffix so only the changed middle is replaced', () => {
    expect(
      screenplaySourceSplice('INT. ROOM - DAY\nA beat.\n', 'INT. ROOM - NIGHT\nA beat.\n'),
    ).toEqual({ index: 12, removed: 3, inserted: 'NIGHT' });
  });

  it('reports an append as a pure insertion at the end', () => {
    expect(screenplaySourceSplice('FADE IN:\n', 'FADE IN:\nINT. ROOM - DAY\n')).toEqual({
      index: 9,
      removed: 0,
      inserted: 'INT. ROOM - DAY\n',
    });
  });

  it('reports an unchanged document as an empty splice', () => {
    expect(screenplaySourceSplice('FADE IN:\n', 'FADE IN:\n')).toEqual({
      index: 9,
      removed: 0,
      inserted: '',
    });
  });

  it('never splits a surrogate pair', () => {
    // Same leading high surrogate, different trailing low surrogate: a naive code-unit prefix would
    // cut between the two halves and leave a lone surrogate in the shared document.
    const splice = screenplaySourceSplice('A 🎬 B', 'A 🎭 B');
    expect(splice.index).toBe(2);
    expect('A 🎬 B'.slice(0, splice.index)).toBe('A ');
    expect(
      'A 🎬 B'.slice(0, splice.index) +
        splice.inserted +
        'A 🎬 B'.slice(splice.index + splice.removed),
    ).toBe('A 🎭 B');
  });
});

describe('rewriteScreenplayText', () => {
  it.each([
    ['', 'Title: Draft\n'],
    ['Title: Draft\n', ''],
    ['Title: Draft\n', 'Title: Draft\n\nFADE IN:\n'],
    ['Title: Draft\n\nFADE IN:\n', 'Title: Draft\n'],
    ['INT. ROOM - DAY', 'EXT. STREET - NIGHT'],
    ['A 🎬 B', 'A 🎭 B'],
    ['Café\n', 'Café au lait\n'],
  ])('turns %j into %j', (current, next) => {
    expect(rewritten(current, next)).toBe(next);
  });

  it('leaves concurrent collaborators positioned in the untouched prefix undisturbed', () => {
    const doc = new Y.Doc();
    const text = doc.getText(SCREENPLAY_COLLAB_TEXT_KEY);
    const current = 'Title: Draft\n\nFADE IN:\n\nOLD SCENE\n';
    text.insert(0, current);
    // A comment-thread anchor / cursor pinned inside the prefix that the rewrite does not change.
    const anchor = Y.createRelativePositionFromTypeIndex(text, 7);

    const next = 'Title: Draft\n\nFADE IN:\n\nNEW SCENE\n';
    rewriteScreenplayText(text, current, next);

    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
    expect(resolved?.index).toBe(7);
    expect(yTextToString(text)).toBe(next);
    doc.destroy();
  });
});
