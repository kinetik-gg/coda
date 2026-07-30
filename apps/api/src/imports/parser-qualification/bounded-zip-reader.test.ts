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
    // A smaller declared size than the ~500 MiB used in the qualification
    // spike (documented in docs/adr-rtf-docx-parser-qualification.md): the
    // declared-size gate does not care how large the lie is, and a smaller
    // fixture keeps this test's deflate cost off the critical path.
    await expect(
      readBoundedZipEntry(zipBombFixture(30 * 1024 * 1024), 'word/document.xml', LIMITS),
    ).rejects.toMatchObject({
      reason: 'declared-size-exceeded',
    } satisfies Partial<BoundedZipReadError>);
  });

  it('rejects a modest bomb over the input ceiling before inflation', async () => {
    await expect(
      readBoundedZipEntry(modestBombFixture(), 'word/document.xml', LIMITS),
    ).rejects.toMatchObject({
      reason: 'declared-size-exceeded',
    } satisfies Partial<BoundedZipReadError>);
  });

  it('rejects a compression ratio over the cap even under the byte ceiling', async () => {
    // 10 MiB of zero bytes deflates to a few KB: far over a 200x ratio cap,
    // but its declared size alone would pass a 20 MiB byte ceiling.
    const highRatioButSmall = modestBombFixture(10 * 1024 * 1024);
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
    // because the reader is also watching bytes actually produced while
    // streaming, not merely trusting the header.
    await expect(
      readBoundedZipEntry(
        liedDeclaredSizeFixture(100, 60 * 1024 * 1024),
        'word/document.xml',
        LIMITS,
      ),
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
