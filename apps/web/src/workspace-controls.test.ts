import { describe, expect, it } from 'vitest';
import {
  buildItemListPath,
  operatorsForField,
  reorderBounds,
  toApiFilter,
} from './workspace-controls';

describe('workspace controls', () => {
  it('serializes search, sort, and typed filters', () => {
    const fieldId = '20000000-0000-4000-8000-000000000000';
    const filter = toApiFilter({ id: 'filter-1', fieldId, operator: 'greater_than', value: '12' }, [
      { id: fieldId, type: 'INTEGER' },
    ]);
    expect(filter).toEqual({ fieldId, operator: 'greater_than', value: 12 });
    const path = buildItemListPath('project', 'level', {
      search: '  scene  ',
      sort: 'title',
      direction: 'desc',
      filters: [filter!],
    });
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('search')).toBe('scene');
    expect(query.get('sort')).toBe('title');
    expect(JSON.parse(query.get('filters')!)).toEqual([filter]);
  });

  it('finds the adjacent gap after a drag', () => {
    expect(reorderBounds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual({
      beforeId: 'b',
      afterId: 'a',
    });
    expect(reorderBounds(['a', 'b', 'c'], 'a', 'c')).toEqual({
      beforeId: null,
      afterId: 'c',
    });
  });

  it('offers operators appropriate to text, comparable, multi-select, and scalar fields', () => {
    expect(operatorsForField('TEXT')).toContain('contains');
    expect(operatorsForField('DATE')).toContain('greater_or_equal');
    expect(operatorsForField('multi_enum')).toContain('has_all');
    expect(operatorsForField('BOOLEAN')).toEqual([
      'equals',
      'not_equals',
      'is_empty',
      'is_not_empty',
    ]);
  });

  it('serializes each supported API value shape and rejects malformed drafts', () => {
    const fields = [
      { id: 'int', type: 'integer' },
      { id: 'float', type: 'float' },
      { id: 'bool', type: 'boolean' },
      { id: 'multi', type: 'multi_enum' },
      { id: 'text', type: 'text' },
    ];
    expect(
      toApiFilter({ id: '1', fieldId: 'float', operator: 'equals', value: '1.5' }, fields)?.value,
    ).toBe(1.5);
    expect(
      toApiFilter({ id: '2', fieldId: 'bool', operator: 'equals', value: 'false' }, fields)?.value,
    ).toBe(false);
    expect(
      toApiFilter({ id: '3', fieldId: 'multi', operator: 'has_any', value: 'blue' }, fields)?.value,
    ).toEqual(['blue']);
    expect(
      toApiFilter({ id: '4', fieldId: 'text', operator: 'is_empty', value: '' }, fields),
    ).toEqual({ fieldId: 'text', operator: 'is_empty' });
    expect(
      toApiFilter({ id: '5', fieldId: 'missing', operator: 'equals', value: 'x' }, fields),
    ).toBeNull();
    expect(
      toApiFilter({ id: '6', fieldId: 'int', operator: 'equals', value: '1.2' }, fields),
    ).toBeNull();
    expect(
      toApiFilter({ id: '7', fieldId: 'float', operator: 'equals', value: 'NaN' }, fields),
    ).toBeNull();
    expect(
      toApiFilter({ id: '8', fieldId: 'bool', operator: 'equals', value: 'yes' }, fields),
    ).toBeNull();
    expect(
      toApiFilter({ id: '9', fieldId: 'text', operator: 'equals', value: '' }, fields),
    ).toBeNull();
  });

  it('omits optional query values and rejects no-op or unknown drag targets', () => {
    const path = buildItemListPath('project', 'entity', {
      search: '   ',
      sort: 'manual',
      direction: 'asc',
      filters: [],
    });
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.has('search')).toBe(false);
    expect(query.has('filters')).toBe(false);
    expect(reorderBounds(['a', 'b'], 'a', 'a')).toBeNull();
    expect(reorderBounds(['a', 'b'], 'missing', 'b')).toBeNull();
  });
});
