import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SCHEDULED_BACKUP_SETTINGS,
  type ScheduledBackupDestinationInput,
  type ScheduledBackupDestinationResult,
  type ScheduledBackupHistoryEntry,
  type ScheduledBackupRunResult,
  type ScheduledBackupSettings,
  type ScheduledBackupStatusView,
  type ScheduledBackupView,
} from '@coda/contracts';
import { InstanceConfigService } from '../../config/instance-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduledBackupDestinationManager } from './scheduled-backup-destination.manager';
import { ScheduledBackupEngine } from './scheduled-backup.engine';
import { ScheduledBackupSigningService } from './scheduled-backup-signing';

/** Stable scheduler key; doubles as the advisory-lock and status-table key. */
export const SCHEDULED_BACKUP_JOB_KEY = 'backups.scheduled';
/** How many recent runs are retained in the config-store history log. */
const HISTORY_LIMIT = 20;
const MAX_ERROR_LENGTH = 2_000;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Owner-facing orchestration for scheduled backups: settings and destination
 * management, history, and the scheduler-driven run loop. The registered job
 * (see {@link import('./scheduled-backup.job').ScheduledBackupJob}) wakes on a
 * fixed poll interval and calls {@link tickJob}, which self-gates on the
 * operator's enable flag and interval so the cadence is config-driven without
 * re-arming timers. Retention is enforced only inside a successful run, so a
 * disabled schedule or a failing destination never deletes stored archives.
 */
@Injectable()
export class ScheduledBackupService {
  private readonly logger = new Logger(ScheduledBackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instanceConfig: InstanceConfigService,
    private readonly signing: ScheduledBackupSigningService,
    private readonly engine: ScheduledBackupEngine,
    private readonly destination: ScheduledBackupDestinationManager,
  ) {}

  /** Scheduler entry point. Throws on a failed run so status records FAILURE. */
  async tickJob(): Promise<void> {
    const result = await this.tick('scheduled');
    if (result && result.outcome === 'FAILURE') {
      throw new Error(result.entry.error ?? 'Scheduled backup failed');
    }
  }

  /**
   * Runs one tick. Returns null when nothing was due (disabled or not yet due and
   * not forced); otherwise performs a backup and returns its recorded outcome.
   */
  async tick(
    reason: 'scheduled' | 'manual',
    options: { force?: boolean } = {},
  ): Promise<ScheduledBackupRunResult | null> {
    const settings = await this.settings();
    if (!options.force) {
      if (!settings.enabled) return null;
      const history = await this.history();
      if (!this.isDue(settings, history)) return null;
    }
    const entry = await this.executeRun(settings, reason);
    return { outcome: entry.outcome, entry };
  }

  /** Owner-gated read of the full section state. */
  async describe(userId: string): Promise<ScheduledBackupView> {
    await this.assertAdministrator(userId);
    return this.view();
  }

  /** Owner-gated settings update. Generates the signing key on first enable. */
  async updateSettings(
    userId: string,
    settings: ScheduledBackupSettings,
  ): Promise<ScheduledBackupView> {
    await this.assertAdministrator(userId);
    if (settings.enabled) await this.signing.ensureKeyMaterial(userId);
    await this.instanceConfig.setConfig('backup.schedule', settings, userId);
    this.logger.log(
      `Scheduled backups ${settings.enabled ? 'enabled' : 'disabled'} by ${userId} ` +
        `(every ${settings.intervalHours}h, keepLast ${settings.retention.keepLast})`,
    );
    return this.view();
  }

  /** Owner-gated probe of a candidate dedicated destination. Never persists. */
  async validateDestination(
    userId: string,
    input: ScheduledBackupDestinationInput,
  ): Promise<ScheduledBackupDestinationResult['probe']> {
    await this.assertAdministrator(userId);
    return this.destination.probe(input);
  }

  /** Owner-gated persist of a dedicated destination override, gated on a clean probe. */
  async setDestination(
    userId: string,
    input: ScheduledBackupDestinationInput,
  ): Promise<ScheduledBackupDestinationResult> {
    await this.assertAdministrator(userId);
    const { probe, applied } = await this.destination.persist(input, userId);
    if (!applied) return { status: 'invalid', probe };
    this.logger.log(
      `Scheduled-backup destination override set by ${userId} (bucket ${input.bucket})`,
    );
    return { status: 'applied', probe, view: await this.view() };
  }

