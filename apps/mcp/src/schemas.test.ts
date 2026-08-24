import { describe, expect, it } from 'vitest';
import {
  itemListInputSchema,
  itemUpdateInputSchema,
  tokenContextSchema,
  trackerItemListInputSchema,
  trackerItemCreateInputSchema,
  trackerItemUpdateInputSchema,
} from './schemas.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';

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

describe('token context schemas', () => {
  it('accepts a project binding and keeps its projectId', () => {
    const context = tokenContextSchema.parse({
      resourceType: 'project',
      projectId: uuid,
      kind: 'MCP_TOKEN',
      permissions: ['read_project'],
    });
    expect(context).toEqual({
      resourceType: 'project',
      projectId: uuid,
      kind: 'MCP_TOKEN',
      permissions: ['read_project'],
    });
  });

  it('accepts a tracker binding and keeps its trackerId', () => {
    const context = tokenContextSchema.parse({
      resourceType: 'tracker',
      trackerId: otherUuid,
      kind: 'MCP_TOKEN',
      permissions: ['read_tracker'],
    });
    expect(context).toEqual({
      resourceType: 'tracker',
      trackerId: otherUuid,
      kind: 'MCP_TOKEN',
      permissions: ['read_tracker'],
    });
  });

  it('rejects an unknown binding kind and a tracker context without its id', () => {
    expect(
      tokenContextSchema.safeParse({ projectId: uuid, kind: 'MCP_TOKEN', permissions: [] }).success,
    ).toBe(false);
    expect(
      tokenContextSchema.safeParse({
        resourceType: 'tracker',
        projectId: uuid,
        kind: 'MCP_TOKEN',
        permissions: [],
      }).success,
    ).toBe(false);
  });
});

describe('tracker item schemas', () => {
  it('bounds record page sizes and defaults the list vocabulary', () => {
    const parsed = trackerItemListInputSchema.parse({});
    expect(parsed).toEqual({
      limit: 50,
      sort: 'manual',
      direction: 'asc',
      filters: [],
    });
    expect(trackerItemListInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(trackerItemListInputSchema.safeParse({ sort: 'code' }).success).toBe(false);
  });

  it('requires filter values except for emptiness operators', () => {
    expect(
      trackerItemListInputSchema.safeParse({
        filters: [{ fieldId: otherUuid, operator: 'contains' }],
      }).success,
    ).toBe(false);
    expect(
      trackerItemListInputSchema.safeParse({
        filters: [{ fieldId: otherUuid, operator: 'is_empty' }],
      }).success,
    ).toBe(true);
    expect(
      trackerItemListInputSchema.safeParse({
        filters: [{ fieldId: otherUuid, operator: 'has_all', value: ['a'] }],
      }).success,
    ).toBe(true);
  });

  it('requires a title on create and bounds position hints', () => {
    expect(trackerItemCreateInputSchema.safeParse({}).success).toBe(false);
    expect(trackerItemCreateInputSchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(trackerItemCreateInputSchema.safeParse({ title: 'Scene 12' }).success).toBe(true);
    expect(
      trackerItemCreateInputSchema.safeParse({ title: 'Scene 12', beforeId: 'nope' }).success,
    ).toBe(false);
  });

  it('requires an optimistic version plus one editable field on update', () => {
    expect(trackerItemUpdateInputSchema.safeParse({ itemId: uuid, version: 1 }).success).toBe(
      false,
    );
    expect(trackerItemUpdateInputSchema.safeParse({ itemId: uuid, title: 'Renamed' }).success).toBe(
      false,
    );
    expect(
      trackerItemUpdateInputSchema.safeParse({ itemId: uuid, version: 1, beforeId: null }).success,
    ).toBe(true);
    expect(
      trackerItemUpdateInputSchema.safeParse({
        itemId: uuid,
        version: 1,
        title: 'Renamed',
        afterId: otherUuid,
      }).success,
    ).toBe(true);
  });
});
