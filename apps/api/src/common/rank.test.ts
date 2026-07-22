import { describe, expect, it } from 'vitest';
import { evenlySpacedRanks, rankBetween } from './rank';

describe('fractional ranks', () => {
  it('creates sortable ranks between boundaries', () => {
    const middle = rankBetween();
    const before = rankBetween(null, middle);
    const after = rankBetween(middle, null);
    expect(before < middle && middle < after).toBe(true);
  });

  it('creates stable rebalance ranks', () => {
    const values = evenlySpacedRanks(3);
    expect(values).toHaveLength(3);
    expect(values[0]! < values[1]! && values[1]! < values[2]!).toBe(true);
  });
});
