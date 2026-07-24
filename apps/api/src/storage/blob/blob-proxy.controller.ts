import { Controller, ForbiddenException, Get, Param, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { BlobNotFoundError } from './blob-store';
import { FsBlobStoreProvider } from './fs/fs-blob-store.provider';
import { BlobAlreadyExistsError, BlobKeyError, BlobTooLargeError } from './fs/fs-blob-store';
import { InvalidBlobTokenError, type DownloadGrant } from './fs/blob-proxy-signer';

/** `bytes=start-` or `bytes=start-end`; single range only, matching what the PDF viewer emits. */
const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/u;

interface ResolvedRange {
  start: number;
  end: number;
}

/**
 * The app-proxied transfer surface the filesystem driver hands its clients in
 * place of S3 presigned URLs. Both routes are authorized purely by the signed
 * token in the path — the token is the capability, exactly as a presigned URL is —
 * so they are {@link Public} (no session needed) and CSRF-exempt. The size, type,
 * and conditional-create checks the direct S3 path gets from the presign are
 * re-enforced here from the token's grant.
 *
 * In S3 mode no valid token is ever minted (that driver issues presigned URLs), so
 * these routes simply reject every request as an invalid signature.
 */
@Controller('api/v1/blob')
export class BlobProxyController {
  constructor(private readonly fs: FsBlobStoreProvider) {}

  @Public()
  @Put('upload/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async upload(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const grant = this.verify(() => this.fs.verifyUpload(token));
    try {
      await this.fs.active().put(grant.key, request, {
        contentType: grant.contentType,
        contentLength: grant.contentLength,
        maxBytes: grant.maxBytes,
        ifNoneMatch: true,
      });
    } catch (error) {
      this.failUpload(response, error);
      return;
    }
    // 200, matching the S3 presigned PUT the direct path returns, so callers and
    // the integration suite see one status across both drivers.
    response.status(200).end();
  }

  @Public()
  @Get('download/:token')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async download(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const grant = this.verify(() => this.fs.verifyDownload(token));
    const store = this.fs.active();
    let size: number;
    try {
      size = (await store.stat(grant.key)).size ?? 0;
    } catch (error) {
      if (error instanceof BlobNotFoundError || error instanceof BlobKeyError) {
        response.status(404).end();
        return;
      }
      throw error;
    }
    const range = this.parseRange(request.get('range'), size);
    this.setDownloadHeaders(response, grant, size, range);
    const { stream } = await store.get(grant.key, range ? { range } : {});
    stream.on('error', (error) => response.destroy(error));
    stream.pipe(response);
  }

  private setDownloadHeaders(
    response: Response,
    grant: DownloadGrant,
    size: number,
    range: ResolvedRange | undefined,
  ): void {
    response.setHeader('Content-Type', grant.contentType);
    response.setHeader('Content-Disposition', grant.disposition);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, no-store');
    if (range) {
      response.status(206);
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      response.status(200);
      response.setHeader('Content-Length', String(size));
    }
  }

  private parseRange(header: string | undefined, size: number): ResolvedRange | undefined {
    if (!header) return undefined;
    const match = RANGE_PATTERN.exec(header);
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start > end || start >= size) return undefined;
    return { start, end: Math.min(end, size - 1) };
  }

  private verify<T>(read: () => T): T {
    try {
      return read();
    } catch (error) {
      if (error instanceof InvalidBlobTokenError) {
        throw new ForbiddenException('Blob transfer token is invalid or expired');
      }
      throw error;
    }
  }

  private failUpload(response: Response, error: unknown): void {
    if (error instanceof BlobTooLargeError) {
      response.status(413).end();
      return;
    }
    if (error instanceof BlobAlreadyExistsError) {
      response.status(409).end();
      return;
    }
    if (error instanceof BlobKeyError) {
      response.status(400).end();
      return;
    }
    response.destroy(error instanceof Error ? error : new Error('Upload failed'));
  }
}
