import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createScreenplayCommentAnchor,
  resolveScreenplayCommentAnchor,
} from './screenplay-comment-anchors';

function docWithText(source: string): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  const text = doc.getText('source');
  text.insert(0, source);
  return { doc, text };
}

describe('screenplay comment anchors', () => {
  it('captures a normalized range and a bounded quote', () => {
    const { text } = docWithText('FADE IN:\n\nINT. ROOM - DAY\n');
    const anchor = createScreenplayCommentAnchor(text, 25, 10);

    expect(anchor.quotedText).toBe('INT. ROOM - DAY');
    expect(resolveScreenplayCommentAnchor(text, anchor.anchorStart, anchor.anchorEnd)).toEqual({
      start: 10,
      end: 25,
      detached: false,
    });
  });

  it('survives concurrent inserts and deletions above the range', () => {
    const original = 'HEADER\n' + 'x'.repeat(5_000) + '\nINT. LAB - NIGHT\nAction.\n';
    const first = docWithText(original);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first.doc));
    const secondText = second.getText('source');
    const start = original.indexOf('INT. LAB');
    const end = start + 'INT. LAB - NIGHT'.length;
    const anchor = createScreenplayCommentAnchor(first.text, start, end);

    secondText.insert(0, 'CONCURRENT NOTE\n');
    first.text.delete('HEADER\n'.length, 4_950);
    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second, Y.encodeStateVector(first.doc)));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first.doc, Y.encodeStateVector(second)));

    const resolved = resolveScreenplayCommentAnchor(
      secondText,
      anchor.anchorStart,
      anchor.anchorEnd,
    );
    expect(secondText.toJSON().slice(resolved.start, resolved.end)).toBe('INT. LAB - NIGHT');
    expect(resolved.detached).toBe(false);
  });

  it('becomes detached when the anchored range is deleted', () => {
    const { text } = docWithText('One two three');
    const anchor = createScreenplayCommentAnchor(text, 4, 7);

    text.delete(4, 3);

    expect(
      resolveScreenplayCommentAnchor(text, anchor.anchorStart, anchor.anchorEnd),
    ).toMatchObject({
      start: 4,
      end: 4,
      detached: true,
    });
  });

  it('rejects collapsed selections and treats malformed bytes as detached', () => {
    const { text } = docWithText('One two three');

    expect(() => createScreenplayCommentAnchor(text, 4, 4)).toThrow(
      'Select a screenplay range before adding a comment.',
    );
    expect(resolveScreenplayCommentAnchor(text, 'not-base64', 'also-invalid')).toEqual({
      start: 0,
      end: 0,
      detached: true,
    });
  });
});
