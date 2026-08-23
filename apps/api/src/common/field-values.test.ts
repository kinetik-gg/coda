import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { fieldTypeMap, storageReferenceForValue, valueData } from './field-values';

describe('field value mapping', () => {
  it('maps every contract type onto the storage vocabulary', () => {
    expect(fieldTypeMap.text).toBe('TEXT');
    expect(fieldTypeMap.long_text).toBe('LONG_TEXT');
    expect(fieldTypeMap.multi_enum).toBe('MULTI_ENUM');
    expect(fieldTypeMap.date).toBe('DATE');
    expect(fieldTypeMap.video).toBe('VIDEO');
  });

  it('writes scalars per column and anchors dates at UTC midnight', () => {
    expect(valueData({ type: 'text', value: 'hi' }, [])).toEqual({ scalar: { textValue: 'hi' } });
    expect(valueData({ type: 'integer', value: -3 }, [])).toEqual({
      scalar: { integerValue: -3 },
    });
    expect(valueData({ type: 'boolean', value: true }, [])).toEqual({
      scalar: { booleanValue: true },
    });
    expect(valueData({ type: 'date', value: '2026-08-24' }, []).scalar).toMatchObject({
      dateValue: new Date('2026-08-24T00:00:00.000Z'),
    });
  });

  it('validates enum selections against the field options', () => {
    expect(valueData({ type: 'enum', optionId: 'opt-1' }, ['opt-1'])).toEqual({
      scalar: { optionId: 'opt-1' },
    });
    expect(() => valueData({ type: 'enum', optionId: 'nope' }, [])).toThrow(
      new BadRequestException('Invalid field option'),
    );
  });

  it('carries multi-select ids for join-row replacement', () => {
    const result = valueData({ type: 'multi_enum', optionIds: ['a1', 'b2'] }, ['a1', 'b2']);
    expect(result.scalar).toEqual({});
    expect(result.optionIds).toEqual(['a1', 'b2']);
    expect(() => valueData({ type: 'multi_enum', optionIds: ['a1', 'gone'] }, ['a1'])).toThrow(
      BadRequestException,
    );
  });

  it('resolves storage references only for media types', () => {
    expect(storageReferenceForValue({ type: 'image', storageObjectId: 'so-1' })).toEqual({
      kind: 'IMAGE',
      storageObjectId: 'so-1',
    });
    expect(storageReferenceForValue({ type: 'text', value: '' })).toBeUndefined();
    expect(storageReferenceForValue({ type: 'multi_enum', optionIds: [] })).toBeUndefined();
  });
});
