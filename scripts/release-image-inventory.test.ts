import { describe, expect, it } from 'vitest';
import { bundledReleaseImages } from './release-image-inventory';

describe('bundled release image inventory', () => {
  it('deduplicates every pinned runtime and one-shot image', () => {
    expect(bundledReleaseImages(process.cwd())).toEqual([
      {
        id: 'fb8f773eac8e',
        reference:
          'minio/mc:RELEASE.2025-07-21T05-28-08Z@sha256:fb8f773eac8ef9d6da0486d5dec2f42f219358bcb8de579d1623d518c9ebd4cc',
      },
      {
        id: 'd249d1fb6966',
        reference:
          'minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0',
      },
      {
        id: 'bb377b7239d2',
        reference:
          'postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2',
      },
    ]);
  });
});
