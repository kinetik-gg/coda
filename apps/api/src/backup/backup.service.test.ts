import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';
import type { DatabaseBackupEngine, ObjectBackupStore } from './backup-ports';
import { BufferSink, FakeDatabase, FakeObjectStore, ed25519KeyPair } from './backup-core.test';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://coda:pw@localhost:5432/coda?schema=public';
  process.env.S3_ENDPOINT = 'http://localhost:9000';
  process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
  process.env.S3_BUCKET = 'screenplays';
  process.env.S3_ACCESS_KEY = 'access';
  process.env.S3_SECRET_KEY = 'secretsecret';
});

function fakePrisma(ownerCount: number): {
  prisma: PrismaService;
  count: ReturnType<typeof vi.fn>;
} {
  const count = vi.fn().mockResolvedValue(ownerCount);
  return { prisma: { instanceSettings: { count } } as unknown as PrismaService, count };
}

describe('BackupService', () => {
  it('creates and restores through injected adapters', async () => {
    const keys = ed25519KeyPair();
    const source = new FakeObjectStore();
    source.data.set('project/a.pdf', Buffer.from('pdf'));
    const sink = new BufferSink();
    const creator = new BackupService(fakePrisma(0).prisma, {
      database: new FakeDatabase(Buffer.from('dump-bytes')),
      objects: source,
    });
    const manifest = await creator.create({
      sink,
      signingKey: keys.privateKey,
      reason: 'manual',
      appVersion: '0.0.4',
    });
    expect(manifest.creationContext.databaseName).toBe('coda');

    const targetDb = new FakeDatabase();
    const targetObjects = new FakeObjectStore();
    const restorer = new BackupService(fakePrisma(0).prisma, {
      database: targetDb,
      objects: targetObjects,
    });
    await restorer.restore({
      source: Readable.from([sink.bytes()]),
      verificationKey: keys.publicKey,
    });
    expect(targetDb.restored).toEqual(Buffer.from('dump-bytes'));
    expect(targetObjects.data.get('project/a.pdf')).toEqual(Buffer.from('pdf'));
  });

  it('builds a PostgreSQL-backed owner check by default', async () => {
    const { prisma, count } = fakePrisma(1);
    const service = new BackupService(prisma);
    const database = (service as unknown as { database(): DatabaseBackupEngine }).database();
    expect(await database.isInitialized()).toBe(true);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('builds an S3-backed object store by default', () => {
    const service = new BackupService(fakePrisma(0).prisma);
    const objects = (service as unknown as { objects(): ObjectBackupStore }).objects();
    expect(objects.bucket()).toBe('screenplays');
  });
});
