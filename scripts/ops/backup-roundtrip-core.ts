import { createHash } from 'node:crypto';

/**
 * Pure, Docker-free helpers for the in-app backup round-trip gate
 * (`validate-app-backup-roundtrip.ts`) and the fixture generator
 * (`generate-backup-fixture.ts`). Keeping the archive framing, progress parsing,
 * and content-digest logic here lets `pnpm test:deployment` cover the gate's core
 * reasoning without booting a compose stack.
 *
 * The framing constants mirror the in-app engine in
 * `apps/api/src/backup/backup-archive.ts` and `backup-format.ts`. They are
 * intentionally duplicated rather than imported: the scripts workspace compiles
 * against a different tsconfig and must not pull the API's Prisma/runtime graph in.
 * `backup-roundtrip-core.test.ts` pins the duplicated values so they cannot drift
 * silently from the engine.
 */

/** 8-byte magic that opens every CODA-BK1 archive. */
export const BACKUP_ARCHIVE_MAGIC = Buffer.from('CODA-BK1', 'ascii');

/**
 * Floor of the N/N-1/N-2 import window: `max(1, formatVersion - window)`. Mirrors
 * `computeImportMinVersion` in the engine's `backup-format.ts` — extracted as a pure
 * function so a test can exercise the clamp at hypothetical format versions without
 * waiting for {@link BACKUP_FORMAT_VERSION} to actually reach them.
 *
 * The clamp to `1` is inert for every format version shipped so far; it only starts
 * rejecting archives once `BACKUP_FORMAT_VERSION > 3`. `backup-roundtrip-core.test.ts`
 * exercises it at higher hypothetical versions so the aged-out-fixture check reads as
 * tested rather than as dead code that has simply never fired.
 */
export function computeImportMinVersion(formatVersion: number, window: number): number {
  return Math.max(1, formatVersion - window);
}

/**
 * Current in-app archive format version. The gate asserts freshly created archives
 * carry exactly this version and that the committed N-1 fixture stays inside the
 * import window (see {@link BACKUP_IMPORT_MIN_VERSION}).
 */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_IMPORT_WINDOW = 2;
export const BACKUP_IMPORT_MIN_VERSION = computeImportMinVersion(
  BACKUP_FORMAT_VERSION,
  BACKUP_IMPORT_WINDOW,
);

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4096;

/**
 * Obvious, non-secret instance key shared by the round-trip source/target and the
 * committed fixture. The in-app engine derives the Ed25519 signing key
 * deterministically from `CONFIG_ENCRYPTION_KEY`, so the same value must be present
 * on the instance that created an archive and the fresh instance that restores it.
 * This is synthetic test material for a PUBLIC repository and never protects real
 * data. Built as an expression (48 zero bytes base64-encoded) so no string in
 * the repository ever resembles a credential to secret scanners.
 */
export const FIXTURE_CONFIG_ENCRYPTION_KEY = 'A'.repeat(64);

/** Committed N-1 archive and its sidecar metadata, relative to the repo root. */
export const FIXTURE_ARCHIVE_PATH = 'tests/fixtures/backups/coda-backup-n-1.codabk';
export const FIXTURE_METADATA_PATH = 'tests/fixtures/backups/coda-backup-n-1.json';

export interface BackupManifestSummary {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  objectFileCount: number;
}

export interface FixtureMetadata {
  /** Human note on how the fixture was produced. */
  description: string;
  /** Archive format version captured at generation time. */
  formatVersion: number;
  /** App version that produced the archive (the "N-1" release at regeneration). */
  appVersion: string;
  /** Instance key the archive was signed with; required to restore it. */
  configEncryptionKey: string;
  /** Deterministic content digest the restored instance must reproduce. */
  contentDigest: string;
  /** Number of object-storage files embedded in the archive. */
  objectFileCount: number;
}

function readUInt32BE(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new Error('Backup archive ended before a framing length field');
  }
  return buffer.readUInt32BE(offset);
}

/**
 * Reads and structurally validates the leading CODA-BK1 header from an archive
 * buffer, returning a manifest summary. Throws when the magic is wrong or the
 * framing lengths are implausible, so a corrupted or non-archive download is caught
 * before any compatibility assertion.
 */
