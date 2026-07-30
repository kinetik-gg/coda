/**
 * A bounded OOXML/ZIP entry reader, built on `yauzl`.
 *
 * This is the outcome of the #247 DOCX qualification spike: `yauzl` was chosen
 * over `jszip` (which `mammoth` and most "one-call" DOCX libraries embed)
 * because `yauzl` exposes a per-entry `Readable` stream rather than inflating
 * an entry into an in-memory buffer for you. That distinction is the whole
 * reason it can enforce a limit *during* inflation instead of after it: the
 * caller counts bytes as they arrive and destroys the stream the moment the
 * running total crosses a cap, so a hostile archive never gets to hold its
 * full decompressed size in memory even transiently.
 *
 * That matters specifically because of how the adapter runtime bounds memory
 * (`apps/api/src/imports/adapter-runtime/screenplay-adapter-worker-host.ts`):
 * `resourceLimits.maxOldGenerationSizeMb` only bounds the V8 heap. A decompressed
 * `Buffer`'s backing store is external memory the heap ceiling cannot see, so a
 * candidate that inflates first and measures after (as `jszip` does) can balloon
 * real process memory well past the configured ceiling before anything reports
 * a `memory` failure. Measured: inflating a 509,730-byte deflate stream that
 * declares 524,288,000 bytes (500 MiB of zero bytes) through `jszip.loadAsync`
 * took the process from ~48 MB RSS to ~1,169 MB RSS while `heapUsed` moved from
 * 10.6 MB to only 13.8 MB — invisible to the heap ceiling, visible to the OS.
 *
 * `yauzl` also indepedently cross-checks the declared uncompressed size against
 * the bytes actually produced while streaming and errors out itself if they
 * disagree (observed: an entry that declared 100 bytes but deflated to 60 MiB of
 * real payload was rejected by `yauzl` after the first 16,384-byte chunk, with
 * "too many bytes in the stream"), and it rejects `..`-relative and absolute
 * entry names by construction. This reader adds the caller-side declared-size
 * cap, a compression-ratio cap, and the streaming byte cap on top of those.
 */
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

export interface BoundedZipReaderLimits {
  /** Reject an entry outright if its declared uncompressed size exceeds this. */
  maxEntryBytes: number;
  /** Reject an entry outright if uncompressedSize / compressedSize exceeds this. */
  maxCompressionRatio: number;
}

export type BoundedZipReadFailureReason =
  | 'declared-size-exceeded'
  | 'compression-ratio-exceeded'
  | 'unsafe-entry-name'
  | 'stream-exceeded-cap'
  | 'archive-error';

export class BoundedZipReadError extends Error {
  constructor(
    readonly reason: BoundedZipReadFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'BoundedZipReadError';
  }
}

function isUnsafeEntryName(name: string): boolean {
  return name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/u.test(name);
}

/**
 * `yauzl` itself refuses to enumerate an entry with an absolute or
 * `..`-relative path (it emits an `error` event on the zip file rather than an
 * `entry` event), which is the same defect class this reader's own
 * {@link isUnsafeEntryName} check targets. Recognising its message keeps that
 * rejection attributable as `unsafe-entry-name` instead of a generic archive
 * error, since callers branch on `reason`.
 */
function isYauzlPathSafetyError(error: Error): boolean {
  return /invalid relative path|absolute path/iu.test(error.message);
}

function openZipFromBuffer(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(
          new BoundedZipReadError('archive-error', error?.message ?? 'Could not open archive'),
        );
        return;
      }
      resolve(zipfile);
    });
  });
}

function guardEntry(entry: Entry, limits: BoundedZipReaderLimits): void {
  if (isUnsafeEntryName(entry.fileName)) {
    throw new BoundedZipReadError('unsafe-entry-name', `Unsafe entry name: ${entry.fileName}`);
  }
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new BoundedZipReadError(
      'declared-size-exceeded',
      `Entry ${entry.fileName} declares ${entry.uncompressedSize} bytes, over the ${limits.maxEntryBytes} cap`,
    );
  }
  const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : Infinity;
  if (ratio > limits.maxCompressionRatio) {
    throw new BoundedZipReadError(
      'compression-ratio-exceeded',
      `Entry ${entry.fileName} has a ${ratio.toFixed(1)}x compression ratio, over the ${limits.maxCompressionRatio}x cap`,
    );
  }
}

function readStreamBounded(stream: Readable, maxEntryBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxEntryBytes) {
        stream.destroy(
          new BoundedZipReadError(
            'stream-exceeded-cap',
            `Entry exceeded the ${maxEntryBytes}-byte cap during inflation`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error: Error) => reject(error));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Reads one named entry out of a ZIP/OOXML archive, enforcing `limits` before
 * and during inflation. Resolves with `undefined` if the entry is not present,
 * so a missing `word/document.xml` is distinguishable from a rejected one.
 */
export async function readBoundedZipEntry(
  archiveBytes: Buffer,
  entryName: string,
  limits: BoundedZipReaderLimits,
): Promise<Buffer | undefined> {
  const zipfile = await openZipFromBuffer(archiveBytes);
  try {
    return await new Promise<Buffer | undefined>((resolve, reject) => {
      zipfile.on('error', (error: Error) =>
        reject(
          isYauzlPathSafetyError(error)
            ? new BoundedZipReadError('unsafe-entry-name', error.message)
            : new BoundedZipReadError('archive-error', error.message),
        ),
      );
      zipfile.readEntry();
      zipfile.on('entry', (entry: Entry) => {
        if (entry.fileName !== entryName) {
          zipfile.readEntry();
          return;
        }
        try {
          guardEntry(entry, limits);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Entry failed guard checks'));
          return;
        }
        zipfile.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(
              new BoundedZipReadError('archive-error', error?.message ?? 'Could not open entry'),
            );
            return;
          }
          readStreamBounded(stream, limits.maxEntryBytes).then(resolve, reject);
        });
      });
      zipfile.on('end', () => resolve(undefined));
    });
  } finally {
    zipfile.close();
  }
}
