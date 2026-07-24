import { z } from 'zod';
import { storageConnectionInputSchema } from './storage-wizard';
import type { StorageProviderPreset } from './storage-wizard';

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
