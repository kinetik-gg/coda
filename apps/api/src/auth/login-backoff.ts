import { env } from '../config/env';

/**
 * Account-scoped progressive login backoff.
 *
 * Per-IP throttling (see {@link AuthController}) bounds a single source address, but a distributed
 * credential-stuffing attempt that rotates source IPs is only bounded by an account-scoped defense.
 * After {@link LoginBackoffPolicy.threshold} consecutive failures for one account, each subsequent
 * failure opens an increasing delay window during which no login for that account is accepted — even
 * with the correct password. The counter and window are cleared on a successful login or a completed
 * password reset.
 *
 * The enforcement is timing-safe: it never short-circuits the constant-time password verification, so
 * a locked account is indistinguishable from an ordinary failed login in both response shape and
 * timing. See `docs/security.md`.
 */
export interface LoginBackoffPolicy {
  /** Consecutive failures that must accrue before the first delay window opens. */
  readonly threshold: number;
  /** Progressive delay windows in milliseconds; the final entry is the cap. */
  readonly windowsMs: readonly number[];
}

export function loginBackoffPolicy(): LoginBackoffPolicy {
  const config = env();
  return {
    threshold: config.AUTH_LOGIN_BACKOFF_THRESHOLD,
    windowsMs: config.AUTH_LOGIN_BACKOFF_WINDOWS_MS,
  };
}

/**
 * Given the *new* consecutive-failure count after recording a failure, return the instant until which
 * the account should be locked, or `null` when the threshold has not yet been reached.
 */
export function backoffLockedUntil(
  policy: LoginBackoffPolicy,
  failedAttempts: number,
  now: number,
): Date | null {
  if (failedAttempts < policy.threshold) return null;
  const index = Math.min(failedAttempts - policy.threshold, policy.windowsMs.length - 1);
  return new Date(now + policy.windowsMs[index]!);
}

/** Whether a stored lock instant is still in effect at `now`. */
export function isLoginLocked(lockedUntil: Date | null | undefined, now: number): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now;
}
