import { z } from 'zod';

/**
 * Contracts for TOTP two-factor authentication: enrollment, activation, disable,
 * and the post-password login challenge. Kept in a leaf module so the auth
 * section of the main contracts index stays within its size budget.
 */

// The number of single-use recovery codes minted when TOTP is activated.
export const TWO_FACTOR_RECOVERY_CODE_COUNT = 10;

// A six-digit TOTP code, optionally entered with a separating space.
export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your authenticator app'));

// A single second-factor input: either a six-digit TOTP code or a recovery code.
// The server disambiguates by shape, so the client submits one free-form field.
export const secondFactorSchema = z
  .string()
  .trim()
  .min(6, 'Enter a code')
  .max(64, 'Code is too long');

// The opaque, short-lived challenge handle returned after a correct password.
export const twoFactorChallengeSchema = z.string().min(32).max(512);

export const activateTwoFactorSchema = z.object({ code: totpCodeSchema });
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: secondFactorSchema,
});
export const verifyTwoFactorLoginSchema = z.object({
  challenge: twoFactorChallengeSchema,
  code: secondFactorSchema,
});
export type ActivateTwoFactor = z.infer<typeof activateTwoFactorSchema>;
export type DisableTwoFactor = z.infer<typeof disableTwoFactorSchema>;
export type VerifyTwoFactorLogin = z.infer<typeof verifyTwoFactorLoginSchema>;

export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  available: boolean;
  recoveryCodesRemaining: number;
}
export interface TwoFactorEnrollment {
  secret: string;
  otpauthUri: string;
}
export interface TwoFactorActivation {
  recoveryCodes: string[];
}

// The password step returns an authenticated identity, or -- only once the
// password is correct -- a challenge demanding the second factor.
export interface AuthenticatedIdentity {
  id: string;
  email: string;
  displayName: string;
}
export interface TwoFactorRequired {
  twoFactorRequired: true;
  challenge: string;
}
export type LoginResult = AuthenticatedIdentity | TwoFactorRequired;
