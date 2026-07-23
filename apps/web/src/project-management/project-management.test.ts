import { describe, expect, it } from 'vitest';
import { getDeleteLevelState } from './entity-utils';
import { fieldKeyFromName, normalizedFieldType, readableFieldType } from './field-utils';
import type { ManagedEntityType } from './types';

function entity(id: string, level: number): ManagedEntityType {
  return {
    id,
    level,
    singularName: `Level ${level}`,
    pluralName: `Levels ${level}`,
    version: 1,
  };
}

describe('project management field utilities', () => {
  it('generates stable normalized field keys', () => {
    expect(fieldKeyFromName('  Shooting Location  ')).toBe('shooting_location');
    expect(fieldKeyFromName('Épisode Number')).toBe('episode_number');
  });

  it('adds a safe prefix when a normalized key does not start with a letter', () => {
    expect(fieldKeyFromName('42 shots')).toBe('field_42_shots');
    expect(fieldKeyFromName('---')).toBe('');
  });

  it('normalizes API field types and preserves unknown readable labels', () => {
    expect(normalizedFieldType('LONG_TEXT')).toBe('long_text');
    expect(readableFieldType('multi_enum')).toBe('Multi select');
    expect(readableFieldType('future_type')).toBe('future_type');
  });
});

describe('entity level deletion guard', () => {
  const first = entity('first', 1);
  const deepest = entity('deepest', 2);

  it('allows an authorized user to delete only an empty deepest level', () => {
    expect(
      getDeleteLevelState({
        selected: deepest,
        deepest,
        entityTypeCount: 2,
        canManageEntities: true,
        hasItems: false,
        hasFields: false,
      }),
    ).toEqual({ mayDeleteLevel: true, deleteLevelHelp: undefined });
  });

  it('protects the only remaining level', () => {
    expect(
      getDeleteLevelState({
        selected: first,
        deepest: first,
        entityTypeCount: 1,
        canManageEntities: true,
        hasItems: false,
        hasFields: false,
      }),
    ).toEqual({
      mayDeleteLevel: false,
      deleteLevelHelp: 'A breakdown must keep at least one level.',
    });
  });

  it('requires deeper levels to be removed first', () => {
    expect(
      getDeleteLevelState({
        selected: first,
        deepest,
        entityTypeCount: 2,
        canManageEntities: true,
        hasItems: false,
        hasFields: false,
      }),
    ).toEqual({ mayDeleteLevel: false, deleteLevelHelp: 'Remove deeper levels first.' });
  });

  it('protects levels that still contain items or fields', () => {
    const result = getDeleteLevelState({
      selected: deepest,
      deepest,
      entityTypeCount: 2,
      canManageEntities: true,
      hasItems: true,
      hasFields: false,
    });
    expect(result.mayDeleteLevel).toBe(false);
    expect(result.deleteLevelHelp).toBe('Remove active and trashed items and custom fields first.');
  });

  it('denies deletion when the user lacks entity-management permission', () => {
    expect(
      getDeleteLevelState({
        selected: deepest,
        deepest,
        entityTypeCount: 2,
        canManageEntities: false,
        hasItems: false,
        hasFields: false,
      }).mayDeleteLevel,
    ).toBe(false);
  });
});
