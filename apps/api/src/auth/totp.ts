import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Minimal, audited TOTP (RFC 6238) built on RFC 4226 HOTP and node:crypto's
 * HMAC. Kept dependency-free and small so the whole two-factor code path can be
 * reviewed in one sitting; the unit tests pin it to the canonical RFC 4226 and
 * RFC 6238 test vectors.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_ALGORITHM: TotpAlgorithm = 'sha1';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface TotpOptions {
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
}

/** RFC 4226 HOTP: the truncated HMAC of an 8-byte big-endian counter. */
export function hotp(secret: Buffer, counter: number | bigint, options: TotpOptions = {}): string {
  const digits = options.digits ?? DEFAULT_DIGITS;
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The RFC 6238 time-step counter for a wall-clock time (in milliseconds). */
export function totpCounter(nowMs: number, period = DEFAULT_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

/** RFC 6238 TOTP for the given time (in milliseconds). */
export function totp(secret: Buffer, nowMs: number, options: TotpOptions = {}): string {
  return hotp(secret, totpCounter(nowMs, options.period), options);
}

export interface TotpVerifyOptions extends TotpOptions {
  /** Steps of clock skew tolerated on each side of the current step. */
  window?: number;
  /**
   * Highest counter already spent. Any candidate at or below it is rejected so a
   * captured code cannot be replayed inside its validity window.
   */
  after?: number | null;
}

/**
 * Verifies a submitted token against the secret, scanning +/- `window` steps for
 * clock skew and enforcing single-use via the `after` high-water mark. Returns
 * the matched counter (to persist as the new high-water mark) or null.
 */
export function verifyTotp(
  secret: Buffer,
  token: string,
  nowMs: number,
  options: TotpVerifyOptions = {},
): number | null {
  const window = options.window ?? 1;
  const floor = options.after ?? null;
  const current = totpCounter(nowMs, options.period);
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = current + drift;
    if (candidate < 0) continue;
    if (floor !== null && candidate <= floor) continue;
    if (constantTimeEquals(hotp(secret, candidate, options), token)) return candidate;
  }
  return null;
}

/** Length-safe constant-time string comparison for user-supplied codes. */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** RFC 4648 base32 without padding, the format authenticator apps expect. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decodes RFC 4648 base32, ignoring spaces, casing, and padding. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=]+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generates a fresh base32 TOTP secret (20 bytes = 160 bits, the RFC minimum). */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

/** Builds the otpauth:// provisioning URI consumed by authenticator-app QR codes. */
export function buildOtpauthUri(input: {
  secret: string;
  accountName: string;
  issuer: string;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: (input.algorithm ?? DEFAULT_ALGORITHM).toUpperCase(),
    digits: String(input.digits ?? DEFAULT_DIGITS),
    period: String(input.period ?? DEFAULT_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
