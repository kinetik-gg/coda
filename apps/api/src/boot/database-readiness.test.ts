import { describe, expect, it, vi } from 'vitest';
import {
  ensureDatabaseReady,
  type DatabaseReadinessDeps,
  type DiagnosticsHandle,
} from './database-readiness';
import type { DiagnosticView } from './diagnostic-page';

function baseOptions() {
  return {
    databaseUrl: 'postgresql://user:secret@db.example.com:5432/coda',
    port: 3000,
    retryWindowsMs: [10, 20, 30],
  };
}

function refusedError(): NodeJS.ErrnoException {
  return Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
}

describe('ensureDatabaseReady', () => {
  it('resolves immediately when the probe and migration both succeed on the first attempt', async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const probe = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const startDiagnostics = vi
      .fn<DatabaseReadinessDeps['startDiagnostics']>()
      .mockResolvedValue({ close });
    const deps: DatabaseReadinessDeps = { probe, migrate, sleep, startDiagnostics, now: () => 0 };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(startDiagnostics).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('serves diagnostics and retries with backoff until the probe succeeds, then closes it', async () => {
    let probeCalls = 0;
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const startDiagnostics = vi
      .fn<DatabaseReadinessDeps['startDiagnostics']>()
      .mockResolvedValue({ close });
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onAttemptFailed = vi.fn<(view: DiagnosticView, error: unknown) => void>();
    const probe = vi.fn<() => Promise<void>>(() => {
      probeCalls += 1;
      return probeCalls < 3 ? Promise.reject(refusedError()) : Promise.resolve();
    });
    const deps: DatabaseReadinessDeps = {
      probe,
      migrate,
      sleep,
      startDiagnostics,
      now: () => 1_000,
      onAttemptFailed,
    };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(probeCalls).toBe(3);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(startDiagnostics).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect(onAttemptFailed).toHaveBeenCalledTimes(2);
    const [view] = onAttemptFailed.mock.calls[0] as [DiagnosticView, unknown];
    expect(view.errorClass).toBe('connection-refused');
    expect(view.host).toBe('db.example.com');
    expect(view.port).toBe(5432);
    expect(view.attempt).toBe(1);
  });

  it('caps the retry delay at the final window once attempts exceed the configured list', async () => {
    let probeCalls = 0;
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const probe = vi.fn<() => Promise<void>>(() => {
      probeCalls += 1;
      return probeCalls <= 4 ? Promise.reject(new Error('still down')) : Promise.resolve();
    });
    const startDiagnostics = vi
      .fn<DatabaseReadinessDeps['startDiagnostics']>()
      .mockResolvedValue({ close });
    const deps: DatabaseReadinessDeps = { probe, migrate, sleep, startDiagnostics, now: () => 0 };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect(sleep).toHaveBeenNthCalledWith(3, 30);
    expect(sleep).toHaveBeenNthCalledWith(4, 30);
  });

  it('re-enters the diagnostic loop when migration fails after a successful probe', async () => {
    let migrateCalls = 0;
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const probe = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const startDiagnostics = vi
      .fn<DatabaseReadinessDeps['startDiagnostics']>()
      .mockResolvedValue({ close });
    const migrate = vi.fn<() => Promise<void>>(() => {
      migrateCalls += 1;
      return migrateCalls === 1
        ? Promise.reject(new Error('P1001: Can not reach database server'))
        : Promise.resolve();
    });
    const deps: DatabaseReadinessDeps = { probe, migrate, sleep, startDiagnostics, now: () => 0 };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(probe).toHaveBeenCalledTimes(2);
    expect(migrateCalls).toBe(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('starts the diagnostic server only once across repeated failures', async () => {
    let calls = 0;
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const startDiagnostics = vi
      .fn<DatabaseReadinessDeps['startDiagnostics']>()
      .mockResolvedValue({ close });
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const probe = vi.fn<() => Promise<void>>(() => {
      calls += 1;
      return calls <= 2 ? Promise.reject(new Error('down')) : Promise.resolve();
    });
    const deps: DatabaseReadinessDeps = { probe, migrate, sleep, startDiagnostics, now: () => 0 };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(startDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('exposes the latest diagnostic view lazily through the getView callback', async () => {
    let calls = 0;
    let capturedGetView: (() => DiagnosticView) | undefined;
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const probe = vi.fn<() => Promise<void>>(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve();
    });
    const startDiagnostics = vi.fn<DatabaseReadinessDeps['startDiagnostics']>(
      (_port: number, getView: () => DiagnosticView): Promise<DiagnosticsHandle> => {
        capturedGetView = getView;
        return Promise.resolve({ close: () => Promise.resolve() });
      },
    );
    const deps: DatabaseReadinessDeps = { probe, migrate, sleep, startDiagnostics, now: () => 0 };

    await ensureDatabaseReady(baseOptions(), deps);

    expect(capturedGetView?.().errorClass).toBe('unknown');
  });
});
