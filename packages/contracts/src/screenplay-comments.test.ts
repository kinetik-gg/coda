import { describe, expect, it } from 'vitest';
import {
  createScreenplayCommentSchema,
  createScreenplayCommentThreadSchema,
  listScreenplayCommentThreadsQuerySchema,
  resolveScreenplayCommentThreadSchema,
} from './screenplay-comments';

describe('screenplay comment contracts', () => {
  it('accepts encoded Yjs anchors and trims comment bodies', () => {
    expect(
      createScreenplayCommentThreadSchema.parse({
        anchorStart: 'AQID',
        anchorEnd: 'BAUG',
        quotedText: 'A selected range',
        body: '  Consider tightening this.  ',
      }),
    ).toEqual({
      anchorStart: 'AQID',
      anchorEnd: 'BAUG',
      quotedText: 'A selected range',
      body: 'Consider tightening this.',
    });
  });

  it('rejects malformed anchors, empty comments, and oversized quotes', () => {
    expect(() =>
      createScreenplayCommentThreadSchema.parse({
        anchorStart: 'not base64',
        anchorEnd: 'AQID',
        quotedText: 'quote',
        body: 'comment',
      }),
    ).toThrow();
    expect(() => createScreenplayCommentSchema.parse({ body: '  ' })).toThrow();
    expect(() =>
      createScreenplayCommentThreadSchema.parse({
        anchorStart: 'AQID',
        anchorEnd: 'BAUG',
        quotedText: 'x'.repeat(513),
        body: 'comment',
      }),
    ).toThrow();
  });

  it('defaults list queries to open threads and validates resolution intent', () => {
    expect(listScreenplayCommentThreadsQuerySchema.parse({})).toEqual({ status: 'open' });
    expect(listScreenplayCommentThreadsQuerySchema.parse({ status: 'all' })).toEqual({
      status: 'all',
    });
    expect(resolveScreenplayCommentThreadSchema.parse({ resolved: true })).toEqual({
      resolved: true,
    });
    expect(() => resolveScreenplayCommentThreadSchema.parse({ resolved: 'yes' })).toThrow();
  });
});
