import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { seedBackupFixture } from './backup-fixture-seed';
import {
  ROUNDTRIP_OWNER_EMAIL,
  ROUNDTRIP_OWNER_PASSWORD,
  ROUNDTRIP_SETUP_TOKEN,
  bootFreshStack,
  contentDigest,
  stack,
  tearDown,
} from './backup-roundtrip-compose';
import {
  FIXTURE_ARCHIVE_PATH,
  FIXTURE_CONFIG_ENCRYPTION_KEY,
  FIXTURE_METADATA_PATH,
  type FixtureMetadata,
  readArchiveManifestSummary,
} from './backup-roundtrip-core';

/**
 * Regenerates the committed N-1 backup fixture used by the Recovery workflow's
 * compatibility-window proof.
 *
 * Run this from the release that becomes "N-1": it boots the build under test
 * (`CODA_IMAGE`), plants the shared synthetic demo data, downloads a signed
 * CODA-BK1 archive through the shipping HTTP endpoint, and writes both the archive
 * and a metadata sidecar (config key, expected content digest, app/format version).
 * The next release's Recovery gate restores this archive into the then-current build
 * to prove the N/N-1 window holds. See tests/fixtures/backups/README.md for the full
 * fixture strategy and regeneration procedure.
 *
 * Usage: CODA_IMAGE=<image> pnpm tsx scripts/ops/generate-backup-fixture.ts
 */

async function main(): Promise<void> {
  const source = stack('coda-backup-fixture-gen', 53_031, 59_031, FIXTURE_CONFIG_ENCRYPTION_KEY);
  let archive: Buffer;
  let digest: string;
  try {
    await bootFreshStack(source);
    const auth = await seedBackupFixture({
      appUrl: source.appUrl,
      setupToken: ROUNDTRIP_SETUP_TOKEN,
      ownerEmail: ROUNDTRIP_OWNER_EMAIL,
      ownerPassword: ROUNDTRIP_OWNER_PASSWORD,
    });
    const response = await fetch(`${source.appUrl}/api/v1/instance/backups/download`, {
      headers: { cookie: auth.cookies, 'x-coda-csrf': auth.csrf },
    });
    if (!response.ok) {
      throw new Error(`Backup download returned HTTP ${response.status}: ${await response.text()}`);
    }
    archive = Buffer.from(await response.arrayBuffer());
    digest = contentDigest(source);
  } finally {
    tearDown(source);
  }

  const summary = readArchiveManifestSummary(archive);
  const metadata: FixtureMetadata = {
    description:
      'Synthetic N-1 in-app backup fixture. Regenerate with ' +
      'scripts/ops/generate-backup-fixture.ts from the release that becomes N-1. ' +
      'Contains only demo data and obvious non-secret credentials.',
    formatVersion: summary.formatVersion,
    appVersion: summary.appVersion,
    configEncryptionKey: FIXTURE_CONFIG_ENCRYPTION_KEY,
    contentDigest: digest,
    objectFileCount: summary.objectFileCount,
  };

  const archivePath = resolve(FIXTURE_ARCHIVE_PATH);
  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, archive);
  writeFileSync(resolve(FIXTURE_METADATA_PATH), `${JSON.stringify(metadata, null, 2)}\n`);

  process.stdout.write(
    `Wrote ${FIXTURE_ARCHIVE_PATH} (format v${summary.formatVersion}, app ${summary.appVersion}, ` +
      `${summary.objectFileCount} object(s), digest ${digest}).\n`,
  );
}

void main();
