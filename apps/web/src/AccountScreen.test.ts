import { describe, expect, it } from 'vitest';
import { credentialExpiration, validatePasswordFields } from './account-validation';

describe('validatePasswordFields', () => {
  it('requires the current password', () => {
    expect(
      validatePasswordFields({ currentPassword: '', newPassword: 'new', confirmPassword: 'new' }),
    ).toBe('Enter your current password.');
  });

  it('requires matching new password values', () => {
    expect(
      validatePasswordFields({
        currentPassword: 'current',
        newPassword: 'first-password',
        confirmPassword: 'second-password',
      }),
    ).toBe('New passwords do not match.');
  });

  it('requires a new password and prevents password reuse', () => {
    expect(
      validatePasswordFields({
        currentPassword: 'current-password',
        newPassword: '',
        confirmPassword: '',
      }),
    ).toBe('Enter a new password.');
    expect(
      validatePasswordFields({
        currentPassword: 'current-password',
        newPassword: 'current-password',
        confirmPassword: 'current-password',
      }),
    ).toBe('Choose a password different from your current password.');
  });

  it('rejects a short new password', () => {
    expect(
      validatePasswordFields({
        currentPassword: 'current-password',
        newPassword: 'short',
        confirmPassword: 'short',
      }),
    ).toBe('Use at least 8 characters for the new password.');
  });

  it('accepts a complete password change', () => {
    expect(
      validatePasswordFields({
        currentPassword: 'current',
        newPassword: 'replacement-password',
        confirmPassword: 'replacement-password',
      }),
    ).toBeNull();
  });
});

describe('credentialExpiration', () => {
  const now = Date.UTC(2026, 0, 1);

  it('keeps never-expiring and unknown values defensive', () => {
    expect(credentialExpiration('never', now)).toBeNull();
    expect(credentialExpiration('unexpected', now)).toBeNull();
  });

  it.each([
    ['24h', '2026-01-02T00:00:00.000Z'],
    ['7d', '2026-01-08T00:00:00.000Z'],
    ['30d', '2026-01-31T00:00:00.000Z'],
  ])('maps %s to its exact expiration', (expiry, expected) => {
    expect(credentialExpiration(expiry, now)).toBe(expected);
  });
});
