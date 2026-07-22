import { describe, expect, it } from 'vitest';
import {
  clampScreenplaySourceOffset,
  clampScreenplaySourceSelection,
} from './screenplay-source-selection';

describe('screenplay source selection bounds', () => {
  it('clamps stale asynchronous preview offsets to the current editor document', () => {
    expect(clampScreenplaySourceOffset(80, 12)).toBe(12);
    expect(clampScreenplaySourceOffset(-4, 12)).toBe(0);
    expect(clampScreenplaySourceSelection({ anchor: 80, head: -4, from: -4, to: 80 }, 12)).toEqual({
      anchor: 12,
      head: 0,
      from: 0,
      to: 12,
    });
  });
});
