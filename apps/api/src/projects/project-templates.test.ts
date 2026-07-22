import { describe, expect, it } from 'vitest';
import { projectTemplate, projectTemplates } from './project-templates';

describe('project templates', () => {
  it('provides distinct three-level structures with ordered fields', () => {
    expect(projectTemplates.map((template) => template.id)).toEqual([
      'movie',
      'tv_series',
      'comic',
    ]);
    for (const template of projectTemplates) {
      expect(template.levels).toHaveLength(3);
      expect(template.levels.every((level) => level.fields.length > 0)).toBe(true);
      expect(
        new Set(template.levels.flatMap((level) => level.fields.map((field) => field.key))).size,
      ).toBe(template.levels.flatMap((level) => level.fields).length);
    }
  });

  it('uses Sequence as the first movie level', () => {
    expect(projectTemplate('movie').levels[0]).toMatchObject({
      singularName: 'Sequence',
      pluralName: 'Sequences',
      displayPrefix: 'SEQ',
    });
  });
});
