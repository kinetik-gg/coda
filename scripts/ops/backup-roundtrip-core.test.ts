import { describe, expect, it } from 'vitest';
import {
  BACKUP_ARCHIVE_MAGIC as ENGINE_MAGIC,
  MAX_MANIFEST_BYTES,
  MAX_SIGNATURE_BYTES,
} from '../../apps/api/src/backup/backup-archive';
import {
  BACKUP_FORMAT_VERSION as ENGINE_FORMAT_VERSION,
  BACKUP_IMPORT_MIN_VERSION as ENGINE_IMPORT_MIN_VERSION,
} from '../../apps/api/src/backup/backup-format';
import {
  BACKUP_ARCHIVE_MAGIC,
  BACKUP_FORMAT_VERSION,
  BACKUP_IMPORT_MIN_VERSION,
  BACKUP_IMPORT_WINDOW,
  FIXTURE_CONFIG_ENCRYPTION_KEY,
  assertCurrentFormatVersion,
  assertFixtureIsImmediatePredecessor,
  assertImportableFormatVersion,
  computeImportMinVersion,
  normalizeDigest,
  parseImportOutcome,
  readArchiveManifestSummary,
} from './backup-roundtrip-core';

function encodeArchive(manifest: unknown, options: { signatureLength?: number } = {}): Buffer {
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const manifestLength = Buffer.allocUnsafe(4);
  manifestLength.writeUInt32BE(manifestBytes.length, 0);
  const signatureLength = Buffer.allocUnsafe(4);
  const declared = options.signatureLength ?? 88;
  signatureLength.writeUInt32BE(declared, 0);
  return Buffer.concat([
    BACKUP_ARCHIVE_MAGIC,
    manifestLength,
    manifestBytes,
    signatureLength,
    Buffer.alloc(declared),
  ]);
}

const validManifest = {
  formatVersion: BACKUP_FORMAT_VERSION,
  appVersion: '0.0.4',
  createdAt: '2026-07-24T00:00:00.000Z',
  objectStorage: { files: [{ path: 'objects/a' }, { path: 'objects/b' }] },
};

describe('backup round-trip framing constants stay pinned to the engine', () => {
  it('mirrors the engine archive magic and format window', () => {
    expect(BACKUP_ARCHIVE_MAGIC.equals(ENGINE_MAGIC)).toBe(true);
    expect(BACKUP_FORMAT_VERSION).toBe(ENGINE_FORMAT_VERSION);
    expect(BACKUP_IMPORT_MIN_VERSION).toBe(ENGINE_IMPORT_MIN_VERSION);
    // The header parser rejects lengths beyond the engine's own bounds.
    expect(MAX_MANIFEST_BYTES).toBeGreaterThan(0);
    expect(MAX_SIGNATURE_BYTES).toBeGreaterThan(0);
  });

  it('keeps the fixture key an obvious, non-secret, 32+ byte value', () => {
    const decoded = Buffer.from(FIXTURE_CONFIG_ENCRYPTION_KEY, 'base64');
    expect(decoded.length).toBeGreaterThanOrEqual(32);
    // A single repeated character has zero entropy: unmistakably synthetic to
    // both humans and secret scanners.
    expect(new Set(FIXTURE_CONFIG_ENCRYPTION_KEY).size).toBe(1);
  });
});

describe('readArchiveManifestSummary', () => {
  it('summarizes a well-formed CODA-BK1 header', () => {
    const summary = readArchiveManifestSummary(encodeArchive(validManifest));
    expect(summary).toEqual({
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: '0.0.4',
      createdAt: '2026-07-24T00:00:00.000Z',
      objectFileCount: 2,
    });
  });

  it('rejects a file without the archive magic', () => {
    expect(() => readArchiveManifestSummary(Buffer.from('not an archive at all'))).toThrow(
      /not a CODA-BK1 backup archive/u,
    );
  });

  it('rejects a truncated manifest', () => {
    const full = encodeArchive(validManifest);
    expect(() => readArchiveManifestSummary(full.subarray(0, 14))).toThrow(
      /ended before the declared manifest/u,
    );
  });

  it('rejects a manifest missing its object inventory', () => {
    const withoutInventory = {
      formatVersion: validManifest.formatVersion,
      appVersion: validManifest.appVersion,
      createdAt: validManifest.createdAt,
    };
    expect(() => readArchiveManifestSummary(encodeArchive(withoutInventory))).toThrow(
      /missing its object inventory/u,
    );
  });
});

