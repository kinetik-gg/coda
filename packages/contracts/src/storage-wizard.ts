import { z } from 'zod';

// --- Storage settings wizard -------------------------------------------------
// Object-storage backend selection, live validation, and runtime hot-swap.
// Kept in a leaf module (only depends on zod) so both the main contract surface
// and the scheduled-backup contracts can reuse it without a circular import.

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

/**
 * The behavioural contract a blob-store backend advertises so callers negotiate
 * capabilities instead of assuming S3 semantics. `directUpload` is the
 * load-bearing flag: when true the client is handed a URL to upload straight to
 * the backend (an S3 presigned PUT); when false uploads are proxied through the
 * app, which enforces the same size/type checks the S3 HEAD-after-PUT did.
 */
export interface BlobStoreCapabilities {
  /** The backend can issue a URL the browser uploads to directly (S3 presigned PUT). */
  directUpload: boolean;
  /** Reads are served via a signed URL to the backend rather than proxied bytes. */
  presignedRead: boolean;
}

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
  /** Capabilities of the active backend, so the UI can negotiate upload/read paths. */
  capabilities: BlobStoreCapabilities;
}

/**
 * Result of an apply request. `invalid` means the probe failed and nothing was
 * saved; `needs_choice` means live objects exist and the operator must pick a
 * path; `migration_pending` acknowledges migration is a separate, not-yet-shipped
 * job; `applied` means the backend was persisted and hot-swapped.
 */
export type StorageApplyStatus = 'applied' | 'invalid' | 'needs_choice' | 'migration_pending';

export interface StorageApplyResult {
  status: StorageApplyStatus;
  probe: StorageProbeResult;
  config?: StorageConfigView;
  existingObjectCount?: number;
}
