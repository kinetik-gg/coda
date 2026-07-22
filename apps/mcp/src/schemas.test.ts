import { describe, expect, it } from 'vitest';
import { itemListInputSchema, itemUpdateInputSchema } from './schemas.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('MCP tool schemas', () => {
  it('bounds item page sizes independently of caller input', () => {
    expect(itemListInputSchema.safeParse({ entityTypeId: uuid, limit: 100 }).success).toBe(true);
    expect(itemListInputSchema.safeParse({ entityTypeId: uuid, limit: 101 }).success).toBe(false);
  });

  it('requires an actual item change', () => {
    expect(itemUpdateInputSchema.safeParse({ itemId: uuid, version: 1 }).success).toBe(false);
    expect(
      itemUpdateInputSchema.safeParse({ itemId: uuid, version: 1, description: null }).success,
    ).toBe(true);
  });
});
