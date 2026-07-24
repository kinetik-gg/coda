import { randomBytes } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from 'argon2';
import { base32Encode } from './totp';

/**
 * Single-use recovery codes for TOTP two-factor. Codes are shown once at
 * activation and stored only as argon2 hashes. Presentation groups the ten
 * characters as `abcde-fg234` for legibility, but the hashed, canonical form is
 * the ungrouped lowercase string so a user may type the code with or without the
 * dash, spaces, or capitals.
 */

const CODE_CHARACTERS = 10;

/** Reduces any user-entered code to its canonical hashable form. */
export function canonicalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z2-7]/g, '');
}

/** Formats a canonical code for display as two dash-separated groups. */
export function formatRecoveryCode(canonical: string): string {
  return `${canonical.slice(0, 5)}-${canonical.slice(5)}`;
}

/** Generates `count` fresh recovery codes in display form. */
export function generateRecoveryCodes(count: number): string[] {
  return Array.from({ length: count }, () => {
    // 7 random bytes -> >=11 base32 chars; take the first ten for a 50-bit code.
    const canonical = base32Encode(randomBytes(7)).toLowerCase().slice(0, CODE_CHARACTERS);
    return formatRecoveryCode(canonical);
  });
}

/** Argon2-hashes each display code by its canonical form for storage at rest. */
export function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => argon2Hash(canonicalizeRecoveryCode(code), { type: 2 })));
}

/**
 * Finds the stored recovery code matching `input`, or null. Every unused hash is
 * checked so a match and a miss take comparable time regardless of position.
 */
export async function findMatchingRecoveryCode(
  input: string,
  stored: ReadonlyArray<{ id: string; codeHash: string }>,
): Promise<string | null> {
  const candidate = canonicalizeRecoveryCode(input);
  let matchedId: string | null = null;
  for (const entry of stored) {
    if (await argon2Verify(entry.codeHash, candidate)) matchedId = entry.id;
  }
  return matchedId;
}
