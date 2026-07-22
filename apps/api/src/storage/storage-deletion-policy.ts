import { MAX_SIGNED_UPLOAD_TTL_SECONDS } from '../config/security-limits';

const EXPIRY_BOUNDARY_GRACE_MS = 1_000;
const MIN_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

export function storageDeletionNotBefore(now = new Date()): Date {
  return new Date(now.getTime() + MAX_SIGNED_UPLOAD_TTL_SECONDS * 1_000 + EXPIRY_BOUNDARY_GRACE_MS);
}

export function storageDeletionRetryAfter(attempt: number, now = new Date()): Date {
  const exponent = Math.max(0, Math.min(attempt - 1, 6));
  return new Date(now.getTime() + Math.min(MIN_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS));
}
