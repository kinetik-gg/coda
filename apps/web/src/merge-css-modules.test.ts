import { describe, expect, it } from 'vitest';
import { mergeCssModules } from './merge-css-modules';

describe('mergeCssModules', () => {
  it('keeps unique classes and concatenates duplicate module keys in order', () => {
    expect(mergeCssModules({ root: 'first', onlyA: 'a' }, { root: 'second', onlyB: 'b' })).toEqual({
      root: 'first second',
      onlyA: 'a',
      onlyB: 'b',
    });
  });
});
