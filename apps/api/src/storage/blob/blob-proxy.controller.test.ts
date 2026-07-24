import { PassThrough, Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BlobProxyController } from './blob-proxy.controller';
import { BlobNotFoundError } from './blob-store';
import { InvalidBlobTokenError } from './fs/blob-proxy-signer';
import { BlobAlreadyExistsError, BlobKeyError, BlobTooLargeError } from './fs/fs-blob-store';

interface FakeResponse extends PassThrough {
  statusCode: number;
  headers: Record<string, string>;
  status(code: number): FakeResponse;
  setHeader(name: string, value: string): void;
  ended: boolean;
}

function fakeResponse(): FakeResponse {
  const response = new PassThrough() as FakeResponse;
  response.statusCode = 200;
  response.headers = {};
  response.ended = false;
  response.status = (code: number) => {
    response.statusCode = code;
    return response;
  };
  response.setHeader = (name: string, value: string) => {
    response.headers[name.toLowerCase()] = value;
  };
  const originalEnd = response.end.bind(response);
  response.end = ((...args: unknown[]) => {
    response.ended = true;
    return originalEnd(...(args as []));
  }) as typeof response.end;
  return response;
}

function providerWith(overrides: Record<string, unknown> = {}): {
  provider: {
    verifyUpload: ReturnType<typeof vi.fn>;
    verifyDownload: ReturnType<typeof vi.fn>;
    active: ReturnType<typeof vi.fn>;
  };
  store: {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
  };
} {
  const store = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ stream: Readable.from([Buffer.from('body')]) }),
    stat: vi.fn().mockResolvedValue({ size: 4, contentType: 'application/pdf' }),
    ...overrides,
  };
  const provider = {
    verifyUpload: vi.fn().mockReturnValue({
      op: 'put',
      key: 'project-1/object-1',
      contentType: 'application/pdf',
      contentLength: 4,
      maxBytes: 4,
      exp: 0,
    }),
    verifyDownload: vi.fn().mockReturnValue({
      op: 'get',
      key: 'project-1/object-1',
      disposition: 'inline; filename="x.pdf"',
      contentType: 'application/pdf',
      exp: 0,
    }),
    active: vi.fn().mockReturnValue(store),
  };
  return { provider, store };
}

function controllerWith(overrides: Record<string, unknown> = {}): {
  controller: BlobProxyController;
  provider: ReturnType<typeof providerWith>['provider'];
  store: ReturnType<typeof providerWith>['store'];
} {
  const { provider, store } = providerWith(overrides);
  return { controller: new BlobProxyController(provider as never), provider, store };
}

function request(
  headers: Record<string, string> = {},
): Readable & { get: (name: string) => string | undefined } {
  const stream = Readable.from([Buffer.from('body')]) as Readable & {
    get: (name: string) => string | undefined;
  };
  stream.get = (name: string) => headers[name.toLowerCase()];
  return stream;
}

describe('BlobProxyController upload', () => {
  it('streams the body into the store as a conditional create and returns 201', async () => {
    const { controller, store } = controllerWith();
    const response = fakeResponse();
    await controller.upload('token', request() as never, response as never);
    expect(store.put).toHaveBeenCalledWith(
      'project-1/object-1',
      expect.anything(),
      expect.objectContaining({ ifNoneMatch: true, maxBytes: 4, contentType: 'application/pdf' }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.ended).toBe(true);
  });

  it('rejects an invalid token with 403', async () => {
    const { controller, provider } = controllerWith();
    provider.verifyUpload.mockImplementation(() => {
      throw new InvalidBlobTokenError('expired');
    });
    await expect(
      controller.upload('token', request() as never, fakeResponse() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps an over-ceiling upload to 413', async () => {
    const { controller } = controllerWith({
      put: vi.fn().mockRejectedValue(new BlobTooLargeError(4)),
    });
    const response = fakeResponse();
    await controller.upload('token', request() as never, response as never);
    expect(response.statusCode).toBe(413);
  });

  it('maps a duplicate key to 409', async () => {
    const { controller } = controllerWith({
      put: vi.fn().mockRejectedValue(new BlobAlreadyExistsError('project-1/object-1')),
    });
    const response = fakeResponse();
    await controller.upload('token', request() as never, response as never);
    expect(response.statusCode).toBe(409);
  });

  it('maps an unsafe key to 400', async () => {
    const { controller } = controllerWith({
      put: vi.fn().mockRejectedValue(new BlobKeyError('../evil')),
    });
    const response = fakeResponse();
    await controller.upload('token', request() as never, response as never);
    expect(response.statusCode).toBe(400);
  });
});

describe('BlobProxyController download', () => {
  it('streams the full object with headers and 200', async () => {
    const { controller } = controllerWith();
    const response = fakeResponse();
    await controller.download('token', request() as never, response as never);
    const body = await collect(response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe('inline; filename="x.pdf"');
    expect(response.headers['content-length']).toBe('4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(body.toString()).toBe('body');
  });

  it('answers a ranged request with 206 and Content-Range', async () => {
    const { controller, store } = controllerWith({
      stat: vi.fn().mockResolvedValue({ size: 11, contentType: 'application/pdf' }),
      get: vi.fn().mockResolvedValue({ stream: Readable.from([Buffer.from('hello')]) }),
    });
    const response = fakeResponse();
    await controller.download('token', request({ range: 'bytes=0-4' }) as never, response as never);
    await collect(response);
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 0-4/11');
    expect(response.headers['content-length']).toBe('5');
    expect(store.get).toHaveBeenCalledWith('project-1/object-1', { range: { start: 0, end: 4 } });
  });

  it('answers a missing object with 404', async () => {
    const { controller } = controllerWith({
      stat: vi.fn().mockRejectedValue(new BlobNotFoundError('project-1/object-1')),
    });
    const response = fakeResponse();
    await controller.download('token', request() as never, response as never);
    expect(response.statusCode).toBe(404);
  });

  it('rejects an invalid download token with 403', async () => {
    const { controller, provider } = controllerWith();
    provider.verifyDownload.mockImplementation(() => {
      throw new InvalidBlobTokenError('expired');
    });
    await expect(
      controller.download('token', request() as never, fakeResponse() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
