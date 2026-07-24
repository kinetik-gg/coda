import { describe, expect, it } from 'vitest';
import { BackupKeyUnavailableError, deriveBackupKeyPair, requireBackupKeyPair } from './backup-key';
import { backupSigningKeyFingerprint, backupVerificationKeySha256 } from './backup-signing';

const key = Buffer.alloc(32, 7).toString('base64');

describe('deriveBackupKeyPair', () => {
  it('derives a valid, deterministic Ed25519 pair whose keys share one fingerprint', () => {
    const first = deriveBackupKeyPair(key);
    const second = deriveBackupKeyPair(key);
    expect(first).toEqual(second);
    expect(first.signingKey).toContain('BEGIN PRIVATE KEY');
    expect(first.verificationKey).toContain('BEGIN PUBLIC KEY');
    expect(backupSigningKeyFingerprint(first.signingKey)).toBe(
      backupVerificationKeySha256(first.verificationKey),
    );
  });

  it('derives a different pair for a different instance secret', () => {
    const other = deriveBackupKeyPair(Buffer.alloc(32, 8).toString('base64'));
    expect(other.verificationKey).not.toBe(deriveBackupKeyPair(key).verificationKey);
  });

  it('rejects a secret shorter than 32 bytes', () => {
    expect(() => deriveBackupKeyPair(Buffer.alloc(16, 1).toString('base64'))).toThrow(
      BackupKeyUnavailableError,
    );
  });
});

describe('requireBackupKeyPair', () => {
  it('returns the derived pair when the secret is present', () => {
    expect(requireBackupKeyPair(key)).toEqual(deriveBackupKeyPair(key));
  });

  it('throws a single actionable error when the secret is missing', () => {
    expect(() => requireBackupKeyPair(undefined)).toThrow(BackupKeyUnavailableError);
    expect(() => requireBackupKeyPair(undefined)).toThrow(/CONFIG_ENCRYPTION_KEY/);
  });
});
