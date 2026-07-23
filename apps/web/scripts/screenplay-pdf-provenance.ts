import { createHash } from 'node:crypto';

const sha256Pattern = /^[0-9a-f]{64}$/u;

export interface ScreenplayPdfFixtureHashes {
  fountain: string;
  reference: string;
}

export function requiredParityFixtureHashes(
  fountain: string | undefined,
  reference: string | undefined,
): ScreenplayPdfFixtureHashes {
  if (!fountain || !reference) {
    throw new Error('Strict PDF parity requires expected SHA-256 values for both fixtures');
  }
  assertExpectedHash('Fountain source', fountain);
  assertExpectedHash('reference PDF', reference);
  return { fountain, reference };
}

export function assertParityFixtureHash(
  label: 'Fountain source' | 'reference PDF',
  bytes: Uint8Array,
  expectedSha256: string,
): void {
  assertExpectedHash(label, expectedSha256);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`${label} does not match the expected SHA-256`);
  }
}

function assertExpectedHash(
  label: 'Fountain source' | 'reference PDF',
  expectedSha256: string,
): void {
  if (!sha256Pattern.test(expectedSha256)) {
    throw new Error(`${label} expected SHA-256 must be 64 lowercase hexadecimal characters`);
  }
}
