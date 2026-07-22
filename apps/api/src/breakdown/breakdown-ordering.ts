import { BadRequestException } from '@nestjs/common';
import { evenlySpacedRanks, rankBetween } from '../common/rank';

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
