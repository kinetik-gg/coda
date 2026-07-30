/**
 * SHA-256 over the UTF-8 encoding of a string, returned as lowercase hex.
 *
 * This is the digest the screenplay source-range contract names for `sourceTextHash`
 * (`SCREENPLAY_SOURCE_TEXT_HASH_ALGORITHM` in `packages/contracts/src/breakdown-screenplay.ts`):
 * lowercase hex SHA-256 of the UTF-8 encoding of `sourceText.slice(start, end)`.
 *
 * It is implemented here rather than taken from `node:crypto` or a dependency for two reasons.
 * `packages/fountain` currently imports no Node built-in at all and is imported directly by
 * `apps/web` (see `apps/web/src/screenplays/*`), so a `node:crypto` import would either break the
 * browser bundle or force a runtime split through this package. And a hash is not worth a
 * dependency that `pnpm audit` then has to keep gating. The implementation is ~100 lines of
 * 32-bit integer arithmetic with no configuration and no state shared between calls, so the same
 * input always produces the same 64 hex characters.
 */

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const BLOCK_BYTES = 64;
const LENGTH_BYTES = 8;

const utf8 = new TextEncoder();

/** Reads a `Uint32Array` slot. `noUncheckedIndexedAccess` widens every indexed read to `| undefined`. */
function word(words: Uint32Array, index: number): number {
  return words[index] ?? 0;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Appends the `0x80` terminator and the big-endian 64-bit bit length, per FIPS 180-4.
 */
function padMessage(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const totalBytes = (Math.floor((bytes.length + LENGTH_BYTES) / BLOCK_BYTES) + 1) * BLOCK_BYTES;
  const padded = new Uint8Array(totalBytes);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalBytes - LENGTH_BYTES, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(totalBytes - 4, bitLength >>> 0, false);
  return padded;
}

function expandSchedule(schedule: Uint32Array, view: DataView, offset: number): void {
  for (let index = 0; index < 16; index += 1) {
    schedule[index] = view.getUint32(offset + index * 4, false);
  }
  for (let index = 16; index < 64; index += 1) {
    const near = word(schedule, index - 15);
    const far = word(schedule, index - 2);
    const sigma0 = rotateRight(near, 7) ^ rotateRight(near, 18) ^ (near >>> 3);
    const sigma1 = rotateRight(far, 17) ^ rotateRight(far, 19) ^ (far >>> 10);
    schedule[index] =
      (word(schedule, index - 16) + sigma0 + word(schedule, index - 7) + sigma1) >>> 0;
  }
}

function compressBlock(state: Uint32Array, schedule: Uint32Array): void {
  let a = word(state, 0);
  let b = word(state, 1);
  let c = word(state, 2);
  let d = word(state, 3);
  let e = word(state, 4);
  let f = word(state, 5);
  let g = word(state, 6);
  let h = word(state, 7);

  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choose = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choose + word(ROUND_CONSTANTS, index) + word(schedule, index)) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  state[0] = (word(state, 0) + a) >>> 0;
  state[1] = (word(state, 1) + b) >>> 0;
  state[2] = (word(state, 2) + c) >>> 0;
  state[3] = (word(state, 3) + d) >>> 0;
  state[4] = (word(state, 4) + e) >>> 0;
  state[5] = (word(state, 5) + f) >>> 0;
  state[6] = (word(state, 6) + g) >>> 0;
  state[7] = (word(state, 7) + h) >>> 0;
}

function toHex(state: Uint32Array): string {
  let hex = '';
  for (let index = 0; index < 8; index += 1) {
    hex += word(state, index).toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Lowercase hex SHA-256 of the UTF-8 encoding of `text`.
 *
 * Lone surrogates encode the way `TextEncoder` encodes them — as U+FFFD — which is the same rule a
 * caller hashing the identical slice on the server side follows, so a range whose boundary splits a
 * surrogate pair still produces a stable, comparable digest.
 */
export function sha256HexOfUtf8(text: string): string {
  const padded = padMessage(utf8.encode(text));
  const view = new DataView(padded.buffer);
  const state = new Uint32Array(INITIAL_STATE);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    expandSchedule(schedule, view, offset);
    compressBlock(state, schedule);
  }

  return toHex(state);
}
