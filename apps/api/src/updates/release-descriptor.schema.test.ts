import { describe, expect, it } from 'vitest';
import { parseReleaseDescriptor } from './release-descriptor.schema';

const valid = {
  version: '1.2.3',
  image: 'ghcr.io/kinetik-gg/coda',
  digest: `sha256:${'a'.repeat(64)}`,
  bundleSha256: 'b'.repeat(64),
};

describe('parseReleaseDescriptor', () => {
  it('accepts a well-formed descriptor', () => {
    expect(parseReleaseDescriptor(valid)).toEqual(valid);
  });

  it('rejects a malformed version', () => {
    expect(() => parseReleaseDescriptor({ ...valid, version: 'v1.2.3' })).toThrow();
  });

  it('rejects a malformed digest', () => {
    expect(() => parseReleaseDescriptor({ ...valid, digest: 'sha256:not-hex' })).toThrow();
  });

  it('rejects a malformed bundle checksum', () => {
    expect(() => parseReleaseDescriptor({ ...valid, bundleSha256: 'too-short' })).toThrow();
  });

  it('rejects missing fields and non-object payloads', () => {
    expect(() => parseReleaseDescriptor({})).toThrow();
    expect(() => parseReleaseDescriptor(null)).toThrow();
    expect(() => parseReleaseDescriptor('not-json')).toThrow();
    expect(() => parseReleaseDescriptor(undefined)).toThrow();
  });
});
