import type { Readable } from 'node:stream';

/** Drains a readable fully into a single buffer. Rejects if the stream errors. */
export async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
