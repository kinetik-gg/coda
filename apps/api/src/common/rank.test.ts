import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { evenlySpacedRanks, rankBetween, rankForMove } from './rank';

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

  it('rejects inverted bounds', () => {
    const anchor = rankBetween();
    expect(() => rankBetween(anchor, anchor)).toThrow('Rank bounds are inverted');
  });
});

describe('rankForMove', () => {
  const siblings = [
    { id: 'a', position: evenlySpacedRanks(2)[0]! },
    { id: 'b', position: evenlySpacedRanks(2)[1]! },
  ];

  it('lands between the named adjacent gap and orders the result stably', async () => {
    const rebalance = vi.fn().mockResolvedValue(undefined);
    const position = await rankForMove(siblings, 'b', 'a', rebalance);
    expect(position > siblings[0]!.position && position < siblings[1]!.position).toBe(true);
    expect(rebalance).not.toHaveBeenCalled();

    const appended = await rankForMove(siblings, undefined, undefined, rebalance);
    expect(appended > siblings[1]!.position).toBe(true);
  });

  it('validates that both anchors name one real gap in the group', async () => {
    const rebalance = vi.fn().mockResolvedValue(undefined);
    await expect(rankForMove(siblings, 'zzz', null, rebalance)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(rankForMove(siblings, null, 'missing', rebalance)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(rankForMove(siblings, 'a', 'a', rebalance)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rebalance).not.toHaveBeenCalled();
  });

  it('rebalances an exhausted gap and recomputes inside it', async () => {
    // Adjacent ranks one unit apart leave no midpoint, so the first attempt exhausts.
    const tightSiblings = [
      { id: 'x', position: '0000000000000001' },
      { id: 'y', position: '0000000000000002' },
    ];
    const rebalance = vi.fn().mockResolvedValue(undefined);
    const position = await rankForMove(tightSiblings, 'y', 'x', rebalance);
    expect(rebalance).toHaveBeenCalledTimes(1);
    expect(position).toEqual(expect.any(String));
    const rebalanced = rebalance.mock.calls[0]![0] as Array<{ id: string; position: string }>;
    expect(rebalanced).toHaveLength(2);
    expect(rebalanced[0]!.position < rebalanced[1]!.position).toBe(true);
  });
});
