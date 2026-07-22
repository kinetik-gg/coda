import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const SNAPSHOT_RESPONSE_TIMEOUT_MS = 2 * 60_000;

/** Abort stalled clients so they cannot retain an export admission slot. */
export async function pipeSnapshotExport(
  content: AsyncIterable<string>,
  destination: Writable,
  timeoutMs = SNAPSHOT_RESPONSE_TIMEOUT_MS,
): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), timeoutMs);
  timeout.unref();
  try {
    await pipeline(Readable.from(content, { objectMode: false }), destination, {
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
