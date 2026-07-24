import { Injectable } from '@nestjs/common';
import type {
  ScheduledBackupDestinationInput,
  ScheduledBackupDestinationView,
  StorageProbeResult,
} from '@coda/contracts';
import { InstanceConfigService } from '../../config/instance-config.service';
import { StorageClientProvider } from '../../storage/storage-client.provider';
import { StorageValidationService } from '../../storage/storage-validation.service';
import { SCHEDULED_BACKUP_PREFIX } from './scheduled-backup-destination';

/**
 * Manages the scheduled-backup destination: the redacted view, the validation
 * probe, and the encrypted override row. Extracted from the orchestration
 * service so the collaborators it needs (storage clients and the validation
 * probe) stay off the service's constructor.
 */
@Injectable()
export class ScheduledBackupDestinationManager {
  constructor(
    private readonly instanceConfig: InstanceConfigService,
    private readonly validation: StorageValidationService,
    private readonly clients: StorageClientProvider,
  ) {}

  /** Redacted view of where scheduled archives are written. */
  async describe(): Promise<ScheduledBackupDestinationView> {
    const override = await this.instanceConfig.getConfig('backup.destination');
    if (override) {
      return {
        source: 'override',
        provider: override.provider,
        endpoint: override.endpoint,
        bucket: override.bucket,
        prefix: SCHEDULED_BACKUP_PREFIX,
        forcePathStyle: override.forcePathStyle,
      };
    }
    const snapshot = this.clients.current();
    return {
      source: 'active',
      provider: snapshot.provider,
      endpoint: snapshot.endpoint,
      bucket: snapshot.bucket,
      prefix: SCHEDULED_BACKUP_PREFIX,
      forcePathStyle: snapshot.forcePathStyle,
    };
  }

  /** Runs the validation probe against a candidate override. Never persists. */
  probe(input: ScheduledBackupDestinationInput): Promise<StorageProbeResult> {
    return this.validation.probe(input);
  }

  /** Probes then, only on a clean probe, persists the override. */
  async persist(
    input: ScheduledBackupDestinationInput,
    updatedBy: string,
  ): Promise<{ probe: StorageProbeResult; applied: boolean }> {
    const probe = await this.validation.probe(input);
    if (!probe.ok) return { probe, applied: false };
    await this.instanceConfig.setConfig('backup.destination', input, updatedBy);
    return { probe, applied: true };
  }

  /** Removes the override so archives return to the active storage backend. */
  async clear(): Promise<void> {
    await this.instanceConfig.deleteConfig('backup.destination');
  }
}