  /** Owner-gated removal of the destination override; archives return to active storage. */
  async clearDestination(userId: string): Promise<ScheduledBackupView> {
    await this.assertAdministrator(userId);
    await this.destination.clear();
    this.logger.log(`Scheduled-backup destination override cleared by ${userId}`);
    return this.view();
  }

  /** Owner-gated manual run, bypassing the due gate. Never throws on run failure. */
  async runNow(userId: string): Promise<ScheduledBackupRunResult> {
    await this.assertAdministrator(userId);
    const settings = await this.settings();
    const entry = await this.executeRun(settings, 'manual');
    return { outcome: entry.outcome, entry };
  }

  private async executeRun(
    settings: ScheduledBackupSettings,
    reason: 'scheduled' | 'manual',
  ): Promise<ScheduledBackupHistoryEntry> {
    const startedAt = new Date();
    const id = randomUUID();
    try {
      const keyMaterial = await this.signing.ensureKeyMaterial();
      const artifacts = await this.engine.run(settings, reason, keyMaterial.privateKeyPem);
      const entry: ScheduledBackupHistoryEntry = {
        id,
        reason,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'SUCCESS',
        archiveKey: artifacts.archiveKey,
        sizeBytes: artifacts.sizeBytes,
        prunedCount: artifacts.prunedCount,
        error: null,
      };
      await this.appendHistory(entry);
      this.logger.log(
        `Scheduled backup (${reason}) wrote ${artifacts.archiveKey} and pruned ${artifacts.prunedCount}`,
      );
      return entry;
    } catch (error) {
      const entry: ScheduledBackupHistoryEntry = {
        id,
        reason,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'FAILURE',
        archiveKey: null,
        sizeBytes: null,
        prunedCount: 0,
        error: errorMessage(error),
      };
      await this.appendHistory(entry);
      this.logger.error(`Scheduled backup (${reason}) failed: ${entry.error}`);
      return entry;
    }
  }

  private async view(): Promise<ScheduledBackupView> {
    const [settings, history, fingerprint, destination] = await Promise.all([
      this.settings(),
      this.history(),
      this.signing.fingerprint(),
      this.destination.describe(),
    ]);
    return {
      settings,
      destination,
      status: this.statusView(settings, history),
      verificationKeyFingerprint: fingerprint,
      history,
    };
  }

  private statusView(
    settings: ScheduledBackupSettings,
    history: ScheduledBackupHistoryEntry[],
  ): ScheduledBackupStatusView {
    const last = history[0];
    const nextDue = settings.enabled ? this.nextDueAt(settings, history) : null;
    return {
      enabled: settings.enabled,
      lastRunAt: last?.finishedAt ?? null,
      lastOutcome: last?.outcome ?? null,
      lastError: last?.error ?? null,
      nextDueAt: nextDue?.toISOString() ?? null,
      runCount: history.length,
      failureCount: history.filter((entry) => entry.outcome === 'FAILURE').length,
    };
  }

  private isDue(
    settings: ScheduledBackupSettings,
    history: ScheduledBackupHistoryEntry[],
  ): boolean {
    return Date.now() >= this.nextDueAt(settings, history).getTime();
  }

  /** The next due time = the most recent attempt plus the interval, or now. */
  private nextDueAt(
    settings: ScheduledBackupSettings,
    history: ScheduledBackupHistoryEntry[],
  ): Date {
    const last = history[0];
    if (!last) return new Date();
    return new Date(Date.parse(last.finishedAt) + settings.intervalHours * 3_600_000);
  }

  private async settings(): Promise<ScheduledBackupSettings> {
    return (
      (await this.instanceConfig.getConfig('backup.schedule')) ?? DEFAULT_SCHEDULED_BACKUP_SETTINGS
    );
  }

  private async history(): Promise<ScheduledBackupHistoryEntry[]> {
    const stored = await this.instanceConfig.getConfig('backup.history');
    return stored?.entries ?? [];
  }

  private async appendHistory(entry: ScheduledBackupHistoryEntry): Promise<void> {
    const existing = await this.history();
    await this.instanceConfig.setConfig('backup.history', {
      entries: [entry, ...existing].slice(0, HISTORY_LIMIT),
    });
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may manage scheduled backups');
    }
  }
}
