import type { CallHandler } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { BigIntSerializerInterceptor } from './bigint.interceptor';

describe('BigIntSerializerInterceptor', () => {
  it('recursively serializes bigint values while retaining dates and nullish values', async () => {
    const date = new Date('2026-07-22T00:00:00.000Z');
    const next = {
      handle: () =>
        of({
          id: 12n,
          date,
          nil: null,
          missing: undefined,
          nested: [{ size: 3n }, 'plain'],
        }),
    } as CallHandler;

    await expect(
      firstValueFrom(new BigIntSerializerInterceptor().intercept({} as never, next)),
    ).resolves.toEqual({
      id: 12,
      date,
      nil: null,
      missing: undefined,
      nested: [{ size: 3 }, 'plain'],
    });
  });
});
