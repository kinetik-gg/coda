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
  | 'entry-count-exceeded'
  | 'total-size-exceeded'
  | 'duplicate-entry'
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

/** Normalises anything `yauzl` emits on the zip file itself into an attributable reason. */
function toBoundedZipReadError(error: Error): BoundedZipReadError {
  return isYauzlPathSafetyError(error)
    ? new BoundedZipReadError('unsafe-entry-name', error.message)
    : new BoundedZipReadError('archive-error', error.message);
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
      zipfile.on('error', (error: Error) => reject(toBoundedZipReadError(error)));
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

/**
 * Package-wide ceilings, on top of the per-entry ones. An OOXML package is a
 * whole directory tree, so two failure modes exist that a single-entry read
 * cannot see: an archive with an absurd number of entries (each cheap, the
 * aggregate not), and an archive whose entries are individually under the cap
 * but collectively enormous.
 */
export interface BoundedZipPackageLimits extends BoundedZipReaderLimits {
  /** Reject the archive once its central directory lists more entries than this. */
  maxEntryCount: number;
  /** Reject the archive once the declared uncompressed sizes sum past this. */
  maxTotalUncompressedBytes: number;
}

export interface BoundedZipPackage {
  /** Every entry name the central directory listed, in order, including directories. */
  readonly entryNames: readonly string[];
  /** Only the requested entries, inflated under the per-entry caps. */
  readonly parts: ReadonlyMap<string, Buffer>;
}

interface PackageScanState {
  readonly entryNames: string[];
  readonly seen: Set<string>;
  readonly parts: Map<string, Buffer>;
  declaredBytes: number;
}

function isDirectoryEntry(name: string): boolean {
  return name.endsWith('/');
}

/**
 * Applies every guard an entry must pass *before* anything is inflated: the
 * per-entry name/declared-size/ratio checks from {@link guardEntry}, plus the
 * package-wide entry-count, duplicate-name, and aggregate-size checks. Duplicate
 * names matter beyond tidiness — a package carrying two `word/document.xml`
 * entries is a classic parser-confusion attack, where a validator and a consumer
 * disagree about which one is "the" part.
 */
function admitPackageEntry(
  entry: Entry,
  state: PackageScanState,
  limits: BoundedZipPackageLimits,
): void {
  state.entryNames.push(entry.fileName);
  if (state.entryNames.length > limits.maxEntryCount) {
    throw new BoundedZipReadError(
      'entry-count-exceeded',
      `Archive lists more than the ${limits.maxEntryCount}-entry cap`,
    );
  }
  if (state.seen.has(entry.fileName)) {
    throw new BoundedZipReadError('duplicate-entry', `Archive repeats entry ${entry.fileName}`);
  }
  state.seen.add(entry.fileName);
  if (isDirectoryEntry(entry.fileName)) return;
  guardEntry(entry, limits);
  state.declaredBytes += entry.uncompressedSize;
  if (state.declaredBytes > limits.maxTotalUncompressedBytes) {
    throw new BoundedZipReadError(
      'total-size-exceeded',
      `Archive declares more than the ${limits.maxTotalUncompressedBytes}-byte total cap`,
    );
  }
}

/**
 * Walks an archive's central directory once, guarding *every* entry — not only
 * the ones the caller wants — and inflating just the named entries under the
 * per-entry caps.
 *
 * Guarding entries that are never read is deliberate: a decompression bomb
 * hidden in `word/media/image1.png` is still a bomb for whatever opens the
 * package next, and rejecting the whole package on sight costs one integer
 * comparison per central-directory record. Nothing is inflated to reach that
 * verdict.
 */
export async function readBoundedZipPackage(
  archiveBytes: Buffer,
  wantedEntries: readonly string[],
  limits: BoundedZipPackageLimits,
): Promise<BoundedZipPackage> {
  const wanted = new Set(wantedEntries);
  const zipfile = await openZipFromBuffer(archiveBytes);
  try {
    return await new Promise<BoundedZipPackage>((resolve, reject) => {
      const state: PackageScanState = {
        entryNames: [],
        seen: new Set(),
        parts: new Map(),
        declaredBytes: 0,
      };
      const fail = (error: unknown): void => {
        reject(error instanceof Error ? error : new BoundedZipReadError('archive-error', 'Failed'));
      };
      zipfile.on('error', (error: Error) => reject(toBoundedZipReadError(error)));
      zipfile.on('end', () => resolve({ entryNames: state.entryNames, parts: state.parts }));
      zipfile.on('entry', (entry: Entry) => {
        try {
          admitPackageEntry(entry, state, limits);
        } catch (error) {
          fail(error);
          return;
        }
        if (!wanted.has(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            fail(new BoundedZipReadError('archive-error', error?.message ?? 'Could not open entry'));
            return;
          }
          readStreamBounded(stream, limits.maxEntryBytes).then((buffer) => {
            state.parts.set(entry.fileName, buffer);
            zipfile.readEntry();
          }, fail);
        });
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}
