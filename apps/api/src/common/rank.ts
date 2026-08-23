import { BadRequestException } from '@nestjs/common';

const RADIX = 36n;
const WIDTH = 16;
const MAX = RADIX ** BigInt(WIDTH) - 1n;

function decode(rank: string): bigint {
  let value = 0n;
  for (const character of rank.toLowerCase()) {
    const digit = BigInt(Number.parseInt(character, 36));
    if (digit < 0 || digit >= RADIX) throw new Error('Invalid rank');
    value = value * RADIX + digit;
  }
  return value;
}

function encode(value: bigint): string {
  return value.toString(36).padStart(WIDTH, '0');
}

export function rankBetween(before?: string | null, after?: string | null): string {
  const low = before ? decode(before) : 0n;
  const high = after ? decode(after) : MAX;
  if (low >= high) throw new Error('Rank bounds are inverted');
  const midpoint = (low + high) / 2n;
  if (midpoint === low || midpoint === high) throw new Error('Rank space exhausted');
  return encode(midpoint);
}

export function evenlySpacedRanks(count: number): string[] {
  const step = MAX / BigInt(count + 1);
  return Array.from({ length: count }, (_, index) => encode(step * BigInt(index + 1)));
}

export interface RankedSibling {
  id: string;
  position: string;
}

interface MoveBounds {
  before?: RankedSibling;
  after?: RankedSibling;
}

function moveBounds(
  ordered: RankedSibling[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
): MoveBounds {
  const beforeIndex = beforeId ? ordered.findIndex((item) => item.id === beforeId) : -1;
  const afterIndex = afterId ? ordered.findIndex((item) => item.id === afterId) : -1;
  if (beforeId && beforeIndex < 0) {
    throw new BadRequestException('beforeId is not in the target ordering group');
  }
  if (afterId && afterIndex < 0) {
    throw new BadRequestException('afterId is not in the target ordering group');
  }
  if (beforeId && afterId && beforeIndex !== afterIndex + 1) {
    throw new BadRequestException('beforeId and afterId must identify one adjacent gap');
  }

  const before = beforeId ? ordered[beforeIndex] : afterId ? ordered[afterIndex + 1] : undefined;
  const after = afterId
    ? ordered[afterIndex]
    : beforeId
      ? ordered[beforeIndex - 1]
      : ordered.at(-1);
  return { before, after };
}

/**
 * Computes the position rank that moves a row into the gap named by `beforeId`/`afterId` within an
 * ordered sibling group. When the midpoint space between the neighbours is exhausted, the whole
 * group is rebalanced to evenly spaced ranks through the caller's callback and the move is
 * recomputed — callers must run inside the transaction that persists the result.
 */
export async function rankForMove(
  siblings: RankedSibling[],
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
  rebalance: (ranks: RankedSibling[]) => Promise<void>,
): Promise<string> {
  if (beforeId && afterId && beforeId === afterId) {
    throw new BadRequestException('beforeId and afterId must be different');
  }

  let { before, after } = moveBounds(siblings, beforeId, afterId);
  try {
    return rankBetween(after?.position, before?.position);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Rank space exhausted') throw error;
    const ranks = evenlySpacedRanks(siblings.length);
    const rebalanced = siblings.map((sibling, index) => ({
      id: sibling.id,
      position: ranks[index]!,
    }));
    await rebalance(rebalanced);
    ({ before, after } = moveBounds(rebalanced, beforeId, afterId));
    return rankBetween(after?.position, before?.position);
  }
}
