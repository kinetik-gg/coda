/**
 * Builds hostile ZIP/OOXML fixtures for the RTF/DOCX dependency qualification
 * (#247) and for #248 to reuse once it builds the real DOCX adapter. These are
 * synthetic containers, built with a minimal local ZIP writer rather than a
 * dependency, so the fixture generator itself never depends on the libraries
 * it is used to qualify.
 *
 * Every fixture targets one failure mode a document parser must survive
 * because the adapter runtime (`apps/api/src/imports/adapter-runtime`) gives it
 * no help: no filesystem, no network, a 256 MB V8 old-generation ceiling that
 * does not see external `ArrayBuffer` memory, and a hard terminate after the
 * configured timeout plus grace period.
 */
import { deflateRawSync } from 'node:zlib';

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  deflate: boolean;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}

/**
 * An indexed loop, not `for...of`: the iterator protocol on a `Buffer` costs far
 * more per byte than a plain index read, and this runs over the full
 * uncompressed payload of every adversarial fixture — including the
 * multi-ten-megabyte ones. Measured on a 40 MiB buffer: ~298 ms with `for...of`
 * versus ~13 ms indexed, which is the difference between a fixture-construction
 * cost invisible in a 5 s test budget and one that eats most of it on a slower
 * CI runner.
 */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(
  entry: ZipEntrySpec,
  compressed: Buffer,
  nameBuf: Buffer,
  crc: number,
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entry.deflate ? 8 : 0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(
  entry: ZipEntrySpec,
  compressed: Buffer,
  nameBuf: Buffer,
  offset: number,
  crc: number,
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.deflate ? 8 : 0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

/** Minimal deterministic ZIP writer: no dependency, so it cannot bias the qualification. */
export function buildZip(entries: readonly ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = entry.deflate ? deflateRawSync(entry.data, { level: 9 }) : entry.data;
    // Computed once and reused for both headers — a full pass over a large
    // fixture's uncompressed payload is exactly the cost this module must not
    // pay twice.
    const crc = crc32(entry.data);
    localParts.push(localHeader(entry, compressed, nameBuf, crc), nameBuf, compressed);
    centralParts.push(centralHeader(entry, compressed, nameBuf, offset, crc), nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  return Buffer.concat([
    localBuf,
    centralBuf,
    endOfCentralDirectory(entries.length, centralBuf.length, localBuf.length),
  ]);
}

/**
 * A single entry whose declared uncompressed size is enormous but whose
 * compressed payload is tiny (all-zero bytes deflate to almost nothing). This
 * is the classic zip-bomb shape: a candidate that inflates before checking the
 * declared size will balloon process memory the V8 heap ceiling cannot see,
 * because a decompressed `Buffer`'s backing store is external memory.
 */
export function zipBombFixture(uncompressedBytes = 500 * 1024 * 1024): Buffer {
  return buildZip([
    { name: 'word/document.xml', data: Buffer.alloc(uncompressedBytes, 0), deflate: true },
  ]);
}

/** A more modest bomb sized just over a plausible input ceiling, to check off-by-one admission. */
export function modestBombFixture(uncompressedBytes = 40 * 1024 * 1024): Buffer {
  return buildZip([
    { name: 'word/document.xml', data: Buffer.alloc(uncompressedBytes, 0x41), deflate: true },
  ]);
}

/** An entry name that attempts to escape the archive root, e.g. `../../etc/passwd`. */
export function pathTraversalFixture(): Buffer {
  return buildZip([
    {
      name: '../../../../etc/passwd',
      data: Buffer.from('root:x:0:0::/root:/bin/sh\n', 'utf8'),
      deflate: false,
    },
    { name: 'word/document.xml', data: Buffer.from('<xml>hi</xml>', 'utf8'), deflate: false },
  ]);
}

/**
 * A single small, ordinary-looking entry so a bounded reader's happy path can be
 * exercised against the same fixture shape as the hostile ones.
 */
export function wellFormedFixture(): Buffer {
  return buildZip([
    {
      name: 'word/document.xml',
      data: Buffer.from('<xml>hello world</xml>', 'utf8'),
      deflate: true,
    },
  ]);
}

/**
 * A zip nested inside a zip inside a zip (5 levels). DOCX itself never nests
 * archives, but a candidate that recurses into any entry that looks like a zip
 * (some "universal" office parsers do, to support attachments) must still
 * terminate; this fixture is small on purpose so nesting depth, not size, is
 * what is under test.
 */
export function nestedZipFixture(depth = 5): Buffer {
  let payload: Buffer<ArrayBufferLike> = Buffer.from('leaf content', 'utf8');
  for (let level = 0; level < depth; level += 1) {
    payload = buildZip([{ name: `level-${level}.bin`, data: payload, deflate: true }]);
  }
  return payload;
}

/**
 * An entry whose local/central header declares a tiny uncompressed size while
 * the actual compressed payload inflates to something far larger. This checks
 * whether a candidate trusts the declared size (attacker-controlled) or
 * verifies it against the bytes actually produced during inflation.
 */
export function liedDeclaredSizeFixture(
  declaredBytes = 100,
  actualBytes = 60 * 1024 * 1024,
): Buffer {
  const real = Buffer.alloc(actualBytes, 0x42);
  const compressed = deflateRawSync(real, { level: 9 });
  const crc = crc32(real);
  const name = Buffer.from('word/document.xml', 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(declaredBytes, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  const localBuf = Buffer.concat([header, name, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredBytes, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralBuf = Buffer.concat([central, name]);

  return Buffer.concat([
    localBuf,
    centralBuf,
    endOfCentralDirectory(1, centralBuf.length, localBuf.length),
  ]);
}

/**
 * XML "billion laughs" entity expansion, shaped as an OOXML `word/document.xml`
 * payload would be if an attacker controlled it directly (no external DTD
 * fetch needed — the entities are declared inline). Ten levels of ten-fold
 * self-reference expand a ~800 byte document to roughly 10^10 characters if a
 * parser resolves internal general entities.
 */
export function billionLaughsXml(levels = 9, fanout = 10): string {
  const lines = ['<?xml version="1.0"?>', '<!DOCTYPE lolz ['];
  lines.push('<!ENTITY lol0 "lol">');
  for (let level = 1; level <= levels; level += 1) {
    const reference = `&lol${level - 1};`.repeat(fanout);
    lines.push(`<!ENTITY lol${level} "${reference}">`);
  }
  lines.push(']>', `<root>&lol${levels};</root>`);
  return lines.join('\n');
}

/** Deeply nested RTF groups: `{{{...x...}}}`, for #249 to test any candidate's recursion bound. */
export function deeplyNestedRtfGroups(depth = 200_000): string {
  return `{\\rtf1 ${'{'.repeat(depth)}x${'}'.repeat(depth)}}`;
}

/** A flood of control words on one line, to check a candidate tokenizes without a per-token allocation blowup. */
export function rtfControlWordFlood(count = 2_000_000): string {
  return `{\\rtf1 ${'\\b0 '.repeat(count)}}`;
}
