import { describe, expect, it } from 'vitest';
import { assertParityFixtureHash, requiredParityFixtureHashes } from './screenplay-pdf-provenance';

describe('screenplay PDF parity fixture provenance', () => {
  const fixture = new TextEncoder().encode('Source-identical fixture');
  const sha256 = 'e9ab727a6b89c2dd45a9e31dfc3bd906df804e59a66033c6f66a47a89ee1d17c';

  it('accepts the exact expected fixture hash', () => {
    expect(() => assertParityFixtureHash('Fountain source', fixture, sha256)).not.toThrow();
  });

  it('requires both fixture hashes before strict parity starts', () => {
    expect(() => requiredParityFixtureHashes(undefined, undefined)).toThrowError(
      'Strict PDF parity requires expected SHA-256 values for both fixtures',
    );
    expect(() => requiredParityFixtureHashes(sha256, undefined)).toThrowError(
      'Strict PDF parity requires expected SHA-256 values for both fixtures',
    );
  });

  it('validates both expected hashes before strict parity starts', () => {
    expect(() => requiredParityFixtureHashes('invalid', sha256)).toThrowError(
      'Fountain source expected SHA-256 must be 64 lowercase hexadecimal characters',
    );
    expect(() => requiredParityFixtureHashes(sha256, 'invalid')).toThrowError(
      'reference PDF expected SHA-256 must be 64 lowercase hexadecimal characters',
    );
  });

  it('rejects revision drift without exposing fixture contents', () => {
    expect(() => assertParityFixtureHash('reference PDF', fixture, '0'.repeat(64))).toThrowError(
      'reference PDF does not match the expected SHA-256',
    );
  });

  it.each(['ABC', 'g'.repeat(64), 'a'.repeat(63), 'A'.repeat(64)])(
    'rejects malformed expected hash %s',
    (expected) => {
      expect(() => assertParityFixtureHash('Fountain source', fixture, expected)).toThrowError(
        'Fountain source expected SHA-256 must be 64 lowercase hexadecimal characters',
      );
    },
  );
});
