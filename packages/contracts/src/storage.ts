import { z } from 'zod';

// --- Storage settings wizard -------------------------------------------------
// Object-storage backend selection, live validation, and runtime hot-swap.

export const STORAGE_PROVIDER_PRESETS = ['minio', 'r2', 's3', 'spaces', 'generic'] as const;
export const storageProviderPresetSchema = z.enum(STORAGE_PROVIDER_PRESETS);
export type StorageProviderPreset = z.infer<typeof storageProviderPresetSchema>;

const s3EndpointSchema = z.string().trim().url().max(2048);
const s3OriginSchema = s3EndpointSchema.refine(
  (value) => new URL(value).origin === value,
  'Expected an origin without a path',
);

/**
 * A complete object-storage connection as entered in the wizard. Includes the
 * secret access key because the same shape is persisted (encrypted) by the API's
 * schema-versioned codec; responses never echo the secret back.
 */
export const storageConnectionInputSchema = z.object({
  provider: storageProviderPresetSchema,
  endpoint: s3EndpointSchema,
  publicEndpoint: s3OriginSchema,
  region: z.string().trim().min(1).max(64),
  bucket: z.string().trim().min(3).max(63),
  accessKeyId: z.string().trim().min(1).max(256),
  secretAccessKey: z.string().min(1).max(256),
  forcePathStyle: z.boolean(),
});
export type StorageConnectionInput = z.infer<typeof storageConnectionInputSchema>;

export const validateStorageConfigSchema = storageConnectionInputSchema;

/**
 * The explicit choice an operator must make when live objects exist in the
 * current backend before a cutover is allowed. Silent cutover is forbidden.
 */
export const storageExistingObjectsChoiceSchema = z.enum(['start_empty', 'migrate']);
export type StorageExistingObjectsChoice = z.infer<typeof storageExistingObjectsChoiceSchema>;

export const applyStorageConfigSchema = storageConnectionInputSchema.extend({
  existingObjects: storageExistingObjectsChoiceSchema.optional(),
});
export type ApplyStorageConfig = z.infer<typeof applyStorageConfigSchema>;

export const STORAGE_PROBE_CHECK_NAMES = ['write', 'read', 'delete', 'presign', 'cors'] as const;
export const storageProbeCheckNameSchema = z.enum(STORAGE_PROBE_CHECK_NAMES);
export type StorageProbeCheckName = z.infer<typeof storageProbeCheckNameSchema>;

export const storageProbeCheckSchema = z.object({
  name: storageProbeCheckNameSchema,
  ok: z.boolean(),
  detail: z.string().max(500),
});
export type StorageProbeCheck = z.infer<typeof storageProbeCheckSchema>;

export const storageProbeResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(storageProbeCheckSchema),
});
export type StorageProbeResult = z.infer<typeof storageProbeResultSchema>;

/** Where the active storage configuration was resolved from. */
export type StorageConfigSource = 'env' | 'config';

/** Redacted view of the active storage configuration for the settings screen. */
export interface StorageConfigView {
  source: StorageConfigSource;
  provider: StorageProviderPreset | null;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  existingObjectCount: number;
  appOrigin: string;
}

/**
 * Result of an apply request. `invalid` means the probe failed and nothing was
 * saved; `needs_choice` means live objects exist and the operator must pick a
 * path (start empty here, or migrate via the verified migration job); `applied`
 * means the backend was persisted and hot-swapped.
 */
export type StorageApplyStatus = 'applied' | 'invalid' | 'needs_choice';

export interface StorageApplyResult {
  status: StorageApplyStatus;
  probe: StorageProbeResult;
  config?: StorageConfigView;
  existingObjectCount?: number;
}

// --- Verified object migration -----------------------------------------------
// Moves every referenced object to a probe-validated target with a written
// verification report, then an explicit operator-confirmed cutover. Progress and
// the report are surfaced in the Storage section; the source is left untouched
// until — and after — cutover, so an interrupted migration is always safe.

/** Lifecycle of an in-flight or finished migration. `idle` means none exists. */
export const storageMigrationPhaseSchema = z.enum([
  'copying',
  'verifying',
  'verified',
  'failed',
  'cutover',
  'cancelled',
]);
export type StorageMigrationPhase = z.infer<typeof storageMigrationPhaseSchema>;

/** Why a single object failed verification against the database record or source. */
export const storageMigrationMismatchKindSchema = z.enum(['missing', 'size', 'checksum', 'error']);
export type StorageMigrationMismatchKind = z.infer<typeof storageMigrationMismatchKindSchema>;

export const storageMigrationMismatchSchema = z.object({
  objectKey: z.string().max(1024),
  kind: storageMigrationMismatchKindSchema,
  detail: z.string().max(500),
});
export type StorageMigrationMismatch = z.infer<typeof storageMigrationMismatchSchema>;

/** Upper bound on mismatches retained in the report so the encrypted blob stays bounded. */
export const STORAGE_MIGRATION_MAX_MISMATCHES = 200;

export const storageMigrationReportSchema = z.object({
  generatedAt: z.string(),
  totalObjects: z.number().int().min(0),
  verifiedObjects: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  mismatches: z.array(storageMigrationMismatchSchema).max(STORAGE_MIGRATION_MAX_MISMATCHES),
});
export type StorageMigrationReport = z.infer<typeof storageMigrationReportSchema>;

/** Redacted view of the migration target for the browser; never the secret key. */
export interface StorageMigrationTargetView {
  provider: StorageProviderPreset;
  endpoint: string;
  bucket: string;
}

/** Redacted migration state polled by the Storage section. */
export interface StorageMigrationStatus {
  phase: StorageMigrationPhase | 'idle';
  target: StorageMigrationTargetView | null;
  copiedObjects: number;
  totalObjects: number;
  copiedBytes: number;
  totalBytes: number;
  verifiedObjects: number;
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  report: StorageMigrationReport | null;
  /** True only when every referenced object verified with zero mismatches. */
  canCutover: boolean;
}

/** Body of a start-migration request: the full, probe-validated target connection. */
export const startStorageMigrationSchema = storageConnectionInputSchema;
export type StartStorageMigration = z.infer<typeof startStorageMigrationSchema>;
