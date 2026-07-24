import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupService } from '../backup/backup.service';
import type { StorageService } from '../storage/storage.service';
import type { ReleaseCheckerService } from '../updates/release-checker.service';
import type { ReleaseCheckStatus } from '../updates/release-checker.types';
import { MetricsService } from './metrics.service';

function releaseStatus(updateAvailable: boolean): ReleaseCheckStatus {
  return {
    current: '0.0.3',
    latest: updateAvailable ? '0.0.4' : '0.0.3',
    updateAvailable,
    comparison: updateAvailable ? 'behind' : 'current',
    notesUrl: null,
    lastCheckedAt: null,
    lastSucceededAt: null,
    lastError: null,
  };
}

function service(
  options: {
    storageReady?: () => Promise<void>;
    updateAvailable?: boolean;
  } = {},
) {
  const backupService = {} as BackupService;
  const storageService = {
    ready: options.storageReady ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  const releaseChecker = {
    status: vi.fn().mockResolvedValue(releaseStatus(options.updateAvailable ?? false)),
  } as unknown as ReleaseCheckerService;
  return new MetricsService(backupService, storageService, releaseChecker);
}

describe('MetricsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the registry content type used for the HTTP response', () => {
    const metrics = service();
    expect(metrics.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('presence contract: renders default, HTTP, and every documented domain metric', async () => {
    const metrics = service();
    metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/api/v1/health/live', status: '200' },
      0.01,
    );
    const body = await metrics.render();

    for (const metricName of [
      'coda_http_request_duration_seconds',
      'coda_backup_engine_available',
      'coda_storage_probe_up',
      'coda_update_available',
      'coda_scheduler_job_runs_total',
      'coda_scheduler_job_duration_seconds',
      // Default Node process metrics, collected under the same prefix.
      'coda_process_cpu_user_seconds_total',
      'coda_nodejs_heap_size_total_bytes',
    ]) {
      expect(body).toContain(metricName);
    }
  });

  it('reports the backup engine as available once dependency injection succeeds', async () => {
    const body = await service().render();
    expect(body).toMatch(/coda_backup_engine_available 1/);
  });

  it('reflects a successful storage probe', async () => {
    const body = await service({ storageReady: vi.fn().mockResolvedValue(undefined) }).render();
    expect(body).toMatch(/coda_storage_probe_up 1/);
  });

  it('reflects a failed storage probe without throwing', async () => {
    const body = await service({
      storageReady: vi.fn().mockRejectedValue(new Error('down')),
    }).render();
    expect(body).toMatch(/coda_storage_probe_up 0/);
  });

  it('caches the storage probe result and re-checks at most once per window', async () => {
    const ready = vi.fn().mockResolvedValue(undefined);
    const metrics = service({ storageReady: ready });

    await metrics.render();
    await metrics.render();
    expect(ready).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date('2026-01-01T00:00:31.000Z'));
    await metrics.render();
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it('reflects the release checker update-available flag', async () => {
    const stale = await service({ updateAvailable: false }).render();
    expect(stale).toMatch(/coda_update_available 0/);

    const behind = await service({ updateAvailable: true }).render();
    expect(behind).toMatch(/coda_update_available 1/);
  });

  it('records scheduler-job outcomes through the documented #89 extension hook', async () => {
    const metrics = service();
    metrics.recordSchedulerJobOutcome('backup', 'success', 4.2);
    metrics.recordSchedulerJobOutcome('backup', 'failure', 0.5);
    const body = await metrics.render();

    expect(body).toContain('coda_scheduler_job_runs_total{job="backup",outcome="success"} 1');
    expect(body).toContain('coda_scheduler_job_runs_total{job="backup",outcome="failure"} 1');
    expect(body).toContain('coda_scheduler_job_duration_seconds_bucket');
  });

  it('clears the registry on module destroy', () => {
    const metrics = service();
    metrics.onModuleDestroy();
    expect(metrics.registry.getMetricsAsArray()).toHaveLength(0);
  });
});