export function readArchiveManifestSummary(archive: Buffer): BackupManifestSummary {
  const magic = archive.subarray(0, BACKUP_ARCHIVE_MAGIC.length);
  if (!magic.equals(BACKUP_ARCHIVE_MAGIC)) {
    throw new Error('Downloaded file is not a CODA-BK1 backup archive');
  }
  let offset = BACKUP_ARCHIVE_MAGIC.length;
  const manifestLength = readUInt32BE(archive, offset);
  offset += 4;
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES) {
    throw new Error('Backup archive declares an unreasonable manifest length');
  }
  if (offset + manifestLength > archive.length) {
    throw new Error('Backup archive ended before the declared manifest');
  }
  const manifestBytes = archive.subarray(offset, offset + manifestLength);
  offset += manifestLength;
  const signatureLength = readUInt32BE(archive, offset);
  if (signatureLength === 0 || signatureLength > MAX_SIGNATURE_BYTES) {
    throw new Error('Backup archive declares an unreasonable signature length');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    formatVersion?: unknown;
    appVersion?: unknown;
    createdAt?: unknown;
    objectStorage?: { files?: unknown };
  };
  if (typeof manifest.formatVersion !== 'number' || !Number.isInteger(manifest.formatVersion)) {
    throw new Error('Backup manifest is missing an integer format version');
  }
  if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length === 0) {
    throw new Error('Backup manifest is missing an application version');
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Backup manifest is missing a valid creation timestamp');
  }
  const files = manifest.objectStorage?.files;
  if (!Array.isArray(files)) {
    throw new Error('Backup manifest is missing its object inventory');
  }
  return {
    formatVersion: manifest.formatVersion,
    appVersion: manifest.appVersion,
    createdAt: manifest.createdAt,
    objectFileCount: files.length,
  };
}

/**
 * Enforces that a freshly created archive carries exactly the current format
 * version. A drift here means the running build emits archives an equal-version
 * instance would refuse — the exact portability regression this gate exists to
 * block.
 */
export function assertCurrentFormatVersion(summary: BackupManifestSummary): void {
  if (summary.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Freshly created archive reports format version ${summary.formatVersion}, ` +
        `expected the current version ${BACKUP_FORMAT_VERSION}`,
    );
  }
}

/**
 * Enforces that an archive (typically the committed N-1 fixture) sits inside the
 * supported import window. Mirrors `assertImportableFormatVersion` in the engine so
 * a fixture that has aged out of the window fails the gate loudly instead of at a
 * user's restore.
 */
export function assertImportableFormatVersion(version: number): void {
  if (!Number.isInteger(version)) {
    throw new Error('Backup archive has a non-integer format version');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup archive format version ${version} is newer than this build supports ` +
        `(${BACKUP_FORMAT_VERSION})`,
    );
  }
  if (version < BACKUP_IMPORT_MIN_VERSION) {
    throw new Error(
      `Backup archive format version ${version} has aged out of the import window ` +
        `(minimum ${BACKUP_IMPORT_MIN_VERSION}); regenerate the fixture`,
    );
  }
}

