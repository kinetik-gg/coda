import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { env } from '../config/env';
import { InstanceConfigService } from '../config/instance-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReleaseCheckerService } from './release-checker.service';
import type { ReleaseCheckStatus } from './release-checker.types';

/** Where the effective poll cadence came from. */
export type UpdatePollingSource = 'config' | 'env';

export interface UpdatesPollingInfo {
  /** The UPDATE_CHECK_INTERVAL_HOURS environment default. */
  envDefaultHours: number;
  /** The stored override, or `null` when no override is configured. */
  overrideHours: number | null;
  /** The cadence currently in force: the override when set, otherwise the env default. */
  effectiveHours: number;
  source: UpdatePollingSource;
}

export interface UpdatesStatus extends ReleaseCheckStatus {
  polling: UpdatesPollingInfo;
  /** The release version last dismissed from the update banner, or `null`. */
  dismissedVersion: string | null;
}

/**
 * Owner-facing surface over the release checker: composes its status with the
 * instance-config-backed polling preference and per-version banner dismissal,
 * and gates every operation to the instance administrator. The release
 * checker's background scheduler itself is fixed by `UPDATE_CHECK_INTERVAL_HOURS`
 * at boot; a stored override here changes what the Updates section reports and
 * takes effect for the scheduler on the next application start.
 */
@Injectable()
export class UpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly releaseChecker: ReleaseCheckerService,
    private readonly config: InstanceConfigService,
  ) {}

  /** Current status without triggering a network call. */
  async status(userId: string): Promise<UpdatesStatus> {
    await this.assertAdministrator(userId);
    return this.compose(await this.releaseChecker.status());
  }

  /** Runs an on-demand check and returns the fresh, composed status. */
  async check(userId: string): Promise<UpdatesStatus> {
    await this.assertAdministrator(userId);
    return this.compose(await this.releaseChecker.check());
  }

  /** Sets or clears the polling-interval override; `null` reverts to the environment default. */
  async setPollingPreference(userId: string, hours: number | null): Promise<UpdatesStatus> {
    await this.assertAdministrator(userId);
    await this.config.setConfig('update.pollInterval', { hours }, userId);
    return this.compose(await this.releaseChecker.status());
  }

  /** Records `version` as dismissed from the update banner for this instance. */
  async dismissRelease(userId: string, version: string): Promise<UpdatesStatus> {
    await this.assertAdministrator(userId);
    await this.config.setConfig('update.dismissedRelease', { version }, userId);
    return this.compose(await this.releaseChecker.status());
  }

  private async compose(status: ReleaseCheckStatus): Promise<UpdatesStatus> {
    const [override, dismissed] = await Promise.all([
      this.config.getConfig('update.pollInterval'),
      this.config.getConfig('update.dismissedRelease'),
    ]);
    const envDefaultHours = env().UPDATE_CHECK_INTERVAL_HOURS;
    const overrideHours = override?.hours ?? null;
    return {
      ...status,
      polling: {
        envDefaultHours,
        overrideHours,
        effectiveHours: overrideHours ?? envDefaultHours,
        source: overrideHours === null ? 'env' : 'config',
      },
      dismissedVersion: dismissed?.version ?? null,
    };
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may manage updates');
    }
  }
}
