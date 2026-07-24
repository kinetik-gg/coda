import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductionDatabaseReadinessDeps } from './database-readiness.runtime';

const { queryRaw, disconnect, tcpProbeMock, runMigrationsMock } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  disconnect: vi.fn(),
  tcpProbeMock: vi.fn(),
  runMigrationsMock: vi.fn(),
}));
const listenDiagnosticServerMock = vi.hoisted(() => vi.fn());
const closeDiagnosticServerMock = vi.hoisted(() => vi.fn());
const createDiagnosticServerMock = vi.hoisted(() => vi.fn());

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $queryRaw = queryRaw;
    $disconnect = disconnect;
  },
}));

vi.mock('./tcp-probe', () => ({ tcpProbe: tcpProbeMock }));
vi.mock('./migration-runner', () => ({ runMigrations: runMigrationsMock }));
vi.mock('./diagnostic-server', () => ({
  createDiagnosticServer: createDiagnosticServerMock,
  listenDiagnosticServer: listenDiagnosticServerMock,
  closeDiagnosticServer: closeDiagnosticServerMock,
}));

describe('createProductionDatabaseReadinessDeps', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const config = {
    DATABASE_URL: 'postgresql://user:secret@db.example.com:5432/coda',
    DB_BOOT_CONNECT_TIMEOUT_MS: 5_000,
    CONFIG_ENCRYPTION_KEY: undefined,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'screenplays',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secretsecret',
    S3_FORCE_PATH_STYLE: true,
    PRE_UPGRADE_BACKUP: 'on' as const,
    PRE_UPGRADE_BACKUP_KEEP: 3,
  };

  it('probes TCP reachability before opening a throwaway Prisma client', async () => {
    tcpProbeMock.mockResolvedValue(undefined);
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    disconnect.mockResolvedValue(undefined);
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');

    await deps.probe();

    expect(tcpProbeMock).toHaveBeenCalledWith('db.example.com', 5432, 5_000);
    expect(queryRaw).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('disconnects the throwaway Prisma client even when the query fails', async () => {
    tcpProbeMock.mockResolvedValue(undefined);
    queryRaw.mockRejectedValue(new Error('auth failed'));
    disconnect.mockResolvedValue(undefined);
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');

    await expect(deps.probe()).rejects.toThrow('auth failed');
    expect(disconnect).toHaveBeenCalled();
  });

  it('propagates a TCP probe failure without reaching Prisma', async () => {
    tcpProbeMock.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');

    await expect(deps.probe()).rejects.toThrow('refused');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('wires a pre-migration safety-backup step', () => {
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');
    expect(typeof deps.preMigrate).toBe('function');
  });

  it('delegates migrate to runMigrations with the api root', async () => {
    runMigrationsMock.mockResolvedValue(undefined);
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');

    await deps.migrate();

    expect(runMigrationsMock).toHaveBeenCalledWith('/app/apps/api');
  });

  it('starts and closes the diagnostic HTTP server', async () => {
    const fakeServer = { fake: true };
    createDiagnosticServerMock.mockReturnValue(fakeServer);
    listenDiagnosticServerMock.mockResolvedValue(undefined);
    closeDiagnosticServerMock.mockResolvedValue(undefined);
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');
    const getView = () => ({}) as never;

    const handle = await deps.startDiagnostics(3_000, getView);
    expect(createDiagnosticServerMock).toHaveBeenCalledWith(getView);
    expect(listenDiagnosticServerMock).toHaveBeenCalledWith(fakeServer, 3_000);

    await handle.close();
    expect(closeDiagnosticServerMock).toHaveBeenCalledWith(fakeServer);
  });

  it('reports a monotonically usable now() and logs failed attempts without throwing', () => {
    const deps = createProductionDatabaseReadinessDeps(config, '/app/apps/api');
    expect(typeof deps.now()).toBe('number');
    expect(() =>
      deps.onAttemptFailed?.(
        {
          host: 'db.example.com',
          port: 5432,
          errorClass: 'timeout',
          label: 'Connection timed out',
          hints: [],
          attempt: 1,
          checkedAt: new Date().toISOString(),
          nextRetryAt: new Date().toISOString(),
        },
        new Error('boom'),
      ),
    ).not.toThrow();
  });
});
