import { createHash } from 'node:crypto';

const sha256Pattern = /^[0-9a-f]{64}$/u;

export function assertParityFixtureHash(
  label: 'Fountain source' | 'reference PDF',
  bytes: Uint8Array,
  expectedSha256: string,
): void {
  if (!sha256Pattern.test(expectedSha256)) {
    throw new Error(`${label} expected SHA-256 must be 64 lowercase hexadecimal characters`);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`${label} does not match the expected SHA-256`);
  }
}
