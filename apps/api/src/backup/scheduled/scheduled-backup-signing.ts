import { Injectable } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { InstanceConfigService } from '../../config/instance-config.service';
import { backupVerificationKeySha256 } from '../backup-signing';

/** A resolved scheduled-backup key pair plus its verification fingerprint. */
export interface ScheduledBackupKeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
}

/**
 * Manages the Ed25519 key pair that signs scheduled archives. The key pair is
 * generated once, on first use, and persisted encrypted in the instance-config
 * store, so a database dump alone never reveals the private key. The public key
 * is surfaced to operators so they can verify scheduled archives on restore with
 * the same tooling used for manual and operator backups.
 */
@Injectable()
export class ScheduledBackupSigningService {
  constructor(private readonly instanceConfig: InstanceConfigService) {}

  /** Returns the stored key pair, generating and persisting one if absent. */
  async ensureKeyMaterial(updatedBy?: string | null): Promise<ScheduledBackupKeyMaterial> {
    const existing = await this.instanceConfig.getConfig('backup.signingKey');
    if (existing) {
      return {
        ...existing,
        fingerprint: backupVerificationKeySha256(existing.publicKeyPem),
      };
    }
    const generated = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const privateKeyPem = generated.privateKey.toString();
    const publicKeyPem = generated.publicKey.toString();
    await this.instanceConfig.setConfig(
      'backup.signingKey',
      { privateKeyPem, publicKeyPem },
      updatedBy ?? null,
    );
    return {
      privateKeyPem,
      publicKeyPem,
      fingerprint: backupVerificationKeySha256(publicKeyPem),
    };
  }

  /** Returns the verification fingerprint, or null when no key pair exists yet. */
  async fingerprint(): Promise<string | null> {
    const existing = await this.instanceConfig.getConfig('backup.signingKey');
    return existing ? backupVerificationKeySha256(existing.publicKeyPem) : null;
  }
}
