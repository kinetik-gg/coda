import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ArchiveByteReader,
  BACKUP_ARCHIVE_MAGIC,
  MAX_SIGNATURE_BYTES,
  readArchiveHeader,
  writeArchiveHeader,
} from './backup-archive';
import { BufferSink } from './backup-core.test';

function chunked(buffer: Buffer, size: number): Readable {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    parts.push(buffer.subarray(offset, offset + size));
  }
  return Readable.from(parts);
}

describe('archive framing', () => {
  it('writes and reads a header across chunk boundaries', async () => {
    const sink = new BufferSink();
    const manifest = Buffer.from('{"formatVersion":1,"n":"value"}\n');
    const signature = `${'A'.repeat(86)}==\n`;
    await writeArchiveHeader(sink, manifest, signature);
    const payload = Buffer.from('entry-payload-bytes');
    const archive = Buffer.concat([sink.bytes(), payload]);

    const reader = new ArchiveByteReader(chunked(archive, 3));
    const header = await readArchiveHeader(reader);
    expect(header.manifestBytes).toEqual(manifest);
    expect(header.signatureText).toBe(signature);

    const received: Buffer[] = [];
    await reader.pipeExactly(payload.length, (chunk) => {
      received.push(Buffer.from(chunk));
    });
    expect(Buffer.concat(received)).toEqual(payload);
  });

  it('rejects a bad magic prefix', async () => {
    const reader = new ArchiveByteReader(chunked(Buffer.from('NOT-A-CODA-ARCHIVE!!'), 4));
    await expect(readArchiveHeader(reader)).rejects.toThrow(/not a Coda backup archive/u);
  });

  it('rejects a truncated stream', async () => {
    const reader = new ArchiveByteReader(chunked(BACKUP_ARCHIVE_MAGIC.subarray(0, 4), 2));
    await expect(reader.readExactly(BACKUP_ARCHIVE_MAGIC.length)).rejects.toThrow(
      /ended before the expected length/u,
    );
  });

  it('rejects an oversized signature length declaration', async () => {
    const sink = new BufferSink();
    const manifest = Buffer.from('{}');
    const oversized = `${'A'.repeat(MAX_SIGNATURE_BYTES)}==\n`;
    await expect(writeArchiveHeader(sink, manifest, oversized)).rejects.toThrow(
      /signature is too large/u,
    );
  });
});
