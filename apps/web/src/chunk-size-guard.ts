import type { Plugin } from 'vite';

export const MAX_JAVASCRIPT_CHUNK_BYTES = 500 * 1024;

interface JavaScriptChunk {
  code: string;
  fileName: string;
}

interface OversizedChunk {
  fileName: string;
  sizeBytes: number;
}

export function findOversizedJavaScriptChunks(
  chunks: Iterable<JavaScriptChunk>,
  maxBytes = MAX_JAVASCRIPT_CHUNK_BYTES,
): OversizedChunk[] {
  const encoder = new TextEncoder();
  return Array.from(chunks).flatMap(({ code, fileName }) => {
    const sizeBytes = encoder.encode(code).byteLength;
    return sizeBytes > maxBytes ? [{ fileName, sizeBytes }] : [];
  });
}

export function assertJavaScriptChunkSizes(
  chunks: Iterable<JavaScriptChunk>,
  maxBytes = MAX_JAVASCRIPT_CHUNK_BYTES,
): void {
  const oversized = findOversizedJavaScriptChunks(chunks, maxBytes);
  if (oversized.length === 0) return;

  const details = oversized
    .map(({ fileName, sizeBytes }) => `${fileName}: ${sizeBytes} bytes`)
    .join(', ');
  throw new Error(`JavaScript chunk size limit exceeded (${maxBytes} bytes): ${details}`);
}

export function javascriptChunkSizeGuard(maxBytes = MAX_JAVASCRIPT_CHUNK_BYTES): Plugin {
  return {
    name: 'javascript-chunk-size-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? [{ code: output.code, fileName: output.fileName }] : [],
      );
      assertJavaScriptChunkSizes(chunks, maxBytes);
    },
  };
}
