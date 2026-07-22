import type { ScreenplayPaperSize } from './screenplay-paper';

export const SCREENPLAY_RECOVERY_SCHEMA_VERSION = 1 as const;
export const SCREENPLAY_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const DATABASE_NAME = 'coda-screenplay-recovery';
const DATABASE_VERSION = 1;
const STORE_NAME = 'screenplay-drafts';

export interface ScreenplayRecoverySnapshot {
  schemaVersion: typeof SCREENPLAY_RECOVERY_SCHEMA_VERSION;
  accountId: string;
  screenplayId: string;
  baseServerVersion: number;
  sourceText: string;
  paperSize: ScreenplayPaperSize;
  updatedAt: number;
  contentHash: string;
}

interface StoredScreenplayRecovery extends ScreenplayRecoverySnapshot {
  key: string;
}

export interface ScreenplayRecoveryStore {
  read(
    accountId: string,
    screenplayId: string,
    now?: number,
  ): Promise<ScreenplayRecoverySnapshot | undefined>;
  save(snapshot: ScreenplayRecoverySnapshot): Promise<void>;
  remove(
    accountId: string,
    screenplayId: string,
    expected?: Pick<ScreenplayRecoverySnapshot, 'contentHash' | 'paperSize' | 'sourceText'>,
  ): Promise<void>;
}

export async function createScreenplayRecoverySnapshot(input: {
  accountId: string;
  screenplayId: string;
  baseServerVersion: number;
  sourceText: string;
  paperSize: ScreenplayPaperSize;
  updatedAt?: number;
}): Promise<ScreenplayRecoverySnapshot> {
  return Object.freeze({
    schemaVersion: SCREENPLAY_RECOVERY_SCHEMA_VERSION,
    accountId: input.accountId,
    screenplayId: input.screenplayId,
    baseServerVersion: input.baseServerVersion,
    sourceText: input.sourceText,
    paperSize: input.paperSize,
    updatedAt: input.updatedAt ?? Date.now(),
    contentHash: await screenplayRecoveryContentHash(input.sourceText, input.paperSize),
  });
}

export async function screenplayRecoveryContentHash(
  sourceText: string,
  paperSize: ScreenplayPaperSize,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${paperSize}\u0000${sourceText}`);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${hex(new Uint8Array(digest))}`;
  }
  return `fnv1a32:${fnv1a32(bytes)}`;
}

export const indexedDbScreenplayRecoveryStore: ScreenplayRecoveryStore = {
  async read(accountId, screenplayId, now = Date.now()) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await purgeExpired(store, now - SCREENPLAY_RECOVERY_TTL_MS);
    const record = await requestResult<StoredScreenplayRecovery | undefined>(
      store.get(recoveryKey(accountId, screenplayId)) as IDBRequest<
        StoredScreenplayRecovery | undefined
      >,
    );
    await transactionDone(transaction);
    database.close();
    return record && !isScreenplayRecoveryExpired(record, now) ? publicSnapshot(record) : undefined;
  },

  async save(snapshot) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      ...snapshot,
      key: recoveryKey(snapshot.accountId, snapshot.screenplayId),
    } satisfies StoredScreenplayRecovery);
    await transactionDone(transaction);
    database.close();
  },

  async remove(accountId, screenplayId, expected) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const key = recoveryKey(accountId, screenplayId);
    const record = await requestResult<StoredScreenplayRecovery | undefined>(
      store.get(key) as IDBRequest<StoredScreenplayRecovery | undefined>,
    );
    if (record && (!expected || recoveryMatches(record, expected))) {
      store.delete(key);
    }
    await transactionDone(transaction);
    database.close();
  },
};

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
    request.addEventListener('blocked', () => reject(new Error('IndexedDB upgrade is blocked')), {
      once: true,
    });
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB aborted')),
      {
        once: true,
      },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
  });
}

function recoveryKey(accountId: string, screenplayId: string): string {
  return `${accountId}:${screenplayId}`;
}

function publicSnapshot(record: StoredScreenplayRecovery): ScreenplayRecoverySnapshot {
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    accountId: record.accountId,
    screenplayId: record.screenplayId,
    baseServerVersion: record.baseServerVersion,
    sourceText: record.sourceText,
    paperSize: record.paperSize,
    updatedAt: record.updatedAt,
    contentHash: record.contentHash,
  });
}

function recoveryMatches(
  record: ScreenplayRecoverySnapshot,
  expected: Pick<ScreenplayRecoverySnapshot, 'contentHash' | 'paperSize' | 'sourceText'>,
): boolean {
  return (
    record.contentHash === expected.contentHash &&
    record.paperSize === expected.paperSize &&
    record.sourceText === expected.sourceText
  );
}

export function isScreenplayRecoveryExpired(
  snapshot: ScreenplayRecoverySnapshot,
  now: number,
): boolean {
  return snapshot.updatedAt + SCREENPLAY_RECOVERY_TTL_MS <= now;
}

function purgeExpired(store: IDBObjectStore, cutoff: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index('updatedAt').openKeyCursor(IDBKeyRange.upperBound(cutoff));
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x81_1c_9d_c5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
