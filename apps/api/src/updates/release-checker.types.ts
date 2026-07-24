import type { SemverComparison } from './semver-compare';

export interface ReleaseCheckStatus {
  /** The SemVer version of the running build. */
  current: string;
  /** The latest version known from the release feed, or `null` if never checked successfully. */
  latest: string | null;
  /** `true` only when the latest known release is strictly newer than the running version. */
  updateAvailable: boolean;
  /** How `current` compares to `latest`; `'unknown'` covers unchecked or malformed data. */
  comparison: SemverComparison;
  /** Release notes URL for the latest known release, when available. */
  notesUrl: string | null;
  /** When the most recent check attempt (success or failure) ran. */
  lastCheckedAt: Date | null;
  /** When the most recent check attempt succeeded. */
  lastSucceededAt: Date | null;
  /** Sanitized message from the most recent failed check, if the last attempt failed. */
  lastError: string | null;
}
