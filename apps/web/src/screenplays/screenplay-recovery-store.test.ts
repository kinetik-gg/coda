// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  createScreenplayRecoverySnapshot,
  indexedDbScreenplayRecoveryStore,
  isScreenplayRecoveryExpired,
  SCREENPLAY_RECOVERY_SCHEMA_VERSION,
  SCREENPLAY_RECOVERY_TTL_MS,
  type ScreenplayRecoverySnapshot,
} from './screenplay-recovery-store';

function installIndexedDb() {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
}

async function storedRecordCount(): Promise<number> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('coda-screenplay-recovery', 2);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
  });
  const transaction = database.transaction('screenplay-drafts', 'readonly');
  const count = await new Promise<number>((resolve, reject) => {
    const request = transaction.objectStore('screenplay-drafts').count();
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      {
        once: true,
      },
    );
  });
  database.close();
  return count;
}

async function seedLegacyDatabase(snapshot: ScreenplayRecoverySnapshot): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('coda-screenplay-recovery', 1);
    request.addEventListener('upgradeneeded', () => {
      const store = request.result.createObjectStore('screenplay-drafts', { keyPath: 'key' });
      store.createIndex('updatedAt', 'updatedAt');
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB failed')),
      { once: true },
    );
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('screenplay-drafts', 'readwrite');
    transaction.objectStore('screenplay-drafts').put({ ...snapshot, key: 'legacy-key' });
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB failed')),
      { once: true },
    );
  });
  database.close();
}

describe('screenplay recovery records', () => {
  it('records scope, server base, paper size, timestamp, schema, and a deterministic content hash', async () => {
    vi.stubGlobal('crypto', {});
    const first = await createScreenplayRecoverySnapshot({
      accountId: 'account-a',
      screenplayId: 'screenplay-a',
      baseServerVersion: 7,
      sourceText: 'INT. ROOM - DAY',
      paperSize: 'a4',
      updatedAt: 100,
    });
    const second = await createScreenplayRecoverySnapshot({
      accountId: 'account-a',
      screenplayId: 'screenplay-a',
      baseServerVersion: 8,
      sourceText: 'INT. ROOM - DAY',
      paperSize: 'a4',
      updatedAt: 200,
    });

    expect(first).toMatchObject({
      schemaVersion: SCREENPLAY_RECOVERY_SCHEMA_VERSION,
      accountId: 'account-a',
      screenplayId: 'screenplay-a',
      baseServerVersion: 7,
      paperSize: 'a4',
      updatedAt: 100,
    });
    expect(first.contentHash).toMatch(/^fnv1a32:/u);
    expect(second.contentHash).toBe(first.contentHash);
    vi.unstubAllGlobals();
  });

  it('expires a recovery snapshot at the bounded retention deadline', async () => {
    const snapshot = await createScreenplayRecoverySnapshot({
      accountId: 'account-a',
      screenplayId: 'screenplay-a',
      baseServerVersion: 1,
      sourceText: 'Draft',
      paperSize: 'letter',
      updatedAt: 1_000,
    });

    expect(isScreenplayRecoveryExpired(snapshot, 1_000 + SCREENPLAY_RECOVERY_TTL_MS - 1)).toBe(
      false,
    );
    expect(isScreenplayRecoveryExpired(snapshot, 1_000 + SCREENPLAY_RECOVERY_TTL_MS)).toBe(true);
  });

  it('proactively purges expired records on save and explicit startup cleanup', async () => {
    installIndexedDb();
    const now = Date.now();
    const expired = await createScreenplayRecoverySnapshot({
      accountId: 'account-a',
      screenplayId: 'expired-a',
      baseServerVersion: 1,
      sourceText: 'Expired A',
      paperSize: 'letter',
      updatedAt: now - SCREENPLAY_RECOVERY_TTL_MS,
    });
    await indexedDbScreenplayRecoveryStore.save(expired);
    expect(await storedRecordCount()).toBe(1);

    const current = await createScreenplayRecoverySnapshot({
      accountId: 'account-a',
      screenplayId: 'current',
      baseServerVersion: 1,
      sourceText: 'Current',
      paperSize: 'a4',
      updatedAt: now,
    });
    await indexedDbScreenplayRecoveryStore.save(current);
    expect(await storedRecordCount()).toBe(1);

    const expiredAgain = await createScreenplayRecoverySnapshot({
      accountId: 'account-b',
      screenplayId: 'expired-b',
      baseServerVersion: 1,
      sourceText: 'Expired B',
      paperSize: 'letter',
      updatedAt: now - SCREENPLAY_RECOVERY_TTL_MS,
    });
    await indexedDbScreenplayRecoveryStore.save(expiredAgain);
    expect(await storedRecordCount()).toBe(2);
    await indexedDbScreenplayRecoveryStore.purgeExpired(now);
    expect(await storedRecordCount()).toBe(1);
  });

  it('purges only recovery drafts owned by the signed-out account', async () => {
    installIndexedDb();
    const now = Date.now();
    for (const [accountId, screenplayId] of [
      ['account-a', 'screenplay-a'],
      ['account-b', 'screenplay-b'],
    ] as const) {
      await indexedDbScreenplayRecoveryStore.save(
        await createScreenplayRecoverySnapshot({
          accountId,
          screenplayId,
          baseServerVersion: 1,
          sourceText: accountId,
          paperSize: 'letter',
          updatedAt: now,
        }),
      );
    }

    await indexedDbScreenplayRecoveryStore.purgeAccount('account-a');

    await expect(
      indexedDbScreenplayRecoveryStore.read('account-a', 'screenplay-a', now),
    ).resolves.toBeUndefined();
    await expect(
      indexedDbScreenplayRecoveryStore.read('account-b', 'screenplay-b', now),
    ).resolves.toMatchObject({
      accountId: 'account-b',
      sourceText: 'account-b',
    });
  });

  it('upgrades legacy recovery storage before purging the signed-out account', async () => {
    installIndexedDb();
    const snapshot = await createScreenplayRecoverySnapshot({
      accountId: 'legacy-account',
      screenplayId: 'legacy-screenplay',
      baseServerVersion: 1,
      sourceText: 'Legacy draft',
      paperSize: 'letter',
    });
    await seedLegacyDatabase(snapshot);

    await indexedDbScreenplayRecoveryStore.purgeAccount('legacy-account');

    expect(await storedRecordCount()).toBe(0);
  });
});
