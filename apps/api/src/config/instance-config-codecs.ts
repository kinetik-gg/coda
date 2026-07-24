import { z } from 'zod';

/**
 * Registry of typed, schema-versioned codecs for the instance-configuration
 * store. Each key owns a Zod schema describing its current shape, a
 * monotonically increasing `version`, and a `migrate` hook that upgrades a blob
 * written under an older version to the current shape. Because stored blobs
 * carry the version they were written with, a shape change ships a new version
 * plus a migration step instead of orphaning existing rows.
 */

export interface ConfigCodec<T> {
  /** Current schema version persisted alongside new writes. */
  readonly version: number;
  /** Validator for the current shape. */
  readonly schema: z.ZodType<T>;
  /**
   * Upgrades a decoded blob written under `fromVersion` to the current shape.
   * Called only when `fromVersion < version`; the result is re-validated by the
   * service against {@link schema}.
   */
  migrate(raw: unknown, fromVersion: number): unknown;
}

// storage.settings — object-storage tuning that may be adjusted at runtime.
const storageSettingsSchema = z.object({
  uploadRetentionHours: z.number().int().min(1).max(720),
  pendingMaxObjects: z.number().int().min(1).max(10_000),
});
export type StorageSettings = z.infer<typeof storageSettingsSchema>;

// backup.schedule — cron-style backup cadence and retention.
const backupScheduleSchema = z.object({
  cron: z.string().min(1).max(120),
  retainDays: z.number().int().min(1).max(3_650),
});
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

// update.preferences — evolves from v1 { channel } to v2 { channel, autoApply }.
const updatePreferencesSchema = z.object({
  channel: z.enum(['stable', 'beta']),
  autoApply: z.boolean(),
});
export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;

const updatePreferencesV1Schema = z.object({ channel: z.enum(['stable', 'beta']) });

// update.pollInterval — overrides UPDATE_CHECK_INTERVAL_HOURS for the release checker's
// background poll cadence. `hours: null` means "follow the environment default"; `0`
// explicitly disables polling; any other value is a custom cadence in hours.
const updatePollIntervalSchema = z.object({ hours: z.number().int().min(0).max(8_760).nullable() });
export type UpdatePollInterval = z.infer<typeof updatePollIntervalSchema>;

// update.dismissedRelease — the most recent release version an owner dismissed from the
// in-app update banner, so the dismissal survives across sessions and devices.
const updateDismissedReleaseSchema = z.object({ version: z.string().min(1).max(64).nullable() });
export type UpdateDismissedRelease = z.infer<typeof updateDismissedReleaseSchema>;

/**
 * Map of every configurable key to its codec. Adding a key here is all that is
 * required for {@link import('./instance-config.service').InstanceConfigService}
 * to store and read it with full type safety.
 */
export const CONFIG_CODECS = {
  'storage.settings': {
    version: 1,
    schema: storageSettingsSchema,
    migrate: (raw) => raw,
  } satisfies ConfigCodec<StorageSettings>,
  'backup.schedule': {
    version: 1,
    schema: backupScheduleSchema,
    migrate: (raw) => raw,
  } satisfies ConfigCodec<BackupSchedule>,
  'update.preferences': {
    version: 2,
    schema: updatePreferencesSchema,
    migrate: (raw, fromVersion) => {
      if (fromVersion < 2) {
        const legacy = updatePreferencesV1Schema.parse(raw);
        return { channel: legacy.channel, autoApply: false } satisfies UpdatePreferences;
      }
      return raw;
    },
  } satisfies ConfigCodec<UpdatePreferences>,
  'update.pollInterval': {
    version: 1,
    schema: updatePollIntervalSchema,
    migrate: (raw) => raw,
  } satisfies ConfigCodec<UpdatePollInterval>,
  'update.dismissedRelease': {
    version: 1,
    schema: updateDismissedReleaseSchema,
    migrate: (raw) => raw,
  } satisfies ConfigCodec<UpdateDismissedRelease>,
} as const;

export type ConfigKey = keyof typeof CONFIG_CODECS;

/** Runtime type of the value stored under `key`. */
export type ConfigValue<K extends ConfigKey> = z.infer<(typeof CONFIG_CODECS)[K]['schema']>;

/**
 * Returns the codec for `key` widened to `ConfigCodec<ConfigValue<K>>`. The
 * widening lets callers use `schema.parse` and `migrate` with a single value
 * type instead of the union produced by indexing the heterogeneous registry.
 */
export function configCodec<K extends ConfigKey>(key: K): ConfigCodec<ConfigValue<K>> {
  return CONFIG_CODECS[key] as unknown as ConfigCodec<ConfigValue<K>>;
}
