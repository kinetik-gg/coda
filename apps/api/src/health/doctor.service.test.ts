import type * as NodeFs from 'node:fs';
import { readdirSync, type Dirent } from 'node:fs';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { DoctorService } from './doctor.service';

const FAKE_SECRET_KEY = 'super-secret-s3-key-do-not-leak';
const FAKE_ENCRYPTION_KEY = 'topsecretconfigencryptionkeymaterial==';
const FAKE_DATABASE_URL = 'postgresql://coda:hunter2-db-password@db.internal:5432/coda';
const FAKE_ERROR_SECRET = 'postgres://user:s3cr3t-in-error@host/db';

vi.mock('../config/env', () => ({ env: vi.fn() }));
vi.mock('../updates/running-version', () => ({ runningVersion: vi.fn(() => '1.2.3') }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, readdirSync: vi.fn() };
});

const mockedEnv = vi.mocked(env);
const mockedReaddirSync = vi.mocked(readdirSync);

function fakeDirent(name: string): Dirent {
  return { name, isDirectory: () => true } as unknown as Dirent;
}

function baseEnv() {
  return {
    APP_ORIGIN: 'https://coda.example.test',
    TRUSTED_PROXY_CIDRS: ['127.0.0.1/32', '10.0.0.0/8'],
    // Present to prove the doctor never reads or leaks these, even though a
    // real env() call would return them.
    S3_SECRET_KEY: FAKE_SECRET_KEY,
    CONFIG_ENCRYPTION_KEY: FAKE_ENCRYPTION_KEY,
    DATABASE_URL: FAKE_DATABASE_URL,
  };
}

function ownerPrisma(overrides: Record<string, unknown> = {}) {
  return {
    instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join('');
      if (text.includes('_prisma_migrations')) {
        return Promise.resolve([{ migration_name: '20240101000000_init' }]);
      }
      return Promise.resolve([{ '?column?': 1 }]);
    }),
    user: { count: vi.fn().mockResolvedValue(3) },
    project: { count: vi.fn().mockResolvedValue(2) },
    storageObject: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 5_000_000n } }),
    },
    ...overrides,
  };
}

function storageOk() {
  return { ready: vi.fn().mockResolvedValue(undefined) };
}

function releaseCheckerCurrent() {
  return {
    status: vi.fn().mockResolvedValue({
      current: '1.2.3',
      latest: '1.2.3',
      updateAvailable: false,
      comparison: 'current',
      notesUrl: null,
      lastCheckedAt: null,
      lastSucceededAt: null,
      lastError: null,
    }),
  };
}

function service(
  prisma: object,
  storage: object = storageOk(),
  releaseChecker: object = releaseCheckerCurrent(),
  schedulerHealth?: object,
) {
  return new DoctorService(
    prisma as never,
    storage as never,
    releaseChecker as never,
    schedulerHealth as never,
  );
}

function rowById<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`Missing row ${id}`);
  return row;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('DoctorService owner gating', () => {
  it('rejects non-owners', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    const prisma = ownerPrisma();
    await expect(service(prisma).report('someone-else')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when instance setup is incomplete', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    const prisma = ownerPrisma({
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(service(prisma).report('owner')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DoctorService healthy report', () => {
  it('aggregates every row as healthy and includes them in the report text', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([fakeDirent('20240101000000_init')] as never);
    const prisma = ownerPrisma();

    const report = await service(prisma).report('owner');

    expect(report.instanceOrigin).toBe('https://coda.example.test');
    expect(rowById(report.rows, 'app.version')).toMatchObject({ status: 'ok', value: '1.2.3' });
    expect(rowById(report.rows, 'app.updateAvailable')).toMatchObject({
      status: 'ok',
      value: 'Up to date',
    });
    expect(rowById(report.rows, 'database.reachability')).toMatchObject({ status: 'ok' });
    expect(rowById(report.rows, 'storage.backend')).toMatchObject({ status: 'ok' });
    expect(rowById(report.rows, 'network.trustedProxies')).toMatchObject({
      status: 'ok',
      value: '127.0.0.1/32, 10.0.0.0/8',
    });
    expect(rowById(report.rows, 'backup.last')).toMatchObject({
      status: 'unknown',
      value: 'Not available',
    });
    expect(rowById(report.rows, 'scheduler.health')).toMatchObject({
      status: 'unknown',
      value: 'Not available',
    });
    expect(rowById(report.rows, 'database.migrations')).toMatchObject({
      status: 'ok',
      value: 'None pending',
    });
    expect(rowById(report.rows, 'instance.users')).toMatchObject({ status: 'ok', value: '3' });
    expect(rowById(report.rows, 'instance.projects')).toMatchObject({ status: 'ok', value: '2' });
    expect(rowById(report.rows, 'instance.storageBytes')).toMatchObject({
      status: 'ok',
      value: '5.0 MB',
    });
    for (const row of report.rows) {
      expect(report.reportText).toContain(row.label);
    }
    expect(report.reportText).toContain('Coda instance diagnostic report');
    expect(report.reportText).toContain(report.instanceOrigin);
  });

  it('reports zero-byte storage usage when nothing has been uploaded', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma({
      storageObject: { aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: null } }) },
    });

    const report = await service(prisma).report('owner');

    expect(rowById(report.rows, 'instance.storageBytes').value).toBe('0 B');
  });
});

