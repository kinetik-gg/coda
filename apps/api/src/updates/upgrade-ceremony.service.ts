import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PreconditionFailedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CoolifyConfigInput,
  RedeployWebhookInput,
  UpgradeCeremonyPhase,
  UpgradeCeremonyView,
  UpgradeHistoryEntry,
  UpgradePendingBackup,
  UpgradeTarget,
} from '@coda/contracts';
import { env } from '../config/env';
import { InstanceConfigService } from '../config/instance-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledBackupService } from '../backup/scheduled/scheduled-backup.service';
import { CoolifyApiError, CoolifyClient, type FetchLike } from './coolify-client';
import { ReleaseCheckerService } from './release-checker.service';
import { runningVersion } from './running-version';
import { classifyVersion } from './semver-compare';

/** Injection seam so tests substitute the outbound fetch and clock without a network or timers. */
export const UPGRADE_CEREMONY_ADAPTERS = Symbol('UPGRADE_CEREMONY_ADAPTERS');

export interface UpgradeCeremonyAdapters {
  /** Outbound fetch used for the redeploy webhook and the Coolify client. */
  fetchImpl?: FetchLike;
  /** Clock override for freshness checks. */
  now?: () => number;
}

/** A fresh ceremony backup older than this is stale and no longer unlocks a redeploy. */
const PENDING_BACKUP_TTL_MS = 2 * 60 * 60 * 1_000;
const HISTORY_LIMIT = 50;
const MAX_ERROR_LENGTH = 500;
const WEBHOOK_TIMEOUT_MS = 15_000;

const NO_ENCRYPTION_KEY_MESSAGE =
  'Managed upgrades require CONFIG_ENCRYPTION_KEY so the pre-upgrade backup can be signed and ' +
  'stored. Set a 32+ byte base64 key in the platform environment, restart, then start the upgrade.';

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Opt-in upgrade ceremony over the release checker. It enforces a single, strict
 * invariant: no redeploy trigger (generic webhook or Coolify) runs without a
 * fresh, successful backup recorded for the current target. The flow is a state
 * machine — backup gate → instruction/adapter step → recorded outcome — expressed
 * as owner-gated actions whose gate is the persisted {@link UpgradePendingBackup}.
 *
 * Secrets (the webhook URL and the Coolify token) live encrypted in the config
 * store and are never returned to the browser or written to logs.
 */
