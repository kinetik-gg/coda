/**
 * Minimal, dependency-free QR Code generator (byte mode) used to render the
 * otpauth:// enrollment URI for authenticator apps. Scope is deliberately narrow
 * -- byte mode, error-correction level M, automatic version selection up to
 * version 10 -- which comfortably covers a TOTP provisioning URI while keeping
 * the implementation small and auditable. Follows ISO/IEC 18004.
 */

const ECC_LEVEL_M_BITS = 0b00; // Format-info bits for error-correction level M.

// Per-version, level-M capacity in data codewords and the (numBlocks, eccPerBlock)
// grouping. Index by version (1-based); index 0 is unused.
interface VersionSpec {
  dataCodewords: number;
  eccPerBlock: number;
  group1Blocks: number;
  group1Codewords: number;
  group2Blocks: number;
  group2Codewords: number;
}
const VERSIONS: (VersionSpec | null)[] = [
  null,
  {
    dataCodewords: 16,
    eccPerBlock: 10,
    group1Blocks: 1,
    group1Codewords: 16,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 28,
    eccPerBlock: 16,
    group1Blocks: 1,
    group1Codewords: 28,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 44,
    eccPerBlock: 26,
    group1Blocks: 1,
    group1Codewords: 44,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 64,
    eccPerBlock: 18,
    group1Blocks: 2,
    group1Codewords: 32,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 86,
    eccPerBlock: 24,
    group1Blocks: 2,
    group1Codewords: 43,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 108,
    eccPerBlock: 16,
    group1Blocks: 4,
    group1Codewords: 27,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 124,
    eccPerBlock: 18,
    group1Blocks: 4,
    group1Codewords: 31,
    group2Blocks: 0,
    group2Codewords: 0,
  },
  {
    dataCodewords: 154,
    eccPerBlock: 22,
    group1Blocks: 2,
    group1Codewords: 38,
    group2Blocks: 2,
    group2Codewords: 39,
  },
  {
    dataCodewords: 182,
    eccPerBlock: 22,
    group1Blocks: 3,
    group1Codewords: 36,
    group2Blocks: 2,
    group2Codewords: 37,
  },
  {
    dataCodewords: 216,
    eccPerBlock: 26,
    group1Blocks: 4,
    group1Codewords: 43,
    group2Blocks: 1,
    group2Codewords: 44,
  },
];

// Row/column centres of alignment patterns per version (level-independent).
const ALIGNMENT_CENTERS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// GF(256) log/antilog tables for Reed-Solomon over the QR primitive polynomial.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255]!;
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): number[] {
  // Built constant-first while multiplying by successive (x + a^i); reversed on
  // return so index 0 is the leading (x^degree) coefficient, which is what the
  // long-division remainder in rsEncode expects.
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let term = 0; term < poly.length; term += 1) {
      next[term] = (next[term] ?? 0) ^ gfMultiply(poly[term]!, GF_EXP[index]!);
      next[term + 1] = (next[term + 1] ?? 0) ^ poly[term]!;
    }
    poly = next;
  }
  return poly.reverse();
}

function rsEncode(data: number[], eccCount: number): number[] {
  const generator = rsGeneratorPoly(eccCount);
  const remainder = new Array<number>(eccCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < generator.length - 1; index += 1) {
      remainder[index] = (remainder[index] ?? 0) ^ gfMultiply(generator[index + 1]!, factor);
    }
  }
  return remainder;
}

function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    const spec = VERSIONS[version]!;
    // 4 mode bits + 8 or 16 length bits + payload, rounded up to codewords.
    const lengthBits = version >= 10 ? 16 : 8;
    const requiredBits = 4 + lengthBits + byteLength * 8;
    if (Math.ceil(requiredBits / 8) <= spec.dataCodewords) return version;
  }
  throw new Error('otpauth URI is too long to encode as a QR code');
}