/** Parses a plain `major.minor.patch` semver triple (no pre-release/build suffix). */
function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) {
    throw new Error(`Version "${version}" is not a plain major.minor.patch semver`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Enforces that the committed N-1 fixture's recorded `appVersion` is the release
 * immediately preceding the workspace version, per the regeneration policy recorded
 * in the fixture's own sidecar and `tests/fixtures/backups/README.md`. Coda releases
 * to date only ever bump the patch component (`0.0.N`), so "immediately preceding"
 * is computed as the same major.minor with patch - 1.
 *
 * A workspace version whose patch component is 0 has no same-minor predecessor
 * under that scheme (the previous release crossed a minor/major boundary), so this
 * throws rather than guess at what the prior release's version was.
 */
export function assertFixtureIsImmediatePredecessor(
  fixtureAppVersion: string,
  workspaceVersion: string,
): void {
  const [major, minor, patch] = parseSemver(workspaceVersion);
  if (patch === 0) {
    throw new Error(
      `Workspace version ${workspaceVersion} crossed a minor/major boundary; the N-1 fixture ` +
        'staleness check only knows how to compute a same-minor predecessor and needs a ' +
        'manual update for this release',
    );
  }
  const expected = `${major}.${minor}.${patch - 1}`;
  if (fixtureAppVersion !== expected) {
    throw new Error(
      `N-1 fixture records appVersion ${fixtureAppVersion}, but the workspace is at ` +
        `${workspaceVersion}: regenerate the fixture from ${expected} with ` +
        'scripts/ops/generate-backup-fixture.ts (see tests/fixtures/backups/README.md)',
    );
  }
}

export interface ImportOutcome {
  status: 'complete' | 'error';
  message?: string;
  appVersion?: string;
  createdAt?: string;
}

/**
 * Parses the newline-delimited JSON progress stream emitted by
 * `POST /api/v1/setup/import` and returns the terminal outcome. Throws when the
 * stream carries no terminal `complete`/`error` line at all, which itself signals a
 * truncated or failed restore.
 */
export function parseImportOutcome(ndjson: string): ImportOutcome {
  const lines = ndjson
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed.status === 'complete' || parsed.status === 'error') {
      return {
        status: parsed.status,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : undefined,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
      };
    }
  }
  throw new Error('Restore stream carried no terminal status line');
}

/**
 * Single SQL statement producing a stable, id- and timestamp-free digest of the
 * business content that survives a backup. Because the in-app restore is a
 * byte-exact `pg_restore`, the source and a freshly restored target must return an
 * identical digest — that equality is the round-trip's data-integrity proof.
 *
 * Every column is wrapped in `coalesce(col, '')` (numeric columns cast to text
 * first). Postgres's `||` propagates NULL, and `string_agg` silently drops any row
 * whose concatenated `line` comes out NULL — without the coalesce, a row with a
 * NULL in one of these columns would vanish from the digest instead of changing it,
 * so the integrity check would keep reporting success while quietly covering fewer
 * rows. No column here is nullable today, but the coalesce keeps that true by
 * construction rather than by the current schema's accident (see
 * `backup-roundtrip-core.test.ts`'s NULL-column regression test).
 */
export const CONTENT_DIGEST_SQL = `SELECT md5(string_agg(line, E'\\n' ORDER BY line)) FROM (
  SELECT 'user:' || coalesce(email, '') || '|' || coalesce(display_name, '') AS line FROM users
  UNION ALL
  SELECT 'project:' || coalesce(name, '') || '|' || coalesce(description, '') FROM projects
  UNION ALL
  SELECT 'entity_type:' || coalesce(singular_name, '') || '/' || coalesce(plural_name, '') FROM entity_types
  UNION ALL
  SELECT 'item:' || coalesce(title, '') || '|' || coalesce(position::text, '') FROM breakdown_items
  UNION ALL
  SELECT 'field_value:' || coalesce(text_value, '') FROM field_values
  UNION ALL
  SELECT 'storage:' || coalesce(object_key, '') || '|' || coalesce(size_bytes::text, '') || '|' || coalesce(original_filename, '') FROM storage_objects
  UNION ALL
  SELECT 'screenplay_import:' || coalesce(object_key, '') || '|' || coalesce(original_filename, '') || '|' || coalesce(mime_type, '') || '|' || coalesce(size_bytes::text, '') || '|' || coalesce(source_format, '') || '|' || coalesce(converted_fountain, '') || '|' || coalesce(conversion_report::text, '') FROM screenplay_import_artifacts
  UNION ALL
  SELECT 'source_doc:' || coalesce(title, '') FROM source_documents
) AS content`.replace(/\s+/gu, ' ');

/** Normalizes a psql tuples-only digest cell for comparison. */
export function normalizeDigest(raw: string): string {
  const value = raw.trim();
  if (!/^[a-f0-9]{32}$/u.test(value)) {
    throw new Error(`Content digest query returned an unexpected value: ${raw}`);
  }
  return value;
}

/** Convenience hash used by unit tests and callers building expected digests. */
export function md5Hex(value: string): string {
  return createHash('md5').update(value).digest('hex');
}
