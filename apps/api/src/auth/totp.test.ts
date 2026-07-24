import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  constantTimeEquals,
  generateTotpSecret,
  hotp,
  totp,
  totpCounter,
  verifyTotp,
} from './totp';

// RFC 4226 Appendix D: HOTP values for the ASCII seed "12345678901234567890".
const RFC4226_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC4226_HOTP = [
  '755224',
  '287082',
  '359152',
  '969429',
  '338314',
  '254676',
  '287922',
  '162583',
  '399871',
  '520489',
];

// RFC 6238 Appendix B: TOTP values (8 digits) for the SHA-1/256/512 seeds.
const RFC6238_SHA1_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC6238_SHA256_SECRET = Buffer.from('12345678901234567890123456789012', 'ascii');
const RFC6238_SHA512_SECRET = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
  'ascii',
);
const RFC6238_SHA1 = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
] as const;
const RFC6238_SHA256 = [
  [59, '46119246'],
  [1111111109, '68084774'],
  [1111111111, '67062674'],
  [1234567890, '91819424'],
  [2000000000, '90698825'],
  [20000000000, '77737706'],
] as const;
const RFC6238_SHA512 = [
  [59, '90693936'],
  [1111111109, '25091201'],
  [1111111111, '99943326'],
  [1234567890, '93441116'],
  [2000000000, '38618901'],
  [20000000000, '47863826'],
] as const;

describe('HOTP (RFC 4226)', () => {
  it.each(RFC4226_HOTP.map((expected, counter) => [counter, expected] as const))(
    'matches the published value at counter %i',
    (counter, expected) => {
      expect(hotp(RFC4226_SECRET, counter)).toBe(expected);
    },
  );
});

describe('TOTP (RFC 6238)', () => {
  it.each(RFC6238_SHA1)('SHA-1 matches at time %i', (time, expected) => {
    expect(totp(RFC6238_SHA1_SECRET, time * 1000, { digits: 8, algorithm: 'sha1' })).toBe(expected);
  });
  it.each(RFC6238_SHA256)('SHA-256 matches at time %i', (time, expected) => {
    expect(totp(RFC6238_SHA256_SECRET, time * 1000, { digits: 8, algorithm: 'sha256' })).toBe(
      expected,
    );
  });
  it.each(RFC6238_SHA512)('SHA-512 matches at time %i', (time, expected) => {
    expect(totp(RFC6238_SHA512_SECRET, time * 1000, { digits: 8, algorithm: 'sha512' })).toBe(
      expected,
    );
  });

  it('derives the time step from the period', () => {
    expect(totpCounter(59_000)).toBe(1);
    expect(totpCounter(60_000)).toBe(2);
    expect(totpCounter(90_000, 45)).toBe(2);
  });
});

describe('verifyTotp window and replay guard', () => {
  const secret = base32Decode(generateTotpSecret());
  const now = 1_700_000_000_000;
  const step = 30_000;

  it('accepts the current code and returns its counter', () => {
    const code = totp(secret, now);
    const matched = verifyTotp(secret, code, now, { after: null });
    expect(matched).toBe(totpCounter(now));
  });

  it('accepts a code from the adjacent steps within the +/-1 window', () => {
    const previous = totp(secret, now - step);
    const next = totp(secret, now + step);
    expect(verifyTotp(secret, previous, now, { after: null })).toBe(totpCounter(now) - 1);
    expect(verifyTotp(secret, next, now, { after: null })).toBe(totpCounter(now) + 1);
  });

  it('rejects a code two steps away', () => {
    const code = totp(secret, now - 2 * step);
    expect(verifyTotp(secret, code, now, { after: null })).toBeNull();
  });

  it('rejects a counter at or below the replay high-water mark', () => {
    const code = totp(secret, now);
    const counter = verifyTotp(secret, code, now, { after: null });
    expect(counter).not.toBeNull();
    expect(verifyTotp(secret, code, now, { after: counter })).toBeNull();
  });

  it('rejects a wrong code', () => {
    expect(verifyTotp(secret, '000000', now, { after: null })).toBeNull();
  });
});

describe('base32 and provisioning helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('ignores spaces, padding, and casing when decoding', () => {
    const secret = generateTotpSecret();
    const noisy = `${secret.toLowerCase().replace(/(.{4})/g, '$1 ')}====`;
    expect(base32Encode(base32Decode(noisy))).toBe(secret);
  });

  it('rejects invalid base32 characters', () => {
    expect(() => base32Decode('!!!!')).toThrow(/base32/i);
  });

  it('builds an otpauth URI carrying the secret and issuer', () => {
    const uri = buildOtpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'user@example.test',
      issuer: 'Coda',
    });
    expect(uri).toContain('otpauth://totp/Coda:user%40example.test');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Coda');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('constantTimeEquals', () => {
  it('is true for equal strings and false otherwise', () => {
    expect(constantTimeEquals('123456', '123456')).toBe(true);
    expect(constantTimeEquals('123456', '654321')).toBe(false);
    expect(constantTimeEquals('123456', '12345')).toBe(false);
  });
});
