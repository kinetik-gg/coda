import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { pipeSnapshotExport } from './snapshot-export-response';

describe('pipeSnapshotExport', () => {
  it('aborts a stalled client and closes the source iterator', async () => {
    const closed = vi.fn();
    async function* content(): AsyncGenerator<string> {
      try {
        await Promise.resolve();
        for (;;) yield 'x'.repeat(64 * 1_024);
      } finally {
        closed();
      }
    }
    const stalled = new Writable({
      highWaterMark: 1,
      write(chunk, encoding, callback) {
        // Intentionally withhold the callback to model a client that stopped reading.
        void chunk;
        void encoding;
        void callback;
      },
    });

    await expect(pipeSnapshotExport(content(), stalled, 20)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(closed).toHaveBeenCalledOnce();
  });
});