describe('format-version assertions', () => {
  it('accepts an archive at the current version', () => {
    expect(() =>
      assertCurrentFormatVersion(readArchiveManifestSummary(encodeArchive(validManifest))),
    ).not.toThrow();
  });

  it('flags a freshly created archive that drifted off the current version', () => {
    const drifted = readArchiveManifestSummary(
      encodeArchive({ ...validManifest, formatVersion: BACKUP_FORMAT_VERSION + 1 }),
    );
    expect(() => assertCurrentFormatVersion(drifted)).toThrow(/expected the current version/u);
  });

  it('keeps versions inside the import window and rejects those outside it', () => {
    expect(() => assertImportableFormatVersion(BACKUP_IMPORT_MIN_VERSION)).not.toThrow();
    expect(() => assertImportableFormatVersion(BACKUP_FORMAT_VERSION)).not.toThrow();
    expect(() => assertImportableFormatVersion(BACKUP_FORMAT_VERSION + 1)).toThrow(/newer than/u);
    expect(() => assertImportableFormatVersion(BACKUP_IMPORT_MIN_VERSION - 1)).toThrow(
      /aged out of the import window/u,
    );
  });
});

describe('computeImportMinVersion', () => {
  it('is inert (clamps to 1) at every format version this codebase has actually shipped', () => {
    expect(BACKUP_FORMAT_VERSION).toBeLessThanOrEqual(BACKUP_IMPORT_WINDOW + 1);
    expect(BACKUP_IMPORT_MIN_VERSION).toBe(1);
    for (let version = 1; version <= BACKUP_IMPORT_WINDOW + 1; version += 1) {
      expect(computeImportMinVersion(version, BACKUP_IMPORT_WINDOW)).toBe(1);
    }
  });

  it('starts biting once a hypothetical format version exceeds window + 1', () => {
    expect(computeImportMinVersion(4, 2)).toBe(2);
    expect(computeImportMinVersion(5, 2)).toBe(3);
    expect(computeImportMinVersion(10, 2)).toBe(8);
  });
});

describe('assertFixtureIsImmediatePredecessor', () => {
  it('accepts a fixture recorded from the same-minor patch predecessor', () => {
    expect(() => assertFixtureIsImmediatePredecessor('0.0.6', '0.0.7')).not.toThrow();
    expect(() => assertFixtureIsImmediatePredecessor('1.2.3', '1.2.4')).not.toThrow();
  });

  it('rejects a fixture that has drifted away from N-1', () => {
    expect(() => assertFixtureIsImmediatePredecessor('0.0.3', '0.0.7')).toThrow(
      /N-1 fixture records appVersion 0\.0\.3.*workspace is at 0\.0\.7/su,
    );
    expect(() => assertFixtureIsImmediatePredecessor('0.0.7', '0.0.7')).toThrow(
      /N-1 fixture records appVersion/u,
    );
  });

  it('rejects malformed versions', () => {
    expect(() => assertFixtureIsImmediatePredecessor('0.0.6', 'not-a-version')).toThrow(
      /not a plain major\.minor\.patch semver/u,
    );
  });

  it('refuses to guess across a minor/major release boundary', () => {
    expect(() => assertFixtureIsImmediatePredecessor('0.9.7', '1.0.0')).toThrow(
      /crossed a minor\/major boundary/u,
    );
  });
});

describe('parseImportOutcome', () => {
  it('returns the terminal complete line with restored metadata', () => {
    const stream = [
      JSON.stringify({ event: 'progress', phase: 'restore-database' }),
      JSON.stringify({
        status: 'complete',
        appVersion: '0.0.4',
        createdAt: '2026-07-24T00:00:00Z',
      }),
    ].join('\n');
    expect(parseImportOutcome(stream)).toEqual({
      status: 'complete',
      message: undefined,
      appVersion: '0.0.4',
      createdAt: '2026-07-24T00:00:00Z',
    });
  });

  it('surfaces a terminal error line', () => {
    const stream = `${JSON.stringify({ status: 'error', message: 'signature invalid' })}\n`;
    expect(parseImportOutcome(stream)).toMatchObject({
      status: 'error',
      message: 'signature invalid',
    });
  });

  it('throws when no terminal status is present', () => {
    const stream = JSON.stringify({ event: 'progress', phase: 'restore-object' });
    expect(() => parseImportOutcome(stream)).toThrow(/no terminal status line/u);
  });
});

describe('normalizeDigest', () => {
  it('accepts a 32-hex-character md5 digest', () => {
    expect(normalizeDigest(' 0123456789abcdef0123456789abcdef \n')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
  });

  it('rejects a non-digest response', () => {
    expect(() => normalizeDigest('')).toThrow(/unexpected value/u);
    expect(() => normalizeDigest('NULL')).toThrow(/unexpected value/u);
  });
});
