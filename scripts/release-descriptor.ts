import { immutableReleaseReference } from './release-reference';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const BUNDLE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CHECKSUM_LINE_PATTERN = /^([0-9a-f]{64}) {2}(.+)$/u;

export const RELEASE_DESCRIPTOR_ASSET_NAME = 'release.json';

export interface ReleaseDescriptor {
  version: string;
  image: string;
  digest: string;
  bundleSha256: string;
}

export function buildReleaseDescriptor(descriptor: ReleaseDescriptor): ReleaseDescriptor {
  if (!VERSION_PATTERN.test(descriptor.version)) {
    throw new Error('Release version must be SemVer without a leading v');
  }
  // Reuse the immutable-reference guard so image and digest obey the same policy as
  // the release note and deployment bundle.
  immutableReleaseReference(descriptor.image, descriptor.digest);
  if (!BUNDLE_SHA256_PATTERN.test(descriptor.bundleSha256)) {
    throw new Error('Bundle SHA-256 must be a 64-character lowercase hex digest');
  }
  return {
    version: descriptor.version,
    image: descriptor.image,
    digest: descriptor.digest,
    bundleSha256: descriptor.bundleSha256,
  };
}

export function serializeReleaseDescriptor(descriptor: ReleaseDescriptor): string {
  const validated = buildReleaseDescriptor(descriptor);
  return `${JSON.stringify(
    {
      version: validated.version,
      image: validated.image,
      digest: validated.digest,
      bundleSha256: validated.bundleSha256,
    },
    null,
    2,
  )}\n`;
}

export function bundleChecksumFromFile(content: string, expectedFileName: string): string {
  const line = content.trim();
  const match = CHECKSUM_LINE_PATTERN.exec(line);
  if (!match) throw new Error('Bundle checksum file must be a single sha256 entry');
  if (match[2] !== expectedFileName) {
    throw new Error(`Bundle checksum references ${match[2]}, not ${expectedFileName}`);
  }
  return match[1]!;
}
