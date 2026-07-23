import {
  indexedDbScreenplayRecoveryStore,
  type ScreenplayRecoveryStore,
} from './screenplay-recovery-store';

export const SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY =
  'coda:screenplay-recovery-cleanup-accounts:v1';

const MAX_PENDING_ACCOUNTS = 32;
const MAX_ACCOUNT_ID_LENGTH = 256;
const MAX_MARKER_LENGTH = 8_192;

type CleanupMarkerStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export async function purgeScreenplayRecoveryForLogout(
  accountId: string,
  store: ScreenplayRecoveryStore = indexedDbScreenplayRecoveryStore,
  storage: CleanupMarkerStorage | undefined = browserMarkerStorage(),
): Promise<boolean> {
  let markerRecorded = false;
  try {
    await store.purgeAccount(accountId);
    forgetPendingAccount(accountId, storage);
    return true;
  } catch {
    markerRecorded = rememberPendingAccount(accountId, storage);
  }

  // Retry once in case a transaction was briefly blocked, then delete the
  // entire recovery database. Account drafts must not survive explicit logout.
  try {
    await store.purgeAccount(accountId);
    forgetPendingAccount(accountId, storage);
    return true;
  } catch {
    try {
      await store.purgeAll();
      forgetPendingAccount(accountId, storage);
      return true;
    } catch {
      if (!markerRecorded) rememberPendingAccount(accountId, storage);
      return false;
    }
  }
}

export async function retryPendingScreenplayRecoveryCleanup(
  store: ScreenplayRecoveryStore = indexedDbScreenplayRecoveryStore,
  storage: CleanupMarkerStorage | undefined = browserMarkerStorage(),
): Promise<void> {
  for (const accountId of pendingAccounts(storage)) {
    try {
      await store.purgeAccount(accountId);
      forgetPendingAccount(accountId, storage);
    } catch {
      // Keep the non-sensitive account marker for the next application start.
    }
  }
}

function rememberPendingAccount(
  accountId: string,
  storage: CleanupMarkerStorage | undefined,
): boolean {
  const normalized = validAccountId(accountId);
  if (!normalized || !storage) return false;
  const accounts = pendingAccounts(storage).filter((candidate) => candidate !== normalized);
  accounts.push(normalized);
  try {
    storage.setItem(
      SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY,
      JSON.stringify(accounts.slice(-MAX_PENDING_ACCOUNTS)),
    );
    return true;
  } catch {
    return false;
  }
}

function forgetPendingAccount(accountId: string, storage: CleanupMarkerStorage | undefined): void {
  if (!storage) return;
  const accounts = pendingAccounts(storage).filter((candidate) => candidate !== accountId);
  try {
    if (accounts.length) {
      storage.setItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY, JSON.stringify(accounts));
    } else {
      storage.removeItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY);
    }
  } catch {
    // Cleanup markers are best-effort when browser storage is unavailable.
  }
}

function pendingAccounts(storage: CleanupMarkerStorage | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY);
    if (!raw) return [];
    if (raw.length > MAX_MARKER_LENGTH) {
      storage.removeItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY);
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new TypeError('Invalid recovery cleanup marker');
    return [
      ...new Set(parsed.map(validAccountId).filter((value): value is string => Boolean(value))),
    ].slice(-MAX_PENDING_ACCOUNTS);
  } catch {
    try {
      storage.removeItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY);
    } catch {
      // Browser storage is unavailable; there is no readable marker to retry.
    }
    return [];
  }
}

function validAccountId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_ACCOUNT_ID_LENGTH ? normalized : undefined;
}

function browserMarkerStorage(): CleanupMarkerStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
