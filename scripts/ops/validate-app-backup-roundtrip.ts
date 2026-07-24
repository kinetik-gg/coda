import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedBackupFixture } from './backup-fixture-seed';
import {
  ROUNDTRIP_OWNER_EMAIL,
  ROUNDTRIP_OWNER_PASSWORD,
  ROUNDTRIP_SETUP_TOKEN,
  type Stack,
  bootFreshStack,
  bootUninitializedStack,
  contentDigest,
  stack,
  tearDown,
} from './backup-roundtrip-compose';
import {
  FIXTURE_ARCHIVE_PATH,
  FIXTURE_CONFIG_ENCRYPTION_KEY,
  FIXTURE_METADATA_PATH,
  type FixtureMetadata,
  assertCurrentFormatVersion,
  assertImportableFormatVersion,
  parseImportOutcome,
  readArchiveManifestSummary,
} from './backup-roundtrip-core';

/**
 * In-app backup round-trip gate for the Recovery workflow.
 *
 * Every run this exercises the shipping CODA-BK1 backup format end to end on the
 * build under test:
 *
 *  1. Boot a source instance, seed synthetic demo data, and download a signed
 *     archive through `GET /api/v1/instance/backups/download`.
 *  2. Restore that archive into a *fresh same-version* instance through
 *     `POST /api/v1/setup/import`, then prove the restored business-content digest
 *     is byte-for-byte identical to the source.
 *  3. Restore the committed N-1 fixture archive
 *     (`tests/fixtures/backups/coda-backup-n-1.codabk`) into another fresh instance
 *     to prove the N/N-1 compatibility window still holds.
 *
 * The source and target share {@link FIXTURE_CONFIG_ENCRYPTION_KEY} so the engine's
 * deterministic Ed25519 signing key matches across instances — the same operator
 * requirement (carry `CONFIG_ENCRYPTION_KEY` to the new deployment) that makes a
 * real restore work. All credentials here are synthetic test material.
 *
 * Requires `CODA_IMAGE` to name the build under test. Docker Compose is used for the
 * bundled full-stack topology (compose.yaml + compose.local.yaml).
 */

async function downloadArchive(target: Stack): Promise<Buffer> {
  const auth = await seedBackupFixture({
    appUrl: target.appUrl,
    setupToken: ROUNDTRIP_SETUP_TOKEN,
    ownerEmail: ROUNDTRIP_OWNER_EMAIL,
    ownerPassword: ROUNDTRIP_OWNER_PASSWORD,
  });
  const response = await fetch(`${target.appUrl}/api/v1/instance/backups/download`, {
    headers: { cookie: auth.cookies, 'x-coda-csrf': auth.csrf },
  });
  if (!response.ok) {
    throw new Error(`Backup download returned HTTP ${response.status}: ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function restoreArchive(target: Stack, archive: Buffer): Promise<void> {
  const response = await fetch(`${target.appUrl}/api/v1/setup/import`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-coda-setup-token': ROUNDTRIP_SETUP_TOKEN,
    },
    body: new Uint8Array(archive),
  });
  const outcome = parseImportOutcome(await response.text());
  if (outcome.status !== 'complete') {
    throw new Error(`Restore did not complete: ${outcome.message ?? 'unknown error'}`);
  }
  const status = await fetch(`${target.appUrl}/api/v1/setup/status`);
  const body = (await status.json()) as { data?: { initialized?: boolean } };
  if (!status.ok || body.data?.initialized !== true) {
    throw new Error('Restored instance did not report itself initialized');
  }
}

async function roundTripCurrentBuild(): Promise<void> {
  const source = stack('coda-roundtrip-source', 53_021, 59_021, FIXTURE_CONFIG_ENCRYPTION_KEY);
  const target = stack('coda-roundtrip-target', 53_022, 59_022, FIXTURE_CONFIG_ENCRYPTION_KEY);
  let archive: Buffer;
  let sourceDigest: string;
  try {
    await bootFreshStack(source);
    archive = await downloadArchive(source);
    sourceDigest = contentDigest(source);
    const summary = readArchiveManifestSummary(archive);
    assertCurrentFormatVersion(summary);
    if (summary.objectFileCount < 1) {
      throw new Error(
        'Source archive captured no object-storage files; upload round-trip untested',
      );
    }
    process.stdout.write(
      `Created CODA-BK1 archive (format v${summary.formatVersion}, app ${summary.appVersion}, ` +
        `${summary.objectFileCount} object(s)); source content digest ${sourceDigest}.\n`,
    );
  } finally {
    tearDown(source);
  }

  try {
    await bootUninitializedStack(target);
    await restoreArchive(target, archive);
    const restoredDigest = contentDigest(target);
    if (restoredDigest !== sourceDigest) {
      throw new Error(
        `Restored content digest ${restoredDigest} does not equal source digest ${sourceDigest}`,
      );
    }
    process.stdout.write(
      `Same-version restore reproduced the source content digest exactly (${restoredDigest}).\n`,
    );
  } finally {
    tearDown(target);
  }
}

async function restoreCompatibilityFixture(): Promise<void> {
  const metadata = JSON.parse(
    readFileSync(resolve(FIXTURE_METADATA_PATH), 'utf8'),
  ) as FixtureMetadata;
  const archive = readFileSync(resolve(FIXTURE_ARCHIVE_PATH));
  const summary = readArchiveManifestSummary(archive);
  assertImportableFormatVersion(summary.formatVersion);
  const target = stack('coda-roundtrip-fixture', 53_023, 59_023, metadata.configEncryptionKey);
  try {
    await bootUninitializedStack(target);
    await restoreArchive(target, archive);
    const restoredDigest = contentDigest(target);
    if (restoredDigest !== metadata.contentDigest) {
      throw new Error(
        `N-1 fixture restored to digest ${restoredDigest}, expected ${metadata.contentDigest}`,
      );
    }
    process.stdout.write(
      `N-1 fixture (format v${summary.formatVersion}, app ${metadata.appVersion}) restored into ` +
        `the current build and reproduced its recorded digest (${restoredDigest}).\n`,
    );
  } finally {
    tearDown(target);
  }
}

async function main(): Promise<void> {
  await roundTripCurrentBuild();
  await restoreCompatibilityFixture();
  process.stdout.write('In-app backup round-trip and N-1 compatibility gate passed.\n');
}

void main();
