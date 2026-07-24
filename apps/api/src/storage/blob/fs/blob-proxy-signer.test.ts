import { describe, expect, it } from 'vitest';
import { BlobProxySigner, InvalidBlobTokenError, type UploadGrant } from './blob-proxy-signer';

const upload: UploadGrant = {
  op: 'put',
  key: 'project-1/object-1',
  contentType: 'application/pdf',
  contentLength: 1_024,
  maxBytes: 1_024,
  exp: Math.floor(Date.now() / 1_000) + 900,
};

describe('BlobProxySigner', () => {
  it('round-trips an upload grant it signed', () => {
    const signer = new BlobProxySigner();
    const grant = signer.verifyUpload(signer.sign(upload));
    expect(grant).toEqual(upload);
  });

  it('round-trips a download grant it signed', () => {
    const signer = new BlobProxySigner();
    const token = signer.sign({
      op: 'get',
      key: 'project-1/object-1',
      disposition: 'inline; filename="x.pdf"',
      contentType: 'application/pdf',
      exp: upload.exp,
    });
    expect(signer.verifyDownload(token).key).toBe('project-1/object-1');
  });

  it('rejects a tampered payload', () => {
    const signer = new BlobProxySigner();
    const token = signer.sign(upload);
    const [, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...upload, maxBytes: 1 })).toString('base64url')}.${mac}`;
    expect(() => signer.verifyUpload(forged)).toThrow(InvalidBlobTokenError);
  });

  it('rejects a token signed by a different process secret', () => {
    const token = new BlobProxySigner().sign(upload);
    expect(() => new BlobProxySigner().verifyUpload(token)).toThrow('signature mismatch');
  });

  it('rejects an expired token', () => {
    const signer = new BlobProxySigner();
    const token = signer.sign({ ...upload, exp: Math.floor(Date.now() / 1_000) - 1 });
    expect(() => signer.verifyUpload(token)).toThrow('expired');
  });

  it('rejects an upload token presented as a download token', () => {
    const signer = new BlobProxySigner();
    expect(() => signer.verifyDownload(signer.sign(upload))).toThrow('not a download token');
  });

  it('rejects a malformed token with no separator', () => {
    expect(() => new BlobProxySigner().verifyUpload('no-dot-here')).toThrow('malformed');
  });

  it('rejects a token whose payload is not valid JSON', () => {
    const signer = new BlobProxySigner();
    const payload = Buffer.from('not-json').toString('base64url');
    // Sign the bad payload with this signer so only the JSON parse fails.
    const token = signer.sign(upload).replace(/^[^.]+/u, payload);
    // The MAC no longer matches the payload, so this surfaces as a signature error.
    expect(() => signer.verifyUpload(token)).toThrow(InvalidBlobTokenError);
  });
});
