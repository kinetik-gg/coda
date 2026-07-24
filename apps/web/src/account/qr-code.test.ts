import { describe, expect, it } from 'vitest';
import { encodeQrMatrix } from './qr-code';

// Pinned, externally decoder-verified output (jsQR) for the byte-mode, level-M
// encoding of "x" -- a version-1 (21x21) QR code. Any regression in the finder,
// timing, data-placement, Reed-Solomon, masking, or format-info logic changes
// this matrix, so the snapshot guards the whole pipeline.
const X_MATRIX = [
  '111111100010001111111',
  '100000101000101000001',
  '101110100000001011101',
  '101110100001001011101',
  '101110101100101011101',
  '100000100010101000001',
  '111111101010101111111',
  '000000000111100000000',
  '101010100011000010010',
  '010001001100001000110',
  '001101110000100010001',
  '101010000110001000110',
  '100100101010101010100',
  '000000001101010101001',
  '111111100101011101111',
  '100000100111110111000',
  '101110101001011101101',
  '101110100100001000110',
  '101110101000100010001',
  '100000100100001000110',
  '111111101000101010111',
].join('\n');

function render(matrix: boolean[][]): string {
  return matrix.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

function hasFinder(matrix: boolean[][], top: number, left: number): boolean {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const border = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (matrix[top + r]![left + c] !== (border || core)) return false;
    }
  }
  return true;
}

describe('encodeQrMatrix', () => {
  it('matches the decoder-verified matrix for a known input', () => {
    expect(render(encodeQrMatrix('x'))).toBe(X_MATRIX);
  });

  it('is deterministic', () => {
    expect(render(encodeQrMatrix('otpauth://totp/Coda:a@b'))).toBe(
      render(encodeQrMatrix('otpauth://totp/Coda:a@b')),
    );
  });

  it('places the three finder patterns at the correct corners', () => {
    const matrix = encodeQrMatrix('otpauth://totp/Coda:user@example.test?secret=ABCDEFGH');
    const size = matrix.length;
    expect(hasFinder(matrix, 0, 0)).toBe(true);
    expect(hasFinder(matrix, 0, size - 7)).toBe(true);
    expect(hasFinder(matrix, size - 7, 0)).toBe(true);
  });

  it('selects a larger version as the payload grows', () => {
    const small = encodeQrMatrix('short').length;
    const large = encodeQrMatrix('a'.repeat(180)).length;
    expect(large).toBeGreaterThan(small);
    // Every QR version is (4v + 17) modules square.
    expect((small - 17) % 4).toBe(0);
    expect((large - 17) % 4).toBe(0);
  });

  it('lays down the alternating timing patterns on row and column six', () => {
    const matrix = encodeQrMatrix('timing');
    for (let index = 8; index < matrix.length - 8; index += 1) {
      expect(matrix[6]![index]).toBe(index % 2 === 0);
      expect(matrix[index]![6]).toBe(index % 2 === 0);
    }
  });

  it('throws when the payload cannot fit the supported versions', () => {
    expect(() => encodeQrMatrix('a'.repeat(3000))).toThrow(/too long/i);
  });
});
