import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { env } from '../config/env';
import { AUTO_TRUSTED_PROXIES, resolveTrustedProxyCidrs } from '../config/trusted-proxies';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ReleaseCheckerService } from '../updates/release-checker.service';
import { runningVersion } from '../updates/running-version';
import {
  SCHEDULER_HEALTH_PROVIDER,
  type DoctorRowStatus,
  type SchedulerHealthProvider,
} from './doctor-scheduler';

export type { DoctorRowStatus } from './doctor-scheduler';

/** One line of the doctor report: what it is, how it's doing, and why (when unhealthy). */
export interface DoctorRow {
  id: string;
  label: string;
  status: DoctorRowStatus;
  value: string;
  hint: string | null;
}

export interface DoctorReport {
  generatedAt: string;
  /** The configured public origin this report was generated for. Not a secret. */
  instanceOrigin: string;
  rows: DoctorRow[];
  /**
   * Preformatted plain text ready to paste into a public bug report. Built
   * exclusively from {@link rows}, which never carry credential material, so
   * this is sanitized by construction rather than by post-hoc scrubbing.
   */
  reportText: string;
}

// Two directories below apps/api from both the TS source tree (src/health/) and
// the compiled dist layout (dist/health/), matching the migrations directory the
// production image copies alongside the compiled app (see repo root Dockerfile).
const migrationsDir = join(__dirname, '../../prisma/migrations');

function formatBytes(value: bigint | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = amount;
  let index = 0;
  while (current >= 1000 && index < units.length - 1) {
    current /= 1000;
    index += 1;
  }
  const precision = index ? 1 : 0;
  return `${current.toFixed(precision)} ${units[index]}`;
}

/**
 * Aggregates a single owner-facing diagnostic snapshot from existing
 * health/probe/status services — no new probes are introduced here. Every row
 * degrades independently: one subsystem failing to answer never prevents the
 * rest of the report from rendering.
 */
