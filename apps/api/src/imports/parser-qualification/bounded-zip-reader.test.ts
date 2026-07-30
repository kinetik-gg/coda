import { describe, expect, it } from 'vitest';
import {
  liedDeclaredSizeFixture,
  modestBombFixture,
  nestedZipFixture,
  pathTraversalFixture,
  wellFormedFixture,
  zipBombFixture,
} from './adversarial-zip-fixtures';
import { readBoundedZipEntry } from './bounded-zip-reader';
import type { BoundedZipReadError } from './bounded-zip-reader';

// Mirrors the real ceilings so this test proves the reader against the numbers
// #248 will actually configure it with, not an arbitrary test-only cap.
const LIMITS = { maxEntryBytes: 20 * 1024 * 1024, maxCompressionRatio: 200 };

describe('readBoundedZipEntry', () => {
  it('reads an ordinary small entry', async () => {
    const bytes = await readBoundedZipEntry(wellFormedFixture(), 'word/document.xml', LIMITS);
    expect(bytes?.toString('utf8')).toBe('<xml>hello world</xml>');
  });

  it('resolves undefined for an entry the archive does not contain', async () => {
    const bytes = await readBoundedZipEntry(wellFormedFixture(), 'word/missing.xml', LIMITS);
    expect(bytes).toBeUndefined();
  });

  it('rejects a zip bomb before inflation, by declared size', async () => {
    // A far smaller declared size than the ~500 MiB used in the qualification
    // spike (documented in docs/adr-rtf-docx-parser-qualification.md): the
    // declared-size gate reads the central directory, not the payload, so it
    // proves the same property against a 4 KiB entry over a 1 KiB cap for a
    // fraction of the fixture-construction cost (each entry's CRC32 is a full
    // pass over its uncompressed bytes, before compression even runs).
    const smallLimits = { maxEntryBytes: 1024, maxCompressionRatio: 200 };
    await expect(
      readBoundedZipEntry(zipBombFixture(4096), 'word/document.xml', smallLimits),
    ).rejects.toMatchObject({
      reason: 'declared-size-exceeded',
    } satisfies Partial<BoundedZipReadError>);
  });

  it('rejects a modest bomb over the input ceiling before inflation', async () => {
    // The declared-size gate reads the central directory, not the payload, so
    // it does not need a realistically large bomb to prove itself: a 4 KiB
    // entry over a 1 KiB cap exercises the same code path as a 40 MiB entry
    // over a 20 MiB cap, for a fraction of the fixture-construction cost (each
    // entry's CRC32 is a full pass over its uncompressed bytes). Kept small so
    // this test's cost is milliseconds on every runner, not just a fast one.
    const smallLimits = { maxEntryBytes: 1024, maxCompressionRatio: 200 };
    await expect(
      readBoundedZipEntry(modestBombFixture(4096), 'word/document.xml', smallLimits),
    ).rejects.toMatchObject({
      reason: 'declared-size-exceeded',
    } satisfies Partial<BoundedZipReadError>);
  });

  it('rejects a compression ratio over the cap even under the byte ceiling', async () => {
    // 256 KiB of a single repeated byte deflates to well under 1 KiB —
    // comfortably over a 200x ratio cap while its declared size alone would
    // still pass a 20 MiB byte ceiling. Small on purpose: the ratio, not the
    // absolute size, is what this test exercises.
    const highRatioButSmall = modestBombFixture(256 * 1024);
    await expect(
      readBoundedZipEntry(highRatioButSmall, 'word/document.xml', LIMITS),
    ).rejects.toMatchObject({
      reason: 'compression-ratio-exceeded',
    } satisfies Partial<BoundedZipReadError>);
  });

  it('rejects a path-traversal entry name rather than reading it', async () => {
    await expect(
      readBoundedZipEntry(pathTraversalFixture(), '../../../../etc/passwd', LIMITS),
    ).rejects.toMatchObject({ reason: 'unsafe-entry-name' } satisfies Partial<BoundedZipReadError>);
  });

  it('aborts mid-stream when the declared size lies and the real payload is over cap', async () => {
    // The declared size (100 bytes) is under every cap, so this only fails
    // because the reader (or `yauzl` itself, which cross-checks streamed
    // bytes against the declared size) is watching bytes actually produced
    // while streaming, not merely trusting the header. 200 KiB of real payload
    // is already several multiples of the 16 KiB chunk `yauzl` reads before
    // that mismatch trips — no need for the tens-of-megabytes used in the
    // qualification spike (documented in
    // docs/adr-rtf-docx-parser-qualification.md) to prove the same property,
    // and it keeps this test's CRC32/deflate cost off the critical path.
    await expect(
      readBoundedZipEntry(liedDeclaredSizeFixture(100, 200 * 1024), 'word/document.xml', LIMITS),
    ).rejects.toThrow();
  });

  it('reads through nested archives when the innermost entry is small', async () => {
    // DOCX never nests archives; this documents that a bounded reader applied
    // once per level composes, for a future candidate that does recurse.
    const outer = nestedZipFixture(3);
    const level2 = await readBoundedZipEntry(outer, 'level-2.bin', LIMITS);
    expect(level2).toBeDefined();
    const level1 = await readBoundedZipEntry(level2!, 'level-1.bin', LIMITS);
    expect(level1).toBeDefined();
    const level0 = await readBoundedZipEntry(level1!, 'level-0.bin', LIMITS);
    expect(level0?.toString('utf8')).toBe('leaf content');
  });
});