@Injectable()
export class UpgradeCeremonyService {
  private readonly logger = new Logger(UpgradeCeremonyService.name);
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InstanceConfigService,
    private readonly releaseChecker: ReleaseCheckerService,
    private readonly scheduledBackup: ScheduledBackupService,
    @Optional() @Inject(UPGRADE_CEREMONY_ADAPTERS) adapters: UpgradeCeremonyAdapters = {},
  ) {
    this.fetchImpl = adapters.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = adapters.now ?? (() => Date.now());
  }

  /** Owner-gated read of the whole ceremony panel. */
  async describe(userId: string): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    return this.buildView();
  }

  /**
   * The backup gate. Requires the encryption key, takes a fresh signed backup via
   * the backup engine, and only on success records the pending backup that unlocks
   * a deploy. A failed backup is recorded and aborts the ceremony — no pending
   * state is written, so no deploy path can proceed.
   */
  async startBackup(userId: string): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    const target = await this.resolveUpgradeTarget();
    if (!target) throw new BadRequestException('No newer release is available to upgrade to.');
    if (!env().CONFIG_ENCRYPTION_KEY) {
      throw new PreconditionFailedException(NO_ENCRYPTION_KEY_MESSAGE);
    }

    const fromVersion = runningVersion();
    const run = await this.scheduledBackup.runNow(userId);
    if (run.outcome !== 'SUCCESS' || !run.entry.archiveKey) {
      await this.appendHistory({
        tier: 'backup',
        fromVersion,
        toVersion: target.version,
        backupRef: null,
        outcome: 'FAILURE',
        error: run.entry.error,
      });
      throw new ServiceUnavailableException(
        `Pre-upgrade backup failed; upgrade aborted: ${run.entry.error ?? 'unknown error'}`,
      );
    }

    await this.config.setConfig(
      'upgrade.pendingBackup',
      {
        backupRef: run.entry.archiveKey,
        takenAt: new Date(this.now()).toISOString(),
        fromVersion,
        toVersion: target.version,
      },
      userId,
    );
    await this.appendHistory({
      tier: 'backup',
      fromVersion,
      toVersion: target.version,
      backupRef: run.entry.archiveKey,
      outcome: 'SUCCESS',
      error: null,
    });
    this.logger.log(`Pre-upgrade backup captured for ${fromVersion} -> ${target.version}`);
    return this.buildView();
  }

  /**
   * Generic tier: fire the configured redeploy webhook, but only after a fresh
   * backup exists and the operator has explicitly confirmed they updated the
   * platform's CODA_IMAGE env. A webhook failure keeps the backup so the operator
   * can retry.
   */
  async triggerRedeploy(
    userId: string,
    confirmedEnvUpdated: boolean,
  ): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    if (confirmedEnvUpdated !== true) {
      throw new BadRequestException('Confirm you updated the platform CODA_IMAGE env first.');
    }
    const target = await this.resolveUpgradeTarget();
    const pending = await this.usablePendingBackup(target);
    if (!target || !pending) {
      throw new PreconditionFailedException('Take a fresh backup before triggering a redeploy.');
    }
    const webhook = await this.config.getConfig('upgrade.redeployWebhook');
    if (!webhook) throw new BadRequestException('No redeploy webhook is configured.');

    try {
      await this.fireWebhook(webhook.url);
    } catch (error) {
      const message = sanitizeError(error);
      await this.appendHistory({
        tier: 'generic',
        fromVersion: pending.fromVersion,
        toVersion: target.version,
        backupRef: pending.backupRef,
        outcome: 'FAILURE',
        error: message,
      });
      throw new BadGatewayException(`Redeploy webhook failed: ${message}`);
    }

    await this.appendHistory({
      tier: 'generic',
      fromVersion: pending.fromVersion,
      toVersion: target.version,
      backupRef: pending.backupRef,
      outcome: 'SUCCESS',
      error: null,
    });
    await this.config.deleteConfig('upgrade.pendingBackup');
    this.logger.log(`Generic redeploy webhook fired for upgrade to ${target.version}`);
    return this.buildView();
  }

  /**
   * Coolify tier: pin CODA_IMAGE to the target digest and trigger a deployment in
   * one call. On any adapter failure the ceremony falls back to the generic tier
   * with the backup intact — the failure is recorded and surfaced, but no
   * exception is thrown, so the operator can still redeploy manually.
   */
  async runCoolifyUpgrade(userId: string): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    const target = await this.resolveUpgradeTarget();
    const pending = await this.usablePendingBackup(target);
    if (!target || !pending) {
      throw new PreconditionFailedException(
        'Take a fresh backup before running the Coolify upgrade.',
      );
    }
    const coolify = await this.config.getConfig('upgrade.coolify');
    if (!coolify) throw new BadRequestException('The Coolify adapter is not configured.');

    const client = new CoolifyClient(coolify, { fetchImpl: this.fetchImpl });
    try {
      await client.setImageEnv(target.digestRef);
      await client.deploy();
    } catch (error) {
      const message = error instanceof CoolifyApiError ? error.message : sanitizeError(error);
      await this.appendHistory({
        tier: 'coolify',
        fromVersion: pending.fromVersion,
        toVersion: target.version,
        backupRef: pending.backupRef,
        outcome: 'FAILURE',
        error: message,
      });
      this.logger.warn(`Coolify upgrade failed; falling back to the generic tier: ${message}`);
      return this.buildView(message);
    }

    await this.appendHistory({
      tier: 'coolify',
      fromVersion: pending.fromVersion,
      toVersion: target.version,
      backupRef: pending.backupRef,
      outcome: 'SUCCESS',
      error: null,
    });
    await this.config.deleteConfig('upgrade.pendingBackup');
    this.logger.log(`Coolify upgrade to ${target.version} triggered`);
    return this.buildView();
  }

  /** Owner-gated persist of the generic redeploy webhook URL. */
  async setRedeployWebhook(
    userId: string,
    input: RedeployWebhookInput,
  ): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    await this.config.setConfig('upgrade.redeployWebhook', { url: input.url }, userId);
    this.logger.log('Redeploy webhook configured');
    return this.buildView();
  }

  /** Owner-gated removal of the redeploy webhook. */
  async clearRedeployWebhook(userId: string): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    await this.config.deleteConfig('upgrade.redeployWebhook');
    return this.buildView();
  }

  /** Owner-gated persist of the Coolify adapter credentials. The token is never logged. */
  async setCoolify(userId: string, input: CoolifyConfigInput): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    await this.config.setConfig('upgrade.coolify', input, userId);
    this.logger.log(`Coolify adapter configured for application ${input.applicationUuid}`);
    return this.buildView();
  }

  /** Owner-gated removal of the Coolify adapter. */
  async clearCoolify(userId: string): Promise<UpgradeCeremonyView> {
    await this.assertAdministrator(userId);
    await this.config.deleteConfig('upgrade.coolify');
    return this.buildView();
  }

  private async fireWebhook(url: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'POST', signal: controller.signal });
    } catch (error) {
      // Never include the URL: it may embed a deploy token.
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${WEBHOOK_TIMEOUT_MS}ms`
          : 'the request could not be completed';
      throw new Error(reason);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`the platform returned HTTP ${response.status}`);
  }

  private async buildView(lastCoolifyError: string | null = null): Promise<UpgradeCeremonyView> {
    const [target, webhook, coolify, historyState] = await Promise.all([
      this.resolveUpgradeTarget(),
      this.config.getConfig('upgrade.redeployWebhook'),
      this.config.getConfig('upgrade.coolify'),
      this.config.getConfig('upgrade.history'),
    ]);
    const pending = await this.usablePendingBackup(target);
    const pendingView: UpgradePendingBackup | null = pending
      ? { backupRef: pending.backupRef, takenAt: pending.takenAt, toVersion: pending.toVersion }
      : null;
    return {
      phase: this.computePhase(target, pending),
      currentVersion: runningVersion(),
      target,
      pendingBackup: pendingView,
      redeployWebhookConfigured: Boolean(webhook),
      coolify: {
        configured: Boolean(coolify),
        baseUrl: coolify?.baseUrl ?? null,
        applicationUuid: coolify?.applicationUuid ?? null,
      },
      history: (historyState?.entries ?? []) as UpgradeHistoryEntry[],
      lastCoolifyError,
    };
  }

  private computePhase(
    target: UpgradeTarget | null,
    pending: UpgradePendingBackup | null,
  ): UpgradeCeremonyPhase {
    if (!target) return 'unavailable';
    if (!env().CONFIG_ENCRYPTION_KEY) return 'needs_encryption_key';
    if (pending) return 'ready_to_deploy';
    return 'ready_to_backup';
  }

  private async resolveUpgradeTarget(): Promise<UpgradeTarget | null> {
    const latest = await this.releaseChecker.latestReleaseTarget();
    if (!latest) return null;
    if (classifyVersion(runningVersion(), latest.version) !== 'behind') return null;
    return {
      version: latest.version,
      image: latest.image,
      digest: latest.digest,
      taggedRef: `${latest.image}:${latest.version}`,
      digestRef: `${latest.image}@${latest.digest}`,
    };
  }

  /** The pending backup only when it is fresh and matches the current target version. */
  private async usablePendingBackup(target: UpgradeTarget | null): Promise<{
    backupRef: string;
    takenAt: string;
    fromVersion: string;
    toVersion: string;
  } | null> {
    if (!target) return null;
    const pending = await this.config.getConfig('upgrade.pendingBackup');
    if (!pending) return null;
    if (pending.toVersion !== target.version) return null;
    const age = this.now() - Date.parse(pending.takenAt);
    if (Number.isNaN(age) || age > PENDING_BACKUP_TTL_MS) return null;
    return pending;
  }

  private async appendHistory(step: Omit<UpgradeHistoryEntry, 'id' | 'at'>): Promise<void> {
    const existing = (await this.config.getConfig('upgrade.history'))?.entries ?? [];
    const entry: UpgradeHistoryEntry = {
      ...step,
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
      error: step.error ? sanitizeError(step.error) : null,
    };
    await this.config.setConfig('upgrade.history', {
      entries: [entry, ...existing].slice(0, HISTORY_LIMIT),
    });
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may run upgrades');
    }
  }
}
