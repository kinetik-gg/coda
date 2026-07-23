import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RELEASE_DESCRIPTOR_ASSET_NAME,
  bundleChecksumFromFile,
  buildReleaseDescriptor,
  serializeReleaseDescriptor,
} from './release-descriptor';

const digest = `sha256:${'a'.repeat(64)}`;
const bundleSha256 = 'b'.repeat(64);
const descriptor = {
  version: '0.0.3',
  image: 'ghcr.io/kinetik-gg/coda',
  digest,
  bundleSha256,
};

describe('machine-readable release descriptor', () => {
  it('builds the exact version, image, digest, and bundle hash', () => {
    expect(buildReleaseDescriptor(descriptor)).toEqual(descriptor);
  });

  it('serializes stable, sorted keys with a trailing newline', () => {
    const json = serializeReleaseDescriptor(descriptor);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(json.endsWith('\n')).toBe(true);
    expect(parsed).toEqual(descriptor);
    expect(Object.keys(parsed)).toEqual(['version', 'image', 'digest', 'bundleSha256']);
    expect(serializeReleaseDescriptor(descriptor)).toBe(json);
  });

  it('rejects mutable or malformed coordinates', () => {
    expect(() => buildReleaseDescriptor({ ...descriptor, version: 'v0.0.3' })).toThrow('SemVer');
    expect(() => buildReleaseDescriptor({ ...descriptor, digest: 'sha256:latest' })).toThrow();
    expect(() =>
      buildReleaseDescriptor({ ...descriptor, image: 'ghcr.io/kinetik-gg/coda:latest' }),
    ).toThrow();
    expect(() => buildReleaseDescriptor({ ...descriptor, bundleSha256: 'nothex' })).toThrow(
      'Bundle SHA-256',
    );
  });

  it('reads the bundle hash from the deterministic checksum file', () => {
    const content = `${bundleSha256}  coda-deployment-v0.0.3.tar.gz\n`;
    expect(bundleChecksumFromFile(content, 'coda-deployment-v0.0.3.tar.gz')).toBe(bundleSha256);
    expect(() => bundleChecksumFromFile(content, 'other.tar.gz')).toThrow('references');
    expect(() => bundleChecksumFromFile('not-a-checksum\n', 'x')).toThrow('single sha256');
  });

  it('is published as an immutable asset after the deployment bundle', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toContain('pnpm release:descriptor');
    expect(workflow).toContain('--checksum');
    const publisher = readFileSync('scripts/publish-release-assets.ts', 'utf8');
    expect(publisher).toContain(RELEASE_DESCRIPTOR_ASSET_NAME);
  });
});
