import { describe, expect, it } from 'vitest';
import { storageDeletionNotBefore, storageDeletionRetryAfter } from './storage-deletion-policy';

describe('storage deletion timing policy', () => {
  const now = new Date('2026-07-22T00:00:00.000Z');

  it('waits beyond the maximum signed upload lifetime before physical deletion', () => {
    expect(storageDeletionNotBefore(now)).toEqual(new Date('2026-07-22T01:00:01.000Z'));
  });

  it('uses bounded exponential retry delays', () => {
    expect(storageDeletionRetryAfter(1, now)).toEqual(new Date('2026-07-22T00:01:00.000Z'));
    expect(storageDeletionRetryAfter(3, now)).toEqual(new Date('2026-07-22T00:04:00.000Z'));
    expect(storageDeletionRetryAfter(20, now)).toEqual(new Date('2026-07-22T01:00:00.000Z'));
  });
});
