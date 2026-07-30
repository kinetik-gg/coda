import { describe, expect, it } from 'vitest';
import type { SourceReferencePinSummary } from '@coda/contracts';
import { attachPinSummaries } from './breakdown-source-reference-view';

describe('attachPinSummaries', () => {
  it('merges a computed summary onto the matching reference by id', () => {
    const summary: SourceReferencePinSummary = {
      resolution: 'pinned',
      pin: null,
      staleness: 'stale',
    };
    const items = [{ id: 'item-1', sourceReferences: [{ id: 'reference-1', startPage: 4 }] }];

    const result = attachPinSummaries(items, new Map([['reference-1', summary]]));

    expect(result[0]!.sourceReferences[0]).toEqual({
      id: 'reference-1',
      startPage: 4,
      resolution: 'pinned',
      pin: null,
      staleness: 'stale',
    });
  });

  it('defaults an unpinned reference to the legacy unpinned summary', () => {
    const items = [{ id: 'item-1', sourceReferences: [{ id: 'reference-1', startPage: 4 }] }];

    const result = attachPinSummaries(items, new Map());

    expect(result[0]!.sourceReferences[0]).toMatchObject({
      resolution: 'unpinned',
      pin: null,
      staleness: null,
    });
  });

  it('leaves an item untouched when it carries no sourceReferences array at all', () => {
    const items: Array<{ id: string; sourceReferences?: Array<{ id: string }> }> = [
      { id: 'item-1' },
    ];

    const result = attachPinSummaries(items, new Map());

    expect(result[0]).toEqual({ id: 'item-1' });
    expect(result[0]).toBe(items[0]);
  });
});
