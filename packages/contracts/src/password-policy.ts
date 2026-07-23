import { z } from 'zod';
import { COMMON_PASSWORDS } from './common-passwords';

/**
 * Password policy, aligned with NIST SP 800-63B: enforce length and a
 * common-password blocklist, and skip composition rules (no forced mixes of
 * character classes). Applies only when a password is set or changed;
 * existing password hashes are never re-validated against this policy.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Email local parts shorter than this are too generic (e.g. "a", "me") to be
 * a meaningful signal, so the email-local-part check only applies at or above
 * this length.
 */
export const PASSWORD_EMAIL_LOCAL_PART_MIN_LENGTH = 4;

export const PASSWORD_TOO_COMMON_MESSAGE =
  'This password is one of the most common leaked passwords. Choose one that is harder to guess.';

export const PASSWORD_CONTAINS_EMAIL_MESSAGE =
  "Password must not contain your email address' local part.";

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`)
  .refine((password) => !COMMON_PASSWORDS.has(password.toLowerCase()), {
    message: PASSWORD_TOO_COMMON_MESSAGE,
  });

/**
 * Returns true when `password` contains the local part of `email`
 * (case-insensitive), for local parts of PASSWORD_EMAIL_LOCAL_PART_MIN_LENGTH
 * characters or more. Short local parts are skipped to avoid rejecting
 * passwords based on trivial coincidental substrings.
 *
 * This check needs both the password and the account email together, so it
 * cannot live inside the standalone `passwordSchema` (which only sees the
 * password field). Callers must invoke it explicitly wherever a password and
 * its owning email are both available.
 */
export function passwordContainsEmailLocalPart(password: string, email: string): boolean {
  const localPart = email.split('@')[0]?.trim().toLowerCase() ?? '';
  if (localPart.length < PASSWORD_EMAIL_LOCAL_PART_MIN_LENGTH) return false;
  return password.toLowerCase().includes(localPart);
}
