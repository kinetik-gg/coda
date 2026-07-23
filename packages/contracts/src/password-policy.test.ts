import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordContainsEmailLocalPart,
  passwordSchema,
} from './password-policy';

function issueMessages(password: string): string[] {
  const result = passwordSchema.safeParse(password);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('passwordSchema', () => {
  it('rejects passwords shorter than the minimum length', () => {
    const messages = issueMessages('Short-Pw1');
    expect(messages.some((message) => message.includes(`${PASSWORD_MIN_LENGTH} characters`))).toBe(
      true,
    );
  });

  it('accepts a password at exactly the minimum length', () => {
    const password = 'Xy!'.padEnd(PASSWORD_MIN_LENGTH, 'z9');
    expect(password).toHaveLength(PASSWORD_MIN_LENGTH);
    expect(passwordSchema.parse(password)).toBe(password);
  });

  it('rejects passwords longer than the maximum length', () => {
    const messages = issueMessages('a'.repeat(PASSWORD_MAX_LENGTH + 1));
    expect(messages.some((message) => message.includes(`${PASSWORD_MAX_LENGTH} characters`))).toBe(
      true,
    );
  });

  it('accepts a password at exactly the maximum length', () => {
    const password = 'Xy9-'.repeat(PASSWORD_MAX_LENGTH / 4);
    expect(password).toHaveLength(PASSWORD_MAX_LENGTH);
    expect(passwordSchema.parse(password)).toBe(password);
  });

  it('rejects a password found verbatim in the common-password blocklist', () => {
    expect(COMMON_PASSWORDS.has('password1')).toBe(true);
    const messages = issueMessages('password1');
    expect(messages.some((message) => message.toLowerCase().includes('common'))).toBe(true);
  });

  it('checks the blocklist case-insensitively', () => {
    expect(COMMON_PASSWORDS.has('dragon')).toBe(true);
    const messages = issueMessages('DRAGON');
    expect(messages.some((message) => message.toLowerCase().includes('common'))).toBe(true);
  });

  it('does not flag a password that is not on the blocklist', () => {
    expect(COMMON_PASSWORDS.has('letmein123456')).toBe(false);
    expect(passwordSchema.safeParse('letmein123456').success).toBe(true);
  });

  it('accepts a strong password that satisfies every rule', () => {
    expect(passwordSchema.parse('Correct-Horse-Battery-42')).toBe('Correct-Horse-Battery-42');
  });

  it('applies no composition rules beyond length and the blocklist', () => {
    // All lowercase, no digits, no symbols — still accepted, per NIST 800-63B.
    expect(passwordSchema.safeParse('allsimplelowercasewords').success).toBe(true);
  });

  it('embeds exactly 1000 lowercase, de-duplicated blocklist entries', () => {
    expect(COMMON_PASSWORDS.size).toBe(1000);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});

describe('passwordContainsEmailLocalPart', () => {
  it('flags a password containing the email local part, case-insensitively', () => {
    expect(passwordContainsEmailLocalPart('MyRizki2026Secret', 'rizki@example.com')).toBe(true);
    expect(passwordContainsEmailLocalPart('myRIZKIsecret1234', 'rizki@example.com')).toBe(true);
  });

  it('does not flag a password that does not contain the email local part', () => {
    expect(passwordContainsEmailLocalPart('Correct-Horse-Battery', 'rizki@example.com')).toBe(
      false,
    );
  });

  it('ignores local parts shorter than the minimum check length', () => {
    // "abc" is 3 characters, below the 4-character floor, so it is never flagged
    // even though the password literally contains it.
    expect(passwordContainsEmailLocalPart('my-abc-password', 'abc@example.com')).toBe(false);
  });

  it('flags a password containing a local part at exactly the minimum check length', () => {
    // "abcd" is exactly 4 characters, at the floor, so it is flagged.
    expect(passwordContainsEmailLocalPart('my-abcd-password', 'abcd@example.com')).toBe(true);
  });

  it('handles a malformed email defensively without throwing', () => {
    expect(() =>
      passwordContainsEmailLocalPart('some-password-value', 'not-an-email'),
    ).not.toThrow();
    expect(passwordContainsEmailLocalPart('xnot-an-emailx', 'not-an-email')).toBe(true);
  });
});