function encodeData(text: string, version: number): number[] {
  const spec = VERSIONS[version]!;
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];
  const pushBits = (value: number, count: number) => {
    for (let index = count - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
  };
  pushBits(0b0100, 4); // Byte mode.
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) pushBits(byte, 8);
  const capacityBits = spec.dataCodewords * 8;
  for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) bits.push(0); // Terminator.
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[index + bit]!;
    codewords.push(byte);
  }
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.dataCodewords) {
    codewords.push(pad[padIndex % 2]!);
    padIndex += 1;
  }
  return codewords;
}

function interleave(dataCodewords: number[], version: number): number[] {
  const spec = VERSIONS[version]!;
  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let cursor = 0;
  const addBlock = (size: number) => {
    const block = dataCodewords.slice(cursor, cursor + size);
    cursor += size;
    blocks.push(block);
    eccBlocks.push(rsEncode(block, spec.eccPerBlock));
  };
  for (let index = 0; index < spec.group1Blocks; index += 1) addBlock(spec.group1Codewords);
  for (let index = 0; index < spec.group2Blocks; index += 1) addBlock(spec.group2Codewords);

  const result: number[] = [];
  const maxData = Math.max(...blocks.map((block) => block.length));
  for (let column = 0; column < maxData; column += 1) {
    for (const block of blocks) if (column < block.length) result.push(block[column]!);
  }
  for (let column = 0; column < spec.eccPerBlock; column += 1) {
    for (const block of eccBlocks) result.push(block[column]!);
  }
  return result;
}

type Matrix = (boolean | null)[][];

function createMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(matrix: Matrix, row: number, column: number): void {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const r = row + dr;
      const c = column + dc;
      if (r < 0 || c < 0 || r >= matrix.length || c >= matrix.length) continue;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      matrix[r]![c] = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (onBorder || inCore)) || false;
    }
  }
}

function placeAlignmentPattern(matrix: Matrix, row: number, column: number): void {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      matrix[row + dr]![column + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
    }
  }
}

function placeAlignmentPatterns(matrix: Matrix, version: number): void {
  const centers = ALIGNMENT_CENTERS[version]!;
  const last = centers[centers.length - 1];
  for (const row of centers) {
    for (const column of centers) {
      // Omit only the three patterns that coincide with the finder patterns; the
      // ones crossing the timing line (e.g. row/column 6) are still drawn.
      const nearFinder =
        (row === 6 && column === 6) ||
        (row === 6 && column === last) ||
        (row === last && column === 6);
      if (!nearFinder) placeAlignmentPattern(matrix, row, column);
    }
  }
}

function placeFunctionPatterns(matrix: Matrix, version: number): void {
  const size = matrix.length;
  placeFinder(matrix, 0, 0);
  placeFinder(matrix, 0, size - 7);
  placeFinder(matrix, size - 7, 0);
  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0;
    if (matrix[6]![index] === null) matrix[6]![index] = dark;
    if (matrix[index]![6] === null) matrix[index]![6] = dark;
  }
  placeAlignmentPatterns(matrix, version);
  matrix[size - 8]![8] = true; // Dark module.
}

function reserveFormatAreas(matrix: Matrix, version: number): void {
  const size = matrix.length;
  for (let index = 0; index < 9; index += 1) {
    if (matrix[8]![index] === null) matrix[8]![index] = false;
    if (matrix[index]![8] === null) matrix[index]![8] = false;
  }
  for (let index = 0; index < 8; index += 1) {
    if (matrix[8]![size - 1 - index] === null) matrix[8]![size - 1 - index] = false;
    if (matrix[size - 1 - index]![8] === null) matrix[size - 1 - index]![8] = false;
  }
  if (version >= 7) {
    for (let index = 0; index < 6; index += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        matrix[index]![size - 11 + offset] = false;
        matrix[size - 11 + offset]![index] = false;
      }
    }
  }
}

