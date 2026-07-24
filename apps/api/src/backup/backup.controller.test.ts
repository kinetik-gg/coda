import { Readable } from 'node:stream';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { SetupTokenService } from '../auth/setup-token.service';
import type { BackupManifest } from './backup-format';
import type { BackupProgress } from './backup-ports';
import { BackupController } from './backup.controller';
import type { BackupService } from './backup.service';

vi.mock('../config/env', () => ({ env: vi.fn() }));

const secret = Buffer.alloc(32, 3).toString('base64');

function withKey(present = true): void {
  vi.mocked(env).mockReturnValue({
    CONFIG_ENCRYPTION_KEY: present ? secret : undefined,
  } as unknown as ReturnType<typeof env>);
}

class FakeResponse {
  headers = new Map<string, string>();
  statusCode = 0;
  chunks: string[] = [];
  ended = false;
  destroyedWith: unknown;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
  }
  destroy(error?: unknown): void {
    this.destroyedWith = error;
    this.ended = true;
  }
  lines(): Record<string, unknown>[] {
    return this.chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function prismaWith(owner: string | null, ownerCount = owner ? 1 : 0): PrismaService {
  return {
    instanceSettings: {
      findFirst: vi.fn().mockResolvedValue(owner ? { ownerUserId: owner } : null),
      count: vi.fn().mockResolvedValue(ownerCount),
    },
  } as unknown as PrismaService;
}

interface MockSetupToken {
  required: boolean;
  verify: ReturnType<typeof vi.fn>;
  markInitialized: ReturnType<typeof vi.fn>;
}

function setupTokenWith(required: boolean, valid = true): MockSetupToken {
  return {
    required,
    verify: vi.fn().mockReturnValue(valid),
    markInitialized: vi.fn(),
  };
}

function controller(overrides: {
  backup?: Partial<BackupService>;
  prisma?: PrismaService;
  setupToken?: MockSetupToken;
}): BackupController {
  return new BackupController(
    (overrides.backup ?? {}) as BackupService,
    overrides.prisma ?? prismaWith('owner-1'),
    (overrides.setupToken ?? setupTokenWith(false)) as unknown as SetupTokenService,
  );
}

const manifest = { appVersion: '0.0.4', createdAt: '2026-07-24T00:00:00.000Z' } as BackupManifest;

describe('BackupController download', () => {
  afterEach(() => vi.clearAllMocks());

  it('streams a signed archive to the owner with attachment headers', async () => {
    withKey();
    const create = vi.fn((request: { sink: { write: (b: Buffer) => void } }) => {
      request.sink.write(Buffer.from('archive'));
      return Promise.resolve(manifest);
    });
    const response = new FakeResponse();
    await controller({ backup: { create } as unknown as Partial<BackupService> }).download(
      { user: { id: 'owner-1' } } as unknown as Request,
      response as unknown as Response,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /attachment; filename="coda-backup-.*\.codabk"/u,
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.ended).toBe(true);
  });

  it('refuses a non-owner before deriving any key', async () => {
    withKey();
    const create = vi.fn();
    await expect(
      controller({ backup: { create } as unknown as Partial<BackupService> }).download(
        { user: { id: 'intruder' } } as unknown as Request,
        new FakeResponse() as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a 409 when the instance secret needed to sign is missing', async () => {
    withKey(false);
    await expect(
      controller({ backup: { create: vi.fn() } as unknown as Partial<BackupService> }).download(
        { user: { id: 'owner-1' } } as unknown as Request,
        new FakeResponse() as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('destroys the response when the archive stream fails mid-transfer', async () => {
    withKey();
    const create = vi.fn().mockRejectedValue(new Error('dump failed'));
    const response = new FakeResponse();
    await controller({ backup: { create } as unknown as Partial<BackupService> }).download(
      { user: { id: 'owner-1' } } as unknown as Request,
      response as unknown as Response,
    );
    expect(response.destroyedWith).toBeInstanceOf(Error);
  });
});

describe('BackupController setup import', () => {
  afterEach(() => vi.clearAllMocks());

  function importRequest(): Request {
    const request = Readable.from([Buffer.from('archive-bytes')]) as unknown as Request;
    request.header = vi.fn().mockReturnValue('a-token') as unknown as Request['header'];
    return request;
  }

  it('restores into an uninitialized instance and streams progress then completion', async () => {
    withKey();
    const restore = vi.fn((request: { onProgress?: (p: BackupProgress) => void }) => {
      request.onProgress?.({ phase: 'restore-database' });
      return Promise.resolve(manifest);
    });
    const setupToken = setupTokenWith(false);
    const response = new FakeResponse();
    await controller({
      backup: { restore } as unknown as Partial<BackupService>,
      prisma: prismaWith(null, 0),
      setupToken,
    }).import(importRequest(), response as unknown as Response);

    expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');
    const lines = response.lines();
    expect(lines[0]).toMatchObject({ event: 'progress', phase: 'restore-database' });
    expect(lines.at(-1)).toMatchObject({ status: 'complete', appVersion: '0.0.4' });
    expect(setupToken.markInitialized).toHaveBeenCalledTimes(1);
    expect(response.ended).toBe(true);
  });

  it('emits a terminal error line when the restore fails after streaming starts', async () => {
    withKey();
    const restore = vi.fn().mockRejectedValue(new Error('signature invalid'));
    const setupToken = setupTokenWith(false);
    const response = new FakeResponse();
    await controller({
      backup: { restore } as unknown as Partial<BackupService>,
      prisma: prismaWith(null, 0),
      setupToken,
    }).import(importRequest(), response as unknown as Response);
    expect(response.lines().at(-1)).toMatchObject({
      status: 'error',
      message: 'signature invalid',
    });
    expect(setupToken.markInitialized).not.toHaveBeenCalled();
  });

  it('rejects an invalid setup token before reading the archive', async () => {
    withKey();
    const restore = vi.fn();
    await expect(
      controller({
        backup: { restore } as unknown as Partial<BackupService>,
        prisma: prismaWith(null, 0),
        setupToken: setupTokenWith(true, false),
      }).import(importRequest(), new FakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses to restore an already-initialized instance', async () => {
    withKey();
    const restore = vi.fn();
    await expect(
      controller({
        backup: { restore } as unknown as Partial<BackupService>,
        prisma: prismaWith('owner-1', 1),
        setupToken: setupTokenWith(false),
      }).import(importRequest(), new FakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(restore).not.toHaveBeenCalled();
  });
});
