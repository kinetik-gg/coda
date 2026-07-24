/**
 * Startup jitter caps how long a freshly booted instance waits before its first release check,
 * so that a fleet of replicas restarting together does not hammer the release feed at once. It
 * is capped independently of the poll interval so a long interval (e.g. daily) does not delay
 * the first check by hours.
 */
export const MAX_STARTUP_JITTER_MS = 5 * 60 * 1_000;

/**
 * Returns a random delay in `[0, min(intervalMs, MAX_STARTUP_JITTER_MS))` milliseconds, or `0`
 * when `intervalMs` is non-positive (polling disabled).
 */
export function computeStartupJitterMs(
  intervalMs: number,
  random: () => number = Math.random,
): number {
  if (intervalMs <= 0) return 0;
  const bound = Math.min(intervalMs, MAX_STARTUP_JITTER_MS);
  return Math.floor(random() * bound);
}