function placeData(matrix: Matrix, codewords: number[]): void {
  const size = matrix.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  // Walk column pairs right-to-left; column 6 is the timing line, so once the
  // right edge reaches it, shift the whole traversal left by one.
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let lane = 0; lane < 2; lane += 1) {
        const c = right - lane;
        if (matrix[row]![c] !== null) continue;
        let bit = false;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >> 3]!;
          bit = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        matrix[row]![c] = bit;
      }
    }
    upward = !upward;
  }
}

function maskFunction(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

function isFunctionModule(reserved: Matrix, row: number, column: number): boolean {
  return reserved[row]![column] !== null;
}

function applyMask(data: Matrix, reserved: Matrix, mask: number): Matrix {
  const size = data.length;
  const out = createMatrix(size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = data[row]![column] ?? false;
      out[row]![column] =
        !isFunctionModule(reserved, row, column) && maskFunction(mask, row, column)
          ? !value
          : value;
    }
  }
  return out;
}

function formatBits(mask: number): number {
  const value = (ECC_LEVEL_M_BITS << 3) | mask;
  let rem = value;
  for (let index = 0; index < 10; index += 1) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
  return ((value << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let index = 0; index < 12; index += 1) rem = (rem << 1) ^ ((rem >> 11) & 1 ? 0x1f25 : 0);
  return (version << 12) | rem;
}

function placeFormatAndVersion(matrix: Matrix, version: number, mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const bit = ((bits >> index) & 1) === 1;
    const [r1, c1] = FORMAT_A[index]!;
    matrix[r1]![c1] = bit;
    const [r2, c2] = formatBPosition(size, index);
    matrix[r2]![c2] = bit;
  }
  if (version < 7) return;
  const vBits = versionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const bit = ((vBits >> index) & 1) === 1;
    const row = Math.floor(index / 3);
    const column = size - 11 + (index % 3);
    matrix[row]![column] = bit;
    matrix[column]![row] = bit;
  }
}

// Absolute [row, column] of the 15 format bits in the first copy, wrapping the
// top-left finder: bits 0-8 descend column 8 (skipping the timing row), bits
// 9-14 run left along row 8 (skipping the timing column). Matches ISO 18004.
const FORMAT_A: [number, number][] = [
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [7, 8],
  [8, 8],
  [8, 7],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
];

// Second copy: bits 0-7 run right-to-left along row 8, bits 8-14 descend
// column 8 near the bottom-left finder.
function formatBPosition(size: number, index: number): [number, number] {
  if (index < 8) return [8, size - 1 - index];
  return [size - 15 + index, 8];
}

function penalty(matrix: Matrix): number {
  const size = matrix.length;
  let score = 0;
  const scanLine = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  };
  scanLine((row, column) => matrix[row]![column]!);
  scanLine((column, row) => matrix[row]![column]!);
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row]![column];
      if (
        value === matrix[row]![column + 1] &&
        value === matrix[row + 1]![column] &&
        value === matrix[row + 1]![column + 1]
      ) {
        score += 3;
      }
    }
  }
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) if (matrix[row]![column]) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/** Encodes `text` into a QR module matrix of booleans (true = dark). */
export function encodeQrMatrix(text: string): boolean[][] {
  const version = chooseVersion(new TextEncoder().encode(text).length);
  const size = version * 4 + 17;
  const dataCodewords = encodeData(text, version);
  const finalCodewords = interleave(dataCodewords, version);

  const reserved = createMatrix(size);
  placeFunctionPatterns(reserved, version);
  reserveFormatAreas(reserved, version);

  const base = reserved.map((row) => row.slice());
  placeData(base, finalCodewords);

  let best: Matrix | null = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask += 1) {
    const masked = applyMask(base, reserved, mask);
    placeFormatAndVersion(masked, version, mask);
    const score = penalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
      bestMask = mask;
    }
  }
  const result = best!;
  placeFormatAndVersion(result, version, bestMask);
  return result.map((row) => row.map((cell) => cell ?? false));
}
