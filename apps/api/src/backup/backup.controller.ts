import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { SetupTokenService } from '../auth/setup-token.service';
import type { BackupProgress } from './backup-ports';
import { BackupKeyUnavailableError, requireBackupKeyPair } from './backup-key';
import { readApiVersion } from './backup-runtime-info';
import { BackupService } from './backup.service';

function backupFilename(now = new Date()): string {
  return `coda-backup-${now.toISOString().replace(/[:.]/gu, '-')}.codabk`;
}

/**
 * Transport surface for the in-app backup engine:
 *
 * - `GET /api/v1/instance/backups/download` streams a signed archive to the instance owner's browser,
 *   staging only within the tmpfs bounds the engine already enforces (no whole-archive buffering).
 * - `POST /api/v1/setup/import` restores a signed archive into an uninitialized instance during
 *   first-run setup. It is gated by the setup token exactly like owner creation, verifies the
 *   signature and format version before any write (inside the engine), and streams newline-delimited
 *   JSON progress so the first-run UI can show progress and recover clearly from a failure.
 *
 * Both derive the Ed25519 key pair deterministically from `CONFIG_ENCRYPTION_KEY`, so an operator who
 * carries that one instance secret to a new deployment can restore an archive taken from the old one.
 */
@Controller('api/v1')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly prisma: PrismaService,
    private readonly setupToken: SetupTokenService,
  ) {}

  @Get('instance/backups/download')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async download(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.assertOwner(request.user?.id);
    const signingKey = this.requireSigningKey();
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    try {
      await this.backup.create({
        sink: response,
        signingKey,
        reason: 'download',
        appVersion: readApiVersion(),
      });
      response.end();
    } catch (error) {
      // Headers are already sent once streaming starts, so the only honest signal left to the client
      // is an abruptly terminated transfer; the attachment will be incomplete and must be discarded.
      response.destroy(error instanceof Error ? error : new Error('Backup stream failed'));
    }
  }

  @Public()
  @Post('setup/import')
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  async import(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (this.setupToken.required) {
      const provided = request.header('x-coda-setup-token') ?? '';
      if (!this.setupToken.verify(provided)) {
        throw new UnauthorizedException('The instance setup token is invalid');
      }
    }
    const verificationKey = this.requireVerificationKey();
    if ((await this.prisma.instanceSettings.count()) > 0) {
      throw new ConflictException('This instance is already initialized; restore is refused');
    }

    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson');
    response.setHeader('Cache-Control', 'private, no-store');
    const writeLine = (payload: Record<string, unknown>): void => {
      response.write(`${JSON.stringify(payload)}\n`);
    };
    const onProgress = (progress: BackupProgress): void =>
      writeLine({ event: 'progress', ...progress });
    try {
      const manifest = await this.backup.restore({ source: request, verificationKey, onProgress });
      this.setupToken.markInitialized();
      writeLine({
        status: 'complete',
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
      });
    } catch (error) {
      writeLine({
        status: 'error',
        message: error instanceof Error ? error.message : 'Restore failed',
      });
    } finally {
      response.end();
    }
  }

  private requireSigningKey(): string {
    try {
      return requireBackupKeyPair(env().CONFIG_ENCRYPTION_KEY).signingKey;
    } catch (error) {
      throw this.mapKeyError(error);
    }
  }

  private requireVerificationKey(): string {
    try {
      return requireBackupKeyPair(env().CONFIG_ENCRYPTION_KEY).verificationKey;
    } catch (error) {
      throw this.mapKeyError(error);
    }
  }

  private mapKeyError(error: unknown): Error {
    if (error instanceof BackupKeyUnavailableError) return new ConflictException(error.message);
    return error instanceof Error ? error : new Error('Backup key is unavailable');
  }

  private async assertOwner(userId: string | undefined): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new ConflictException('Instance setup is incomplete');
    if (!userId || settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance owner may download a backup');
    }
  }
}
