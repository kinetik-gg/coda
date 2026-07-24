/** Live object-storage entry discovered while enumerating the bucket. */
export interface ObjectStoreEntry {
  key: string;
  size: number;
}

/**
 * Database side of the backup engine. Implementations shell out to
 * `pg_dump`/`pg_restore` (custom format) inside the runtime container; unit tests
 * substitute in-memory fakes.
 */
export interface DatabaseBackupEngine {
  /** True once the instance has an owner; restore refuses initialized instances. */
  isInitialized(): Promise<boolean>;
  /** Writes a consistent custom-format dump to the staged path. */
  dumpTo(path: string): Promise<void>;
  /** Restores a staged custom-format dump, replacing the target schema. */
  restoreFrom(path: string): Promise<void>;
}

/** Object-storage side of the backup engine. */
export interface ObjectBackupStore {
  bucket(): string;
  /** True when the bucket holds no objects; restore refuses non-empty buckets. */
  isEmpty(): Promise<boolean>;
  list(): Promise<ObjectStoreEntry[]>;
  downloadTo(key: string, path: string): Promise<void>;
  upload(key: string, path: string, size: number): Promise<void>;
}

export type BackupPhase =
  | 'dump-database'
  | 'collect-object'
  | 'write-archive'
  | 'verify-archive'
  | 'restore-database'
  | 'restore-object'
  | 'complete';

export interface BackupProgress {
  phase: BackupPhase;
  /** Object key or archive entry the phase is acting on, when applicable. */
  key?: string;
  /** 1-based index within the current collection, when applicable. */
  index?: number;
  total?: number;
}

export type BackupProgressListener = (progress: BackupProgress) => void;
