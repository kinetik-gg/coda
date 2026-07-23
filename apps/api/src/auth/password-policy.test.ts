import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { assertPasswordDoesNotContainEmail } from './password-policy';

describe('assertPasswordDoesNotContainEmail', () => {
  it('does nothing when the password does not contain the email local part', () => {
    expect(() =>
      assertPasswordDoesNotContainEmail('Correct-Horse-Battery', 'owner@example.com'),
    ).not.toThrow();
  });

  it('throws a ZodError naming the password field when the password contains the email local part', () => {
    try {
      assertPasswordDoesNotContainEmail('my-owner-password', 'owner@example.com');
      throw new Error('expected assertion to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      expect(zodError.issues[0]?.path).toEqual(['password']);
      expect(zodError.issues[0]?.message).toMatch(/email/i);
    }
  });

  it('ignores short local parts', () => {
    expect(() =>
      assertPasswordDoesNotContainEmail('has-abc-inside', 'abc@example.com'),
    ).not.toThrow();
  });
});
