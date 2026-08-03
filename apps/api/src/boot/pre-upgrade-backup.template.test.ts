import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { PRE_UPGRADE_BACKUP_PREFIX } from '../backup/backup-archive-store';
import { PreUpgradeBackupKeyMissingError } from './pre-upgrade-backup';
import {
  createPreUpgradeBackupStep,
  type PreUpgradeBackupConfig,
  type PreUpgradeRuntimeSeams,
} from './pre-upgrade-backup.runtime';

/**
 * Issue #268: the code exempted deployments without `CONFIG_ENCRYPTION_KEY` from the pre-upgrade
 * safety backup on the stated grounds that "new template installs always generate the key", and
 * every shipped template left it commented out — so the exemption was the default path for new
 * installs, and nothing failed. These tests read the shipped templates and drive the real boot
 * wiring with what they produce, so that claim can never silently become false again.
 */

const repositoryRoot = resolve(__dirname, '../../../..');

/** Every environment template an operator is documented to copy for a self-hosted install. */
const TEMPLATES = [
  '.env.example',
  'deploy/coda.app.env.example',
  'deploy/coolify/app.env.example',
  'deploy/coolify/full.env.example',
] as const;

/** Parse assigned (non-commented) values exactly as an `--env-file` consumer would. */
function readTemplate(relativePath: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of readFileSync(resolve(repositoryRoot, relativePath), 'utf8').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0 || line.trimStart().startsWith('#')) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1));
  }
  return values;
}

/**
 * Build the boot configuration an operator gets from a template after following its instructions:
 * every placeholder replaced, including generating the key the comment tells them to generate.
 */
function configFromTemplate(relativePath: string): PreUpgradeBackupConfig {
  const template = readTemplate(relativePath);
  const generatedKey = Buffer.alloc(32, 9).toString('base64');
  const optOut = template.get('PRE_UPGRADE_BACKUP') ?? 'on';
  return {
    DATABASE_URL: 'postgresql://coda:pw@localhost:5432/coda?schema=public',
    CONFIG_ENCRYPTION_KEY: template.has('CONFIG_ENCRYPTION_KEY') ? generatedKey : undefined,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: template.get('S3_REGION') ?? 'us-east-1',
    S3_BUCKET: 'screenplays',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secretsecret',
    S3_FORCE_PATH_STYLE: (template.get('S3_FORCE_PATH_STYLE') ?? 'false') === 'true',
    PRE_UPGRADE_BACKUP: optOut === 'off' ? 'off' : 'on',
    PRE_UPGRADE_BACKUP_KEEP: Number(template.get('PRE_UPGRADE_BACKUP_KEEP') ?? '3'),
  };
}

class RecordingS3 {
  puts: string[] = [];

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      for await (const _chunk of command.input.Body as AsyncIterable<Buffer>) void _chunk;
      this.puts.push(command.input.Key ?? '');
      return {};
    }
    return { Contents: [] };
  }
}

/** An existing, initialized instance carrying one committed-but-unapplied migration. */
function upgradeSeams(): { seams: PreUpgradeRuntimeSeams; s3: RecordingS3 } {
  const s3 = new RecordingS3();
  return {
    s3,
    seams: {
      openPrisma: () => ({
        ownerCount: () => Promise.resolve(1),
        appliedMigrations: () => Promise.resolve([{ migration_name: 'a' }]),
        disconnect: () => Promise.resolve(),
      }),
      openS3: () => s3 as unknown as S3Client,
      runBackup: vi.fn(async (input: { sink: Writable }) => {
        await new Promise<void>((done, fail) =>
          input.sink.write(Buffer.from('archive'), (error) => (error ? fail(error) : done())),
        );
        return {} as never;
      }) as unknown as PreUpgradeRuntimeSeams['runBackup'],
      localMigrations: () => ['a', 'b'],
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    },
  };
}

describe('shipped environment templates', () => {
  it.each(TEMPLATES)('%s assigns CONFIG_ENCRYPTION_KEY rather than commenting it out', (path) => {
    expect(readTemplate(path).has('CONFIG_ENCRYPTION_KEY')).toBe(true);
  });

  it.each(TEMPLATES)('%s never ships the safety backup opted out', (path) => {
    expect(readTemplate(path).get('PRE_UPGRADE_BACKUP') ?? 'on').toBe('on');
  });
});

describe('a template-derived environment upgrading with pending migrations', () => {
  it.each(TEMPLATES)('%s produces a signed pre-upgrade safety backup', async (path) => {
    const built = upgradeSeams();
    await createPreUpgradeBackupStep(configFromTemplate(path), '/app/apps/api', built.seams)();
    expect(built.s3.puts).toHaveLength(1);
    expect(built.s3.puts[0]).toContain(PRE_UPGRADE_BACKUP_PREFIX);
  });

  it('refuses to migrate when a legacy deployment predating the key upgrades', async () => {
    const built = upgradeSeams();
    const step = createPreUpgradeBackupStep(
      { ...configFromTemplate('.env.example'), CONFIG_ENCRYPTION_KEY: undefined },
      '/app/apps/api',
      built.seams,
    );
    await expect(step()).rejects.toBeInstanceOf(PreUpgradeBackupKeyMissingError);
    expect(built.s3.puts).toHaveLength(0);
  });
});
