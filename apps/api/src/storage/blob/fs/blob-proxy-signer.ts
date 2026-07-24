import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Authorizes a proxied upload: the app streams at most `maxBytes` into `key`, create-if-absent. */
export interface UploadGrant {
  op: 'put';
  key: string;
  contentType: string;
  contentLength: number;
  maxBytes: number;
  /** Absolute expiry, epoch seconds. */
  exp: number;
}

/** Authorizes a proxied download: the app streams `key` back with these response headers. */
export interface DownloadGrant {
  op: 'get';
  key: string;
  disposition: string;
  contentType: string;
  /** Absolute expiry, epoch seconds. */
  exp: number;
}

export type BlobGrant = UploadGrant | DownloadGrant;

/** Thrown when a proxy token is malformed, tampered with, expired, or of the wrong operation. */
export class InvalidBlobTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid blob token: ${reason}`);
    this.name = 'InvalidBlobTokenError';
  }
}

function encode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Mints and verifies the short-lived signed tokens that stand in for S3 presigned
 * URLs on the filesystem driver. The token *is* the capability — possession
 * authorizes exactly one operation on one key until it expires — so the proxy
 * routes need no session, mirroring presigned-URL semantics.
 *
 * The HMAC secret is a fresh 32 random bytes per process. Tokens therefore do not
 * survive a restart; that is acceptable because the driver is single-node and the
 * URLs are short-lived (an in-flight transfer simply re-requests a fresh URL), and
 * it keeps the secret out of the database entirely.
 */
export class BlobProxySigner {
  private readonly secret: Buffer;

  constructor(secret: Buffer = randomBytes(32)) {
    this.secret = secret;
  }

  sign(grant: BlobGrant): string {
    const payload = encode(JSON.stringify(grant));
    return `${payload}.${this.mac(payload)}`;
  }

  verifyUpload(token: string, now = Date.now()): UploadGrant {
    const grant = this.verify(token, now);
    if (grant.op !== 'put') throw new InvalidBlobTokenError('not an upload token');
    return grant;
  }

  verifyDownload(token: string, now = Date.now()): DownloadGrant {
    const grant = this.verify(token, now);
    if (grant.op !== 'get') throw new InvalidBlobTokenError('not a download token');
    return grant;
  }

  private verify(token: string, now: number): BlobGrant {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) throw new InvalidBlobTokenError('malformed');
    const payload = token.slice(0, dot);
    const provided = token.slice(dot + 1);
    const expected = this.mac(payload);
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new InvalidBlobTokenError('signature mismatch');
    }
    let grant: BlobGrant;
    try {
      grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as BlobGrant;
    } catch {
      throw new InvalidBlobTokenError('unparsable payload');
    }
    if (typeof grant?.exp !== 'number' || Number.isNaN(grant.exp)) {
      throw new InvalidBlobTokenError('missing expiry');
    }
    if (grant.exp * 1_000 <= now) throw new InvalidBlobTokenError('expired');
    return grant;
  }

  private mac(payload: string): string {
    return encode(createHmac('sha256', this.secret).update(payload).digest());
  }
}
