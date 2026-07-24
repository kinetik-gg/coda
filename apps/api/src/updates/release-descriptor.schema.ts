import { z } from 'zod';

// Mirrors the shape written by scripts/release-descriptor.ts (kept independent here since
// apps/api cannot import across the repo's rootDir boundary from the root-level scripts tree).
export const releaseDescriptorSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, 'Malformed SemVer version'),
  image: z.string().min(1),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u, 'Malformed image digest'),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'Malformed bundle checksum'),
});

export type ReleaseDescriptor = z.infer<typeof releaseDescriptorSchema>;

/** Parses and validates a fetched `release.json` payload, throwing on any malformed field. */
export function parseReleaseDescriptor(payload: unknown): ReleaseDescriptor {
  return releaseDescriptorSchema.parse(payload);
}
