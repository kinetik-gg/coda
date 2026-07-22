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
