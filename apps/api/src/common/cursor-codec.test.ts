import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor-codec';

describe('cursor codec', () => {
  it('round-trips a record id', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(decodeCursor(encodeCursor(id))).toEqual({ id });
  });

  it('refuses garbage cursors with a bad request', () => {
    expect(() => decodeCursor('!!!not-base64url!!!')).toThrow(BadRequestException);
  });
});