@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly releaseChecker: ReleaseCheckerService,
    @Optional()
    @Inject(SCHEDULER_HEALTH_PROVIDER)
    private readonly schedulerHealth?: SchedulerHealthProvider,
  ) {}

  async report(userId: string): Promise<DoctorReport> {
    await this.assertAdministrator(userId);
    const rows = await this.buildRows();
    const generatedAt = new Date().toISOString();
    const instanceOrigin = env().APP_ORIGIN;
    return {
      generatedAt,
      instanceOrigin,
      rows,
      reportText: renderReportText(generatedAt, instanceOrigin, rows),
    };
  }

  private async buildRows(): Promise<DoctorRow[]> {
    const [updateRow, databaseRow, storageRow, migrationsRow, schedulerRow, counterRows] =
      await Promise.all([
        this.updateRow(),
        this.databaseRow(),
        this.storageRow(),
        this.migrationsRow(),
        this.schedulerRow(),
        this.counterRows(),
      ]);
    return [
      this.versionRow(),
      updateRow,
      databaseRow,
      storageRow,
      this.trustedProxiesRow(),
      this.backupRow(),
      schedulerRow,
      migrationsRow,
      ...counterRows,
    ];
  }

  private versionRow(): DoctorRow {
    return {
      id: 'app.version',
      label: 'Application version',
      status: 'ok',
      value: runningVersion(),
      hint: null,
    };
  }

  private async updateRow(): Promise<DoctorRow> {
    const status = await this.releaseChecker.status();
    if (status.comparison === 'unknown') {
      return {
        id: 'app.updateAvailable',
        label: 'Update check',
        status: 'unknown',
        value: 'Not checked yet',
        hint: 'No successful release check has completed. Verify outbound network access, or wait for the next scheduled check.',
      };
    }
    if (status.updateAvailable) {
      return {
        id: 'app.updateAvailable',
        label: 'Update check',
        status: 'warn',
        value: `Update available: ${status.latest}`,
        hint: 'Open the Updates section to review and apply the new release.',
      };
    }
    return {
      id: 'app.updateAvailable',
      label: 'Update check',
      status: 'ok',
      value: 'Up to date',
      hint: null,
    };
  }

  private async databaseRow(): Promise<DoctorRow> {
    const start = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Math.round(performance.now() - start);
      return {
        id: 'database.reachability',
        label: 'Database',
        status: 'ok',
        value: `Reachable (${latencyMs} ms)`,
        hint: null,
      };
    } catch {
      return {
        id: 'database.reachability',
        label: 'Database',
        status: 'error',
        value: 'Unreachable',
        hint: 'The database did not respond to a health probe. Verify DATABASE_URL and that PostgreSQL is running.',
      };
    }
  }

  private async storageRow(): Promise<DoctorRow> {
    const start = performance.now();
    try {
      await this.storage.ready();
      const latencyMs = Math.round(performance.now() - start);
      return {
        id: 'storage.backend',
        label: 'Storage backend',
        status: 'ok',
        value: `s3-compatible object storage · reachable (${latencyMs} ms)`,
        hint: null,
      };
    } catch {
      return {
        id: 'storage.backend',
        label: 'Storage backend',
        status: 'error',
        value: 's3-compatible object storage · unreachable',
        hint: 'The configured object-storage bucket did not respond to a health probe. Verify storage credentials and endpoint reachability.',
      };
    }
  }

  private trustedProxiesRow(): DoctorRow {
    const configured = env().TRUSTED_PROXY_CIDRS;
    const cidrs = resolveTrustedProxyCidrs(configured);
    const autoDetected = configured === AUTO_TRUSTED_PROXIES;
    return {
      id: 'network.trustedProxies',
      label: 'Trusted proxies',
      status: 'ok',
      value:
        cidrs.length > 0
          ? `${cidrs.join(', ')}${autoDetected ? ' (auto-detected)' : ''}`
          : 'None configured',
      hint:
        cidrs.length > 0
          ? null
          : 'No trusted proxy CIDRs are configured; client IPs are taken from the direct connection only.',
    };
  }

  private backupRow(): DoctorRow {
    // The in-app backup engine (apps/api/src/backup) streams archives to a
    // caller-supplied sink and never persists run history itself, so "last
    // backup" isn't discoverable from inside the application today. Extension
    // point: once backup runs are recorded somewhere durable, replace this
    // method with a read of that record.
    return {
      id: 'backup.last',
      label: 'Last backup',
      status: 'unknown',
      value: 'Not available',
      hint: 'This instance does not track backup run history yet. Confirm your backup schedule and its logs outside the application.',
    };
  }

  private async schedulerRow(): Promise<DoctorRow> {
    if (!this.schedulerHealth) {
      return {
        id: 'scheduler.health',
        label: 'Scheduler jobs',
        status: 'unknown',
        value: 'Not available',
        hint: 'Scheduled-job status is not part of this build yet. This row activates automatically once that module is registered.',
      };
    }
    const snapshot = await this.schedulerHealth.status();
    return {
      id: 'scheduler.health',
      label: 'Scheduler jobs',
      status: snapshot.status,
      value: snapshot.value,
      hint: snapshot.hint,
    };
  }

  private async migrationsRow(): Promise<DoctorRow> {
    try {
      const applied = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      const appliedNames = new Set(applied.map((row) => row.migration_name));
      const onDisk = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const pending = onDisk.filter((name) => !appliedNames.has(name));
      if (pending.length === 0) {
        return {
          id: 'database.migrations',
          label: 'Pending migrations',
          status: 'ok',
          value: 'None pending',
          hint: null,
        };
      }
      return {
        id: 'database.migrations',
        label: 'Pending migrations',
        status: 'warn',
        value: `${pending.length} pending`,
        hint: 'Run the deploy migration step (see the container entrypoint) before serving traffic.',
      };
    } catch {
      return {
        id: 'database.migrations',
        label: 'Pending migrations',
        status: 'unknown',
        value: 'Not available',
        hint: 'Migration state could not be read.',
      };
    }
  }

  private async counterRows(): Promise<DoctorRow[]> {
    const [users, projects, storage] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.project.count({ where: { deletedAt: null } }),
      this.prisma.storageObject.aggregate({
        where: { deletedAt: null },
        _sum: { sizeBytes: true },
      }),
    ]);
    return [
      { id: 'instance.users', label: 'Users', status: 'ok', value: String(users), hint: null },
      {
        id: 'instance.projects',
        label: 'Projects',
        status: 'ok',
        value: String(projects),
        hint: null,
      },
      {
        id: 'instance.storageBytes',
        label: 'Storage used',
        status: 'ok',
        value: formatBytes(storage._sum.sizeBytes ?? 0n),
        hint: null,
      },
    ];
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may view diagnostics');
    }
  }
}

const STATUS_LABEL: Record<DoctorRowStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  error: 'ERROR',
  unknown: 'N/A',
};

function renderReportText(generatedAt: string, instanceOrigin: string, rows: DoctorRow[]): string {
  const lines = [
    'Coda instance diagnostic report',
    `Instance: ${instanceOrigin}`,
    `Generated: ${generatedAt}`,
    '',
    ...rows.map((row) => {
      const suffix = row.hint ? ` — ${row.hint}` : '';
      return `[${STATUS_LABEL[row.status]}] ${row.label}: ${row.value}${suffix}`;
    }),
  ];
  return lines.join('\n');
}
