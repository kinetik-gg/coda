// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { validateSourceFile } from './source-validation';
import { canContinueSetupStep, entitiesAreComplete, levelsForTemplate } from './setup-state';

function sizedFile(name: string, type: string, size: number) {
  const file = new File(['content'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('project source validation', () => {
  it('accepts a PDF identified by MIME type or extension', () => {
    expect(validateSourceFile(sizedFile('source', 'application/pdf', 1024))).toBeUndefined();
    expect(validateSourceFile(sizedFile('source.pdf', '', 1024))).toBeUndefined();
  });

  it('rejects non-PDF and oversized source documents', () => {
    expect(validateSourceFile(sizedFile('notes.txt', 'text/plain', 1024))).toBe(
      'Choose a PDF document.',
    );
    expect(
      validateSourceFile(sizedFile('source.pdf', 'application/pdf', 250 * 1024 * 1024 + 1)),
    ).toBe('The PDF must be 250 MB or smaller.');
  });
});

describe('project setup state', () => {
  it('requires all active entity level names', () => {
    const levels = [
      { singular: 'Sequence', plural: 'Sequences' },
      { singular: ' ', plural: 'Scenes' },
    ];
    expect(entitiesAreComplete(levels, 1)).toBe(true);
    expect(entitiesAreComplete(levels, 2)).toBe(false);
  });

  it('gates only the steps with required input', () => {
    const base = {
      detailsComplete: true,
      entitiesComplete: true,
      hasSource: false,
      templateId: 'blank' as const,
    };
    expect(canContinueSetupStep({ ...base, step: 'details' })).toBe(true);
    expect(canContinueSetupStep({ ...base, step: 'source' })).toBe(false);
    expect(canContinueSetupStep({ ...base, step: 'source', templateId: 'movie' })).toBe(true);
    expect(canContinueSetupStep({ ...base, step: 'member' })).toBe(true);
  });

  it('derives editable levels from blank and configured templates', () => {
    expect(levelsForTemplate('blank', [])).toHaveLength(3);
    expect(
      levelsForTemplate('movie', [
        {
          id: 'movie',
          name: 'Film',
          description: 'Film structure',
          levels: [{ singularName: 'Scene', pluralName: 'Scenes' }],
        },
      ]),
    ).toEqual([{ singular: 'Scene', plural: 'Scenes' }]);
    expect(levelsForTemplate('tv_series', [])).toBeUndefined();
  });
});
