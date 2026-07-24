import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { verify as argon2Verify } from 'argon2';
import {
  TWO_FACTOR_RECOVERY_CODE_COUNT,
  type TwoFactorActivation,
  type TwoFactorEnrollment,
  type TwoFactorStatus,
} from '@coda/contracts';
import { createToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigEncryptionService } from '../config/config-encryption.service';
import {
  findMatchingRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from './two-factor-recovery-codes';
import { base32Decode, buildOtpauthUri, generateTotpSecret, verifyTotp } from './totp';

const ISSUER = 'Coda';
const CHALLENGE_TTL_MS = 5 * 60_000;
const TOTP_CODE_PATTERN = /^\d{6}$/u;
const TOTP_WINDOW = 1;

type TwoFactorRecord = {
  userId: string;
  secretCiphertext: Uint8Array;
  secretNonce: Uint8Array;
  activatedAt: Date | null;
  lastUsedCounter: bigint | null;
};

type VerifiedFactor =
  { kind: 'totp'; counter: number } | { kind: 'recovery'; recoveryCodeId: string };

/**
 * TOTP two-factor lifecycle: enrollment, verify-to-activate, single-use recovery
 * codes, disable, the post-password login challenge, and owner-initiated reset.
 * Shared secrets never leave this service in plaintext except in the one-time
 * enrollment response; at rest they are AES-256-GCM ciphertext, so the whole
 * feature requires CONFIG_ENCRYPTION_KEY.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: ConfigEncryptionService,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    const available = this.encryption.configured;
    if (!record) return { enabled: false, pending: false, available, recoveryCodesRemaining: 0 };
    const enabled = record.activatedAt !== null;
    const recoveryCodesRemaining = enabled
      ? await this.prisma.userTwoFactorRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return { enabled, pending: !enabled, available, recoveryCodesRemaining };
  }

  /** Begins (or restarts a pending) enrollment, returning the secret and QR URI. */
  async enroll(userId: string, accountEmail: string): Promise<TwoFactorEnrollment> {
    this.assertConfigured();
    const existing = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (existing?.activatedAt) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }
    const secret = generateTotpSecret();
    const { ciphertext, nonce } = this.encryption.encrypt(secret);
    await this.prisma.$transaction(async (tx) => {
      await tx.userTwoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.userTwoFactor.upsert({
        where: { userId },
        create: {
          userId,
          secretCiphertext: new Uint8Array(ciphertext),
          secretNonce: new Uint8Array(nonce),
        },
        update: {
          secretCiphertext: new Uint8Array(ciphertext),
          secretNonce: new Uint8Array(nonce),
          activatedAt: null,
          lastUsedCounter: null,
        },
      });
    });
    return {
      secret,
      otpauthUri: buildOtpauthUri({ secret, accountName: accountEmail, issuer: ISSUER }),
    };
  }

  /** Confirms a code against the pending secret, activating 2FA and minting codes. */
  async activate(userId: string, code: string, now = Date.now()): Promise<TwoFactorActivation> {
    this.assertConfigured();
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!record) throw new NotFoundException('Start two-factor enrollment first');
    if (record.activatedAt)
      throw new ConflictException('Two-factor authentication is already enabled');
    const counter = this.verifyTotpCode(record, code, now);
    if (counter === null) throw new UnauthorizedException('That code is incorrect or expired');
    const recoveryCodes = generateRecoveryCodes(TWO_FACTOR_RECOVERY_CODE_COUNT);
    const hashes = await hashRecoveryCodes(recoveryCodes);
    await this.prisma.$transaction(async (tx) => {
      await tx.userTwoFactor.update({
        where: { userId },
        data: { activatedAt: new Date(now), lastUsedCounter: BigInt(counter) },
      });
      await tx.userTwoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.userTwoFactorRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      });
    });
    return { recoveryCodes };
  }

  /** Disables 2FA after re-proving the password and a valid second factor. */
  async disable(
    userId: string,
    password: string,
    code: string,
    now = Date.now(),
  ): Promise<{ disabled: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2Verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Your password is incorrect');
    }
    const record = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!record?.activatedAt)
      throw new NotFoundException('Two-factor authentication is not enabled');
    const verified = await this.verifySecondFactor(record, code, now);
    if (!verified) throw new UnauthorizedException('That code is incorrect or expired');
    await this.clearForUser(userId);
    return { disabled: true };
  }

  /** Whether the account has completed enrollment and must present a second factor. */
  async hasActiveTwoFactor(userId: string): Promise<boolean> {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId },
      select: { activatedAt: true },
    });
    return record?.activatedAt != null;
  }

  /**
   * Issues a short-lived, single-purpose challenge after a correct password. It
   * is not a session and carries no access; only a matching second factor
   * exchanges it for one via {@link verifyLogin}.
   */
  async createChallenge(userId: string, now = Date.now()): Promise<string> {
    const token = createToken();
    await this.prisma.twoFactorChallenge.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now + CHALLENGE_TTL_MS),
      },
    });
    return token;
  }

  /** Redeems a challenge with a second factor, returning the authenticated user id. */
  async verifyLogin(challenge: string, code: string, now = Date.now()): Promise<string> {
    const record = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: hashToken(challenge) },
    });
    if (!record || record.expiresAt <= new Date(now)) {
      throw new UnauthorizedException('This sign-in request has expired. Start again.');
    }
    const totp = await this.prisma.userTwoFactor.findUnique({ where: { userId: record.userId } });
    if (!totp?.activatedAt) {
      await this.prisma.twoFactorChallenge.deleteMany({ where: { userId: record.userId } });
      throw new UnauthorizedException('This sign-in request has expired. Start again.');
    }
    const verified = await this.verifySecondFactor(totp, code, now);
    if (!verified) throw new UnauthorizedException('That code is incorrect or expired');
    await this.consumeFactor(record.userId, verified, now);
    return record.userId;
  }

  /** Owner-initiated removal of a locked-out member's 2FA (instance management). */
  async resetForUser(actorId: string, userId: string): Promise<{ reset: true }> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (settings?.ownerUserId !== actorId) {
      throw new ForbiddenException('Only the instance administrator may reset two-factor');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    await this.clearForUser(userId);
    return { reset: true };
  }

  private async consumeFactor(
    userId: string,
    verified: VerifiedFactor,
    now: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (verified.kind === 'totp') {
        await tx.userTwoFactor.update({
          where: { userId },
          data: { lastUsedCounter: BigInt(verified.counter) },
        });
      } else {
        await tx.userTwoFactorRecoveryCode.updateMany({
          where: { id: verified.recoveryCodeId, usedAt: null },
          data: { usedAt: new Date(now) },
        });
      }
      await tx.twoFactorChallenge.deleteMany({ where: { userId } });
    });
  }

  private async verifySecondFactor(
    record: TwoFactorRecord,
    code: string,
    now: number,
  ): Promise<VerifiedFactor | null> {
    if (TOTP_CODE_PATTERN.test(code)) {
      const counter = this.verifyTotpCode(record, code, now);
      return counter === null ? null : { kind: 'totp', counter };
    }
    const stored = await this.prisma.userTwoFactorRecoveryCode.findMany({
      where: { userId: record.userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    const recoveryCodeId = await findMatchingRecoveryCode(code, stored);
    return recoveryCodeId ? { kind: 'recovery', recoveryCodeId } : null;
  }

  private verifyTotpCode(record: TwoFactorRecord, code: string, now: number): number | null {
    const secret = base32Decode(
      this.encryption.decrypt(
        Buffer.from(record.secretCiphertext),
        Buffer.from(record.secretNonce),
      ),
    );
    return verifyTotp(secret, code, now, {
      window: TOTP_WINDOW,
      after: record.lastUsedCounter === null ? null : Number(record.lastUsedCounter),
    });
  }

  private async clearForUser(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userTwoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorChallenge.deleteMany({ where: { userId } }),
      this.prisma.userTwoFactor.deleteMany({ where: { userId } }),
    ]);
  }

  private assertConfigured(): void {
    if (!this.encryption.configured) {
      throw new ServiceUnavailableException(
        'Two-factor authentication requires CONFIG_ENCRYPTION_KEY. Set a 32+ byte base64 key to enable it.',
      );
    }
  }
}
