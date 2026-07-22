import { describe, expect, it } from 'vitest';
import {
  assertJavaScriptChunkSizes,
  findOversizedJavaScriptChunks,
  MAX_JAVASCRIPT_CHUNK_BYTES,
} from './chunk-size-guard';

describe('JavaScript chunk size guard', () => {
  it('accepts chunks at the 500 KiB raw limit', () => {
    const chunks = [{ fileName: 'index.js', code: 'a'.repeat(MAX_JAVASCRIPT_CHUNK_BYTES) }];

    expect(findOversizedJavaScriptChunks(chunks)).toEqual([]);
    expect(() => assertJavaScriptChunkSizes(chunks)).not.toThrow();
  });

  it('reports oversized chunks using their UTF-8 byte size', () => {
    const chunks = [
      { fileName: 'index.js', code: 'a'.repeat(MAX_JAVASCRIPT_CHUNK_BYTES + 1) },
      { fileName: 'unicode.js', code: '€' },
    ];

    expect(findOversizedJavaScriptChunks(chunks, 2)).toEqual([
      { fileName: 'index.js', sizeBytes: MAX_JAVASCRIPT_CHUNK_BYTES + 1 },
      { fileName: 'unicode.js', sizeBytes: 3 },
    ]);
    expect(() => assertJavaScriptChunkSizes(chunks, 2)).toThrowError(
      /JavaScript chunk size limit exceeded \(2 bytes\).*unicode\.js: 3 bytes/,
    );
  });
});
