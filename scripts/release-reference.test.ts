import { describe, expect, it } from 'vitest';
import { immutableReleaseNote, immutableReleaseReference } from './release-reference';

describe('immutable release reference', () => {
  const digest = `sha256:${'a'.repeat(64)}`;

  it('builds a copyable manifest reference and release note', () => {
    expect(immutableReleaseReference('ghcr.io/example/coda', digest)).toBe(
      `ghcr.io/example/coda@${digest}`,
    );
    expect(immutableReleaseNote('ghcr.io/example/coda', digest)).toBe(
      `Immutable container: \`ghcr.io/example/coda@${digest}\``,
    );
  });

  it.each([
    ['Uppercase/image', digest],
    ['ghcr.io/example/coda', 'sha256:not-a-digest'],
    ['ghcr.io/example/coda', `sha512:${'a'.repeat(64)}`],
  ])('rejects an invalid image or digest', (image, invalidDigest) => {
    expect(() => immutableReleaseReference(image, invalidDigest)).toThrow();
  });
});
