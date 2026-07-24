import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigEncryptionService } from './config-encryption.service';
import { configCodec, type ConfigKey, type ConfigValue } from './instance-config-codecs';
import { ConfigDecryptionError } from './instance-config-crypto';

/** Where an effective configuration value came from. */
export type ConfigSource = 'config' | 'env';

/** A resolved value paired with the source that supplied it. */
export interface ResolvedConfig<T> {
  value: T;
  source: ConfigSource;
}

/**
 * Typed, encrypted instance-configuration store.
 *
 * Values are validated by per-key Zod codecs, serialized, encrypted with
 * AES-256-GCM, and persisted as ciphertext plus a nonce. Reads decrypt, run any
 * schema-version migration required to reach the current shape, re-validate, and
 * transparently persist upgraded blobs so old rows are migrated rather than
 * orphaned. Consumers opt into overriding an environment default by calling
 * {@link resolve}, which reports whether the active value came from a config row
 * or the environment.
 */
@Injectable()
export class InstanceConfigService {
  private readonly logger = new Logger(InstanceConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: ConfigEncryptionService,
  ) {}

  /** Reads and decodes the value stored under `key`, or `undefined` if unset. */
  async getConfig<K extends ConfigKey>(key: K): Promise<ConfigValue<K> | undefined> {
    const row = await this.prisma.instanceConfig.findUnique({ where: { key } });
    if (!row) return undefined;

    const codec = configCodec(key);
    if (row.schemaVersion > codec.version) {
      throw new Error(
        `Instance config "${key}" was written by a newer application version (schema ${row.schemaVersion} > ${codec.version}). Refusing to downgrade.`,
      );
    }

    const decoded: unknown = JSON.parse(
      this.encryption.decrypt(Buffer.from(row.ciphertext), Buffer.from(row.nonce)),
    );

    if (row.schemaVersion < codec.version) {
      const migrated = codec.schema.parse(codec.migrate(decoded, row.schemaVersion));
      await this.persist(key, migrated, row.updatedBy ?? null);
      this.logger.log(
        `Migrated instance config "${key}" from schema ${row.schemaVersion} to ${codec.version}`,
      );
      return migrated as ConfigValue<K>;
    }

    return codec.schema.parse(decoded) as ConfigValue<K>;
  }

  /** Validates, encrypts, and persists `value` under `key` at the current schema version. */
  async setConfig<K extends ConfigKey>(
    key: K,
    value: ConfigValue<K>,
    updatedBy?: string | null,
  ): Promise<void> {
    const codec = configCodec(key);
    const validated = codec.schema.parse(value);
    await this.persist(key, validated, updatedBy ?? null);
  }

  /** Whether a config row exists for `key`. */
  async hasConfig<K extends ConfigKey>(key: K): Promise<boolean> {
    return (await this.prisma.instanceConfig.count({ where: { key } })) > 0;
  }

  /**
   * Resolves the effective value for `key`, preferring a stored config row over
   * the supplied environment default and reporting which source is active. This
   * is the explicit opt-in a feature uses to let a config row override its env
   * counterpart.
   */
  async resolve<K extends ConfigKey>(
    key: K,
    envDefault: ConfigValue<K>,
  ): Promise<ResolvedConfig<ConfigValue<K>>> {
    const stored = await this.getConfig(key);
    return stored === undefined
      ? { value: envDefault, source: 'env' }
      : { value: stored, source: 'config' };
  }

  /**
   * Fail-closed boot guard. When configuration rows exist, verifies the
   * encryption key is present and correct by decrypting one row, turning a
   * missing or wrong key into an actionable boot failure rather than silent data
   * loss. A no-op when the store is empty.
   */
  async assertReadableAtBoot(): Promise<void> {
    const probe = await this.prisma.instanceConfig.findFirst({
      orderBy: { key: 'asc' },
    });
    if (!probe) return;

    if (!this.encryption.configured) {
      throw new Error(
        'Encrypted instance configuration exists but CONFIG_ENCRYPTION_KEY is not set. Provide the same 32+ byte base64 key used to write it; without it these settings cannot be decrypted.',
      );
    }

    try {
      this.encryption.decrypt(Buffer.from(probe.ciphertext), Buffer.from(probe.nonce));
    } catch (error) {
      if (error instanceof ConfigDecryptionError) {
        throw new Error(
          `CONFIG_ENCRYPTION_KEY does not match the key that encrypted instance config "${probe.key}". Restore the original key; refusing to start to avoid data loss.`,
        );
      }
      throw error;
    }
  }

  private async persist<K extends ConfigKey>(
    key: K,
    value: ConfigValue<K>,
    updatedBy: string | null,
  ): Promise<void> {
    const codec = configCodec(key);
    const { ciphertext, nonce } = this.encryption.encrypt(JSON.stringify(value));
    // Prisma's Bytes maps to Uint8Array<ArrayBuffer>; copy Node Buffers into that shape.
    const ciphertextBytes = new Uint8Array(ciphertext);
    const nonceBytes = new Uint8Array(nonce);
    await this.prisma.instanceConfig.upsert({
      where: { key },
      create: {
        key,
        schemaVersion: codec.version,
        ciphertext: ciphertextBytes,
        nonce: nonceBytes,
        updatedBy,
      },
      update: {
        schemaVersion: codec.version,
        ciphertext: ciphertextBytes,
        nonce: nonceBytes,
        updatedBy,
      },
    });
  }
}
