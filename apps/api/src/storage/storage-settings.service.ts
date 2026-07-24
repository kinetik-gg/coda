import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ApplyStorageConfig,
  StorageApplyResult,
  StorageConfigView,
  StorageConnectionInput,
  StorageProbeResult,
} from '@coda/contracts';
import { env } from '../config/env';
import { InstanceConfigService } from '../config/instance-config.service';
import type { StorageConnection } from '../config/instance-config-codecs';
import { PrismaService } from '../prisma/prisma.service';
import { StorageClientProvider } from './storage-client.provider';
import { StorageService } from './storage.service';
import { StorageValidationService } from './storage-validation.service';

/**
 * Administrator-facing orchestration for the storage settings wizard: it reports
 * the active backend and its provenance, runs the validation probe, and — only
 * after a clean probe and the explicit existing-objects gate — persists the
 * connection to the encrypted store and hot-swaps the live client in-process.
 * Nothing is persisted or swapped when the probe fails or the gate is unmet.
 *
 * When live objects exist the operator must choose: `start_empty` cuts over here,
 * while `migrate` is handled entirely by {@link StorageMigrationService} through
 * its own endpoint, so this service never silently cuts over on top of data.
 */
@Injectable()
export class StorageSettingsService {
  private readonly logger = new Logger(StorageSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instanceConfig: InstanceConfigService,
    private readonly validation: StorageValidationService,
    private readonly clients: StorageClientProvider,
    private readonly storage: StorageService,
  ) {}

  /** Redacted view of the active backend, its source, and live object count. */
  async describe(userId: string): Promise<StorageConfigView> {
    await this.assertAdministrator(userId);
    return this.view();
  }

  /** Runs the probe against a candidate connection. Never persists. */
  async validate(userId: string, input: StorageConnectionInput): Promise<StorageProbeResult> {
    await this.assertAdministrator(userId);
    return this.validation.probe(input);
  }

  /**
   * Validates, gates on existing objects, then persists and hot-swaps. Returns a
   * discriminated result rather than throwing so the UI always sees the probe
   * taxonomy and the gate choice.
   */
  async apply(userId: string, input: ApplyStorageConfig): Promise<StorageApplyResult> {
    await this.assertAdministrator(userId);
    const { existingObjects, ...connection } = input;

    const probe = await this.validation.probe(connection);
    if (!probe.ok) return { status: 'invalid', probe };

    const existingObjectCount = await this.countLiveObjects();
    // Cutover here is allowed only when the operator accepts starting empty (or no
    // live objects exist). The `migrate` choice is driven separately by the
    // verified migration job, so anything short of `start_empty` re-prompts rather
    // than risk a silent cutover on top of referenced data.
    if (existingObjectCount > 0 && existingObjects !== 'start_empty') {
      return { status: 'needs_choice', probe, existingObjectCount };
    }

    await this.persistAndSwap(connection, userId);
    return { status: 'applied', probe, config: await this.view() };
  }

  /** Drops the stored override and hot-swaps back to the environment backend. */
  async revert(userId: string): Promise<StorageConfigView> {
    await this.assertAdministrator(userId);
    await this.instanceConfig.deleteConfig('storage.connection');
    this.clients.revertToEnv();
    await this.storage.ensureBucket();
    return this.view();
  }

  private async persistAndSwap(connection: StorageConnection, userId: string): Promise<void> {
    await this.instanceConfig.setConfig('storage.connection', connection, userId);
    this.clients.swap(connection);
    await this.storage.ensureBucket();
    this.logger.log(`Storage backend applied and hot-swapped by ${userId}`);
  }

  private async view(): Promise<StorageConfigView> {
    const snapshot = this.clients.current();
    return {
      source: snapshot.source,
      provider: snapshot.provider,
      endpoint: snapshot.endpoint,
      publicEndpoint: snapshot.publicEndpoint,
      region: snapshot.region,
      bucket: snapshot.bucket,
      accessKeyId: snapshot.accessKeyId,
      forcePathStyle: snapshot.forcePathStyle,
      existingObjectCount: await this.countLiveObjects(),
      appOrigin: env().APP_ORIGIN,
    };
  }

  private countLiveObjects(): Promise<number> {
    return this.prisma.storageObject.count({ where: { deletedAt: null } });
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may manage storage settings');
    }
  }
}
