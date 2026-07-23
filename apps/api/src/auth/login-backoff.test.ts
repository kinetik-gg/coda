import { describe, expect, it } from 'vitest';
import { backoffLockedUntil, isLoginLocked, type LoginBackoffPolicy } from './login-backoff';

const policy: LoginBackoffPolicy = {
  threshold: 5,
  windowsMs: [60_000, 300_000, 900_000],
};

describe('account login backoff policy', () => {
  const now = 1_000_000;

  it('does not lock before the consecutive-failure threshold is reached', () => {
    for (let attempts = 0; attempts < policy.threshold; attempts += 1) {
      expect(backoffLockedUntil(policy, attempts, now)).toBeNull();
    }
  });

  it('opens progressively longer windows once the threshold is crossed and caps at the last', () => {
    expect(backoffLockedUntil(policy, 5, now)).toEqual(new Date(now + 60_000));
    expect(backoffLockedUntil(policy, 6, now)).toEqual(new Date(now + 300_000));
    expect(backoffLockedUntil(policy, 7, now)).toEqual(new Date(now + 900_000));
    // Beyond the final window the delay is capped rather than growing without bound.
    expect(backoffLockedUntil(policy, 8, now)).toEqual(new Date(now + 900_000));
    expect(backoffLockedUntil(policy, 25, now)).toEqual(new Date(now + 900_000));
  });

  it('honours a single-window policy by always applying its cap after the threshold', () => {
    const single: LoginBackoffPolicy = { threshold: 3, windowsMs: [120_000] };
    expect(backoffLockedUntil(single, 2, now)).toBeNull();
    expect(backoffLockedUntil(single, 3, now)).toEqual(new Date(now + 120_000));
    expect(backoffLockedUntil(single, 9, now)).toEqual(new Date(now + 120_000));
  });

  it('reports a lock as active only while its instant is still in the future', () => {
    expect(isLoginLocked(new Date(now + 1), now)).toBe(true);
    expect(isLoginLocked(new Date(now), now)).toBe(false);
    expect(isLoginLocked(new Date(now - 1), now)).toBe(false);
    expect(isLoginLocked(null, now)).toBe(false);
    expect(isLoginLocked(undefined, now)).toBe(false);
  });
});
