import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { createBackupArchive, restoreBackupArchive } from './backup-core';
import { PgDatabaseBackupEngine } from './backup-pg';
import type { BackupProgress } from './backup-ports';
import { S3ObjectBackupStore } from './backup-s3';

/**
 * Minimal in-container invocation surface for the backup engine, used by the
 * integration round-trip. `create` streams a signed archive to stdout; `restore`
 * consumes one from stdin into an uninitialized instance. This is intentionally not
 * an HTTP endpoint: transport and UI ship separately.
 */
const usage =
  'Usage: backup-cli <create|restore> [--signing-key <path>] [--verification-key <path>]';

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const command = argv[0] ?? '';
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(usage);
    flags.set(flag, value);
  }
  return { command, flags };
}

function appVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function s3Client(config: ReturnType<typeof env>): S3Client {
  return new S3Client({
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    endpoint: config.S3_ENDPOINT,
  });
}

function reportProgress(progress: BackupProgress): void {
  const location = progress.key ? ` ${progress.key}` : '';
  const counter = progress.total ? ` (${progress.index ?? 0}/${progress.total})` : '';
  process.stderr.write(`${progress.phase}${location}${counter}\n`);
}

async function initialized(config: ReturnType<typeof env>): Promise<boolean> {
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  try {
    return (await prisma.instanceSettings.count()) > 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const config = env();
  const objects = new S3ObjectBackupStore(s3Client(config), config.S3_BUCKET);
  const database = new PgDatabaseBackupEngine({
    databaseUrl: config.DATABASE_URL,
    isInitialized: () => initialized(config),
  });
  if (command === 'create') {
    const signingKey = readFileSync(flags.get('--signing-key') ?? '');
    await createBackupArchive({
      database,
      objects,
      sink: process.stdout,
      signingKey,
      context: {
        reason: flags.get('--reason') ?? 'manual',
        appVersion: appVersion(),
        databaseName: 'coda',
        composeProject: flags.get('--project'),
      },
      onProgress: reportProgress,
    });
    return;
  }
  if (command === 'restore') {
    const verificationKey = readFileSync(flags.get('--verification-key') ?? '');
    await restoreBackupArchive({
      database,
      objects,
      source: process.stdin,
      verificationKey,
      onProgress: reportProgress,
    });
    return;
  }
  throw new Error(usage);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Backup CLI failed'}\n`);
  process.exitCode = 1;
});
