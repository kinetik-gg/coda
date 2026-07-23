// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenplayRecoveryStore } from './screenplay-recovery-store';
import {
  purgeScreenplayRecoveryForLogout,
  retryPendingScreenplayRecoveryCleanup,
  SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY,
} from './screenplay-recovery-cleanup';

const accountId = '10000000-0000-4000-8000-000000000001';

beforeEach(() => {
  localStorage.clear();
});

describe('screenplay recovery account cleanup', () => {
  it('records only the account id when logout purge fails', async () => {
    const store = recoveryStore();
    store.purgeAccount.mockRejectedValue(new Error('IndexedDB blocked'));
    store.purgeAll.mockRejectedValue(new Error('Database deletion blocked'));

    await expect(purgeScreenplayRecoveryForLogout(accountId, store, localStorage)).resolves.toBe(
      false,
    );

    expect(store.purgeAccount).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY)).toBe(
      JSON.stringify([accountId]),
    );
  });

  it('retries marked account purges at startup and removes successful markers', async () => {
    const store = recoveryStore();
    store.purgeAccount
      .mockRejectedValueOnce(new Error('IndexedDB blocked'))
      .mockResolvedValueOnce(undefined);
    await purgeScreenplayRecoveryForLogout(accountId, store, localStorage);

    await retryPendingScreenplayRecoveryCleanup(store, localStorage);

    expect(store.purgeAccount).toHaveBeenCalledTimes(2);
    expect(store.purgeAccount).toHaveBeenLastCalledWith(accountId);
    expect(localStorage.getItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY)).toBeNull();
  });

  it('deletes the recovery database when account-scoped deletion cannot be confirmed', async () => {
    const store = recoveryStore();
    store.purgeAccount.mockRejectedValue(new Error('IndexedDB blocked'));

    await expect(purgeScreenplayRecoveryForLogout(accountId, store, localStorage)).resolves.toBe(
      true,
    );

    expect(store.purgeAccount).toHaveBeenCalledTimes(2);
    expect(store.purgeAll).toHaveBeenCalledOnce();
    expect(localStorage.getItem(SCREENPLAY_RECOVERY_CLEANUP_MARKER_KEY)).toBeNull();
  });

  it('uses one bounded purge retry when marker storage is unavailable', async () => {
    const store = recoveryStore();
    store.purgeAccount
      .mockRejectedValueOnce(new Error('IndexedDB blocked'))
      .mockResolvedValueOnce(undefined);
    const blockedStorage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(() => undefined),
      setItem: vi.fn(() => {
        throw new Error('Storage blocked');
      }),
    };

    await expect(purgeScreenplayRecoveryForLogout(accountId, store, blockedStorage)).resolves.toBe(
      true,
    );
    expect(store.purgeAccount).toHaveBeenCalledTimes(2);
  });
});

function recoveryStore() {
  const purgeAccount = vi.fn<(accountId: string) => Promise<void>>(() => Promise.resolve());
  return {
    read: vi.fn(),
    save: vi.fn(),
    purgeExpired: vi.fn(),
    purgeAccount,
    purgeAll: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    remove: vi.fn(),
  } satisfies ScreenplayRecoveryStore;
}
