import { describe, expect, it } from 'vitest';
import { sanitizeRequestTarget } from './request-target';

describe('sanitizeRequestTarget', () => {
  it('drops query strings so bearer values cannot reach logs or problem details', () => {
    expect(
      sanitizeRequestTarget('/reset-password?token=sensitive&email=person%40example.com'),
    ).toBe('/reset-password');
  });

  it('redacts invitation tokens carried in a path segment', () => {
    expect(sanitizeRequestTarget('/api/v1/invitations/a-very-sensitive-token')).toBe(
      '/api/v1/invitations/[redacted]',
    );
  });

  it('fails closed for malformed request targets', () => {
    expect(sanitizeRequestTarget('http://[invalid')).toBe('/');
    expect(sanitizeRequestTarget(undefined)).toBe('/');
  });
});
