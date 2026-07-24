import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as client from 'prom-client';
import { BackupService } from '../backup/backup.service';
import { StorageService } from '../storage/storage.service';
import { ReleaseCheckerService } from '../updates/release-checker.service';
import type { HttpDurationHistogram } from './http-metrics.middleware';

const METRIC_PREFIX = 'coda_';
const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

/**
 * A live storage probe (`StorageService.ready()`) makes a real network call to the
 * object store. Scrapers poll `/metrics` frequently, so the result is cached for this
 * long and re-checked at most once per window — keeping the endpoint cheap regardless
 * of scrape interval.
 */
const STORAGE_PROBE_CACHE_MS = 30_000;

interface StorageProbeCache {
  checkedAt: number;
  up: boolean;
}

/**
 * Owns the process-wide Prometheus registry: default Node metrics, the HTTP request
 * duration histogram, and domain gauges/counters fed by services already on main.
 *
 * Extension point for #89 (scheduler-job execution telemetry; not yet merged): once
 * scheduled backup/retention jobs land, call {@link recordSchedulerJobOutcome} from
 * each job's completion handler. The metric shapes are registered now so that wiring
 * is a pure call-site addition with no further registry changes.
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new client.Registry();
  readonly httpRequestDuration: HttpDurationHistogram;

  private readonly schedulerJobRuns: client.Counter<'job' | 'outcome'>;
  private readonly schedulerJobDuration: client.Histogram<'job'>;

  private storageProbeCache: StorageProbeCache | undefined;
  private storageProbeInFlight: Promise<boolean> | undefined;

  constructor(
    private readonly backupService: BackupService,
    private readonly storageService: StorageService,
    private readonly releaseChecker: ReleaseCheckerService,
  ) {
    client.collectDefaultMetrics({ register: this.registry, prefix: METRIC_PREFIX });

    this.httpRequestDuration = new client.Histogram({
      name: `${METRIC_PREFIX}http_request_duration_seconds`,
      help: 'HTTP request duration in seconds, labeled by method, bounded route class, and status code.',
      labelNames: ['method', 'route', 'status'],
      buckets: [...HTTP_DURATION_BUCKETS_SECONDS],
      registers: [this.registry],
    });

    // Backup engine presence: today this is a liveness/wiring signal (the engine is
    // always constructed once the app boots, since S3 and Postgres are required
    // configuration). #89 will feed real outcome and last-backup-age gauges here once
    // backups run on a schedule instead of being triggered manually.
    new client.Gauge({
      name: `${METRIC_PREFIX}backup_engine_available`,
      help: '1 when the in-app backup engine is constructed and reachable via dependency injection.',
      registers: [this.registry],
    }).set(this.backupService ? 1 : 0);

    // Bound/captured ahead of the object literals below so `collect()` can stay a
    // regular (non-arrow) function — required for prom-client to bind its `this` to
    // the gauge instance for `.set()` — without aliasing the outer `this`.
    const probeStorage = this.probeStorage.bind(this);

    new client.Gauge({
      name: `${METRIC_PREFIX}storage_probe_up`,
      help: 'Whether the last object-storage bucket probe succeeded (1) or failed (0). Cached for up to 30s so scraping stays cheap.',
      registers: [this.registry],
      async collect() {
        this.set((await probeStorage()) ? 1 : 0);
      },
    });

    new client.Gauge({
      name: `${METRIC_PREFIX}update_available`,
      help: 'Whether the release checker has observed a Coda release newer than the running version (1) or not (0).',
      registers: [this.registry],
      async collect() {
        const status = await releaseChecker.status();
        this.set(status.updateAvailable ? 1 : 0);
      },
    });

    // Extension point for #89 (scheduler-job execution telemetry; not yet merged).
    // Registered now, unused until a scheduler calls recordSchedulerJobOutcome().
    this.schedulerJobRuns = new client.Counter({
      name: `${METRIC_PREFIX}scheduler_job_runs_total`,
      help: 'Total scheduled job runs by job name and outcome. Populated once #89 lands.',
      labelNames: ['job', 'outcome'],
      registers: [this.registry],
    });
    this.schedulerJobDuration = new client.Histogram({
      name: `${METRIC_PREFIX}scheduler_job_duration_seconds`,
      help: 'Scheduled job duration in seconds by job name. Populated once #89 lands.',
      labelNames: ['job'],
      buckets: [...HTTP_DURATION_BUCKETS_SECONDS],
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Registration hook for #89 (scheduler-job execution telemetry; not yet merged).
   * `job` must stay a small, fixed vocabulary of internal job names (e.g. `backup`,
   * `retention-sweep`) — never a user- or request-derived value — to keep the label
   * set bounded.
   */
  recordSchedulerJobOutcome(
    job: string,
    outcome: 'success' | 'failure',
    durationSeconds: number,
  ): void {
    this.schedulerJobRuns.inc({ job, outcome });
    this.schedulerJobDuration.observe({ job }, durationSeconds);
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }

  private probeStorage(): Promise<boolean> {
    const now = Date.now();
    if (this.storageProbeCache && now - this.storageProbeCache.checkedAt < STORAGE_PROBE_CACHE_MS) {
      return Promise.resolve(this.storageProbeCache.up);
    }
    this.storageProbeInFlight ??= this.storageService
      .ready()
      .then(() => true)
      .catch((error: unknown) => {
        this.logger.debug(
          `Storage probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        return false;
      })
      .then((up) => {
        this.storageProbeCache = { checkedAt: Date.now(), up };
        this.storageProbeInFlight = undefined;
        return up;
      });
    return this.storageProbeInFlight;
  }
}