describe('DoctorService degraded subsystems', () => {
  it('flags an unreachable database without throwing', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma({
      $queryRaw: vi.fn().mockRejectedValue(new Error(FAKE_ERROR_SECRET)),
    });

    const report = await service(prisma).report('owner');

    const dbRow = rowById(report.rows, 'database.reachability');
    expect(dbRow.status).toBe('error');
    expect(dbRow.hint).toBeTruthy();
    // Pending-migrations also uses $queryRaw and must degrade independently.
    expect(rowById(report.rows, 'database.migrations').status).toBe('unknown');
    expect(report.reportText).not.toContain(FAKE_ERROR_SECRET);
    expect(report.reportText).not.toContain('s3cr3t');
  });

  it('flags an unreachable storage backend without throwing', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();
    const storage = { ready: vi.fn().mockRejectedValue(new Error(FAKE_ERROR_SECRET)) };

    const report = await service(prisma, storage).report('owner');

    const storageRow = rowById(report.rows, 'storage.backend');
    expect(storageRow.status).toBe('error');
    expect(report.reportText).not.toContain(FAKE_ERROR_SECRET);
  });

  it('reports an unchecked update state distinctly from up-to-date', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();
    const releaseChecker = {
      status: vi.fn().mockResolvedValue({
        current: '1.2.3',
        latest: null,
        updateAvailable: false,
        comparison: 'unknown',
        notesUrl: null,
        lastCheckedAt: null,
        lastSucceededAt: null,
        lastError: `leaked secret ${FAKE_ERROR_SECRET}`,
      }),
    };

    const report = await service(prisma, storageOk(), releaseChecker).report('owner');

    const updateRow = rowById(report.rows, 'app.updateAvailable');
    expect(updateRow.status).toBe('unknown');
    // lastError is never surfaced: the release checker's raw failure text must
    // never appear in the sanitized report.
    expect(report.reportText).not.toContain(FAKE_ERROR_SECRET);
  });

  it('surfaces an available update with the target version', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();
    const releaseChecker = {
      status: vi.fn().mockResolvedValue({
        current: '1.2.3',
        latest: '1.3.0',
        updateAvailable: true,
        comparison: 'behind',
        notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
        lastCheckedAt: null,
        lastSucceededAt: null,
        lastError: null,
      }),
    };

    const report = await service(prisma, storageOk(), releaseChecker).report('owner');

    const updateRow = rowById(report.rows, 'app.updateAvailable');
    expect(updateRow.status).toBe('warn');
    expect(updateRow.value).toContain('1.3.0');
  });

  it('reports pending migrations found on disk but not yet applied', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([
      fakeDirent('20240101000000_init'),
      fakeDirent('20240202000000_add_index'),
    ] as never);
    const prisma = ownerPrisma();

    const report = await service(prisma).report('owner');

    const migrationsRow = rowById(report.rows, 'database.migrations');
    expect(migrationsRow.status).toBe('warn');
    expect(migrationsRow.value).toBe('1 pending');
  });

  it('reports trusted-proxy configuration as none when the set is empty', async () => {
    mockedEnv.mockReturnValue({ ...baseEnv(), TRUSTED_PROXY_CIDRS: [] } as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();

    const report = await service(prisma).report('owner');

    const proxiesRow = rowById(report.rows, 'network.trustedProxies');
    expect(proxiesRow.value).toBe('None configured');
    expect(proxiesRow.hint).toBeTruthy();
  });

  it('reports scheduler health from an injected provider once one is registered', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();
    const schedulerHealth = {
      status: vi.fn().mockResolvedValue({
        status: 'ok' as const,
        value: 'Last run 3m ago',
        hint: null,
      }),
    };

    const report = await service(
      prisma,
      storageOk(),
      releaseCheckerCurrent(),
      schedulerHealth,
    ).report('owner');

    expect(rowById(report.rows, 'scheduler.health')).toMatchObject({
      status: 'ok',
      value: 'Last run 3m ago',
    });
  });
});

describe('DoctorService sanitized report — negative assertions', () => {
  it('never includes storage secrets, encryption keys, or database credentials', async () => {
    mockedEnv.mockReturnValue(baseEnv() as never);
    mockedReaddirSync.mockReturnValue([] as never);
    const prisma = ownerPrisma();

    const report = await service(prisma).report('owner');

    expect(report.reportText).not.toContain(FAKE_SECRET_KEY);
    expect(report.reportText).not.toContain(FAKE_ENCRYPTION_KEY);
    expect(report.reportText).not.toContain(FAKE_DATABASE_URL);
    expect(report.reportText).not.toMatch(/hunter2/i);
    expect(JSON.stringify(report.rows)).not.toContain(FAKE_SECRET_KEY);
    expect(JSON.stringify(report.rows)).not.toContain(FAKE_ENCRYPTION_KEY);
    expect(JSON.stringify(report.rows)).not.toContain(FAKE_DATABASE_URL);
  });
});
