import type { Writable } from 'node:stream';

/**
 * Streaming container framing for backup archives.
 *
 * Layout (all integers big-endian):
 *
 * ```
 * "CODA-BK1"            8-byte magic
 * uint32 manifestLength
 * manifest JSON bytes
 * uint32 signatureLength
 * Ed25519 signature bytes (base64 text)
 * <entry content>        raw bytes, one per manifest entry, database first then objects
 * ```
 *
 * The manifest and its signature lead the stream so a reader can authenticate the
 * archive and enforce the format-version window before a single content byte is
 * written anywhere. Entry lengths are taken from the signed manifest, so the frame
 * itself stays minimal and every payload boundary is covered by the signature.
 */
export const BACKUP_ARCHIVE_MAGIC = Buffer.from('CODA-BK1', 'ascii');
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 4096;

export type ChunkSink = (chunk: Buffer) => Promise<void> | void;

function uint32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

export function writeChunk(writable: Writable, chunk: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writable.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

export async function writeArchiveHeader(
  writable: Writable,
  manifestBytes: Buffer,
  signatureText: string,
): Promise<void> {
  const signature = Buffer.from(signatureText, 'utf8');
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large');
  if (signature.length > MAX_SIGNATURE_BYTES) throw new Error('Backup signature is too large');
  await writeChunk(writable, BACKUP_ARCHIVE_MAGIC);
  await writeChunk(writable, uint32(manifestBytes.length));
  await writeChunk(writable, manifestBytes);
  await writeChunk(writable, uint32(signature.length));
  await writeChunk(writable, signature);
}

/**
 * Pull-based reader over an async iterable of buffers. Exposes exact-length reads
 * for framing fields and a streaming pump for large entry payloads so that no
 * entry is ever fully buffered in memory.
 */
export class ArchiveByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    return true;
  }

  async readExactly(length: number): Promise<Buffer> {
    while (this.buffer.length < length) {
      if (!(await this.fill())) throw new Error('Backup archive ended before the expected length');
    }
    const out = Buffer.from(this.buffer.subarray(0, length));
    this.buffer = this.buffer.subarray(length);
    return out;
  }

  async pipeExactly(length: number, sink: ChunkSink): Promise<void> {
    let remaining = length;
    while (remaining > 0) {
      if (this.buffer.length === 0 && !(await this.fill())) {
        throw new Error('Backup archive ended before the expected length');
      }
      const take = Math.min(remaining, this.buffer.length);
      await sink(this.buffer.subarray(0, take));
      this.buffer = this.buffer.subarray(take);
      remaining -= take;
    }
  }
}

export interface ArchiveHeader {
  manifestBytes: Buffer;
  signatureText: string;
}

export async function readArchiveHeader(reader: ArchiveByteReader): Promise<ArchiveHeader> {
  const magic = await reader.readExactly(BACKUP_ARCHIVE_MAGIC.length);
  if (!magic.equals(BACKUP_ARCHIVE_MAGIC)) {
    throw new Error('Input is not a Coda backup archive');
  }
  const manifestLength = (await reader.readExactly(4)).readUInt32BE(0);
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES) {
    throw new Error('Backup archive declares an unreasonable manifest length');
  }
  const manifestBytes = await reader.readExactly(manifestLength);
  const signatureLength = (await reader.readExactly(4)).readUInt32BE(0);
  if (signatureLength === 0 || signatureLength > MAX_SIGNATURE_BYTES) {
    throw new Error('Backup archive declares an unreasonable signature length');
  }
  const signatureText = (await reader.readExactly(signatureLength)).toString('utf8');
  return { manifestBytes, signatureText };
}
