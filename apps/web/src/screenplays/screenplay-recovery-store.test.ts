import { describe, expect, it, vi } from 'vitest';
import {
  createScreenplayRecoverySnapshot,
  isScreenplayRecoveryExpired,
  SCREENPLAY_RECOVERY_SCHEMA_VERSION,
  SCREENPLAY_RECOVERY_TTL_MS,
} from './screenplay-recovery-store';

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
});
