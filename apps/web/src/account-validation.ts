import { PASSWORD_MIN_LENGTH } from '@coda/contracts';

export type AccountPage = 'profile' | 'preferences' | 'security' | 'developer';

export interface PasswordFields {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const credentialExpiryHours: Record<string, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export function credentialExpiration(expiry: string, now = Date.now()): string | null {
  const hours = credentialExpiryHours[expiry];
  return hours === undefined ? null : new Date(now + hours * 60 * 60 * 1000).toISOString();
}

export function validatePasswordFields(fields: PasswordFields): string | null {
  if (!fields.currentPassword) return 'Enter your current password.';
  if (!fields.newPassword) return 'Enter a new password.';
  if (fields.newPassword.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`;
  if (fields.newPassword !== fields.confirmPassword) return 'New passwords do not match.';
  if (fields.currentPassword === fields.newPassword) {
    return 'Choose a password different from your current password.';
  }
  return null;
}
