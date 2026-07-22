import { describe, expect, it } from 'vitest';
import { headerMinimumColumnWidth, resizedColumnWidth } from './entity-table-sizing';

describe('entity table column sizing', () => {
  it('uses the rendered header and cell padding as the resize floor', () => {
    expect(headerMinimumColumnWidth(27.2, 9, 9)).toBe(46);
    expect(resizedColumnWidth(20, 46)).toBe(46);
  });

  it('allows short headers to shrink below the old generic 48px floor', () => {
    const minimum = headerMinimumColumnWidth(12, 9, 9);

    expect(minimum).toBe(30);
    expect(resizedColumnWidth(31, minimum)).toBe(31);
  });

  it('guards invalid measurements and retains the upper safety bound', () => {
    expect(headerMinimumColumnWidth(Number.NaN, -2, Number.POSITIVE_INFINITY)).toBe(1);
    expect(resizedColumnWidth(5000, 30)).toBe(1600);
  });
});
