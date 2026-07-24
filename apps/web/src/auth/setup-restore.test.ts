import { describe, expect, it, vi } from 'vitest';
import { streamSetupRestore } from './setup-restore';

function ndjsonResponse(lines: string[], ok = true, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

describe('streamSetupRestore', () => {
  it('sends the archive with the setup token and reports progress then completion', async () => {
    const progress: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ event: 'progress', phase: 'verify-archive' }),
          JSON.stringify({ event: 'progress', phase: 'restore-object', index: 1, total: 2 }),
          JSON.stringify({ status: 'complete', appVersion: '0.0.4' }),
        ]),
      );
    const result = await streamSetupRestore(
      new Blob([Buffer.from('archive')]),
      'setup-token',
      (p) => progress.push(p.phase),
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.appVersion).toBe('0.0.4');
    expect(progress).toEqual(['verify-archive', 'restore-object']);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['x-coda-setup-token']).toBe('setup-token');
    expect(init.headers['content-type']).toBe('application/octet-stream');
  });

  it('omits the setup-token header when none is provided', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ndjsonResponse([JSON.stringify({ status: 'complete' })]));
    await streamSetupRestore(
      new Blob(['x']),
      undefined,
      () => {},
      fetchImpl as unknown as typeof fetch,
    );
    const init = fetchImpl.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['x-coda-setup-token']).toBeUndefined();
  });

  it('throws the problem detail when the request is rejected before streaming', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'The instance setup token is invalid' }),
    });
    await expect(
      streamSetupRestore(new Blob(['x']), 'bad', () => {}, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('The instance setup token is invalid');
  });

  it('throws the terminal error message when the restore fails mid-stream', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ event: 'progress', phase: 'verify-archive' }),
          JSON.stringify({ status: 'error', message: 'Backup manifest signature is invalid' }),
        ]),
      );
    await expect(
      streamSetupRestore(
        new Blob(['x']),
        undefined,
        () => {},
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Backup manifest signature is invalid');
  });

  it('throws when the stream ends before a completion line', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse([JSON.stringify({ event: 'progress', phase: 'verify-archive' })]),
      );
    await expect(
      streamSetupRestore(
        new Blob(['x']),
        undefined,
        () => {},
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/ended before it completed/);
  });
});
