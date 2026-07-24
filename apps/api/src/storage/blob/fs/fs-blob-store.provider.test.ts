import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envValue: Record<string, unknown> = {
  APP_ORIGIN: 'http://app.test',
  SIGNED_UPLOAD_TTL_SECONDS: 900,
  SIGNED_READ_TTL_SECONDS: 300,
  BLOB_FS_ROOT: undefined,
};

vi.mock('../../../config/env', () => ({ env: () => envValue }));

import { FsBlobStoreProvider } from './fs-blob-store.provider';

let provider: FsBlobStoreProvider;

beforeEach(() => {
  provider = new FsBlobStoreProvider();
});

afterEach(() => {
  envValue.BLOB_FS_ROOT = undefined;
});

describe('FsBlobStoreProvider', () => {
  it('advertises a proxied backend', () => {
    expect(provider.capabilities).toEqual({ directUpload: false, presignedRead: false });
  });

  it('refuses to build a store when BLOB_FS_ROOT is unset', () => {
    expect(() => provider.active()).toThrow('BLOB_FS_ROOT');
  });

  it('shares one signer between minted URLs and token verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coda-fs-provider-'));
    envValue.BLOB_FS_ROOT = root;
    try {
      const target = await provider.active().createUpload('project-1/object-1', {
        contentType: 'application/pdf',
        contentLength: 10,
      });
      const token = target.url.replace('http://app.test/api/v1/blob/upload/', '');
      expect(provider.verifyUpload(token).key).toBe('project-1/object-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies download tokens it minted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coda-fs-provider-'));
    envValue.BLOB_FS_ROOT = root;
    try {
      const target = await provider.active().createReadUrl('project-1/object-1', {
        disposition: 'inline',
        contentType: 'application/pdf',
      });
      const token = target.url.replace('http://app.test/api/v1/blob/download/', '');
      expect(provider.verifyDownload(token).contentType).toBe('application/pdf');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
