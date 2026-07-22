import { describe, expect, it } from 'vitest';
import { parseFountain } from '@coda/fountain';
import {
  buildScreenplayContext,
  buildScreenplayContextFromDocument,
  type ScreenplayContextRange,
} from './screenplay-context-model';

const source = [
  '# Act One',
  '= Before the first scene',
  '',
  'INT. APARTMENT - MORNING #1#',
  '= Jane waits',
  '[[Blue revision note]]',
  '',
  'JANE (V.O.)',
  'The rain is here.',
  'It followed me.',
  '',
  '@Jane',
  'Again.',
  '',
  '## River sequence',
  '= River overview',
  '',
  'EXT. RIVER BANK - GOLDEN HOUR',
  '',
  'JOHN^',
  'I can see it.',
  '',
  'JANE',
  'So can I.',
  '',
  '# Act Two',
  '',
  'EST. KOTA TUA - NIGHT',
  '[[An open note',
].join('\r\n');

function selected(value: string, range: ScreenplayContextRange): string {
  return value.slice(range.start, range.end);
}

describe('screenplay context model', () => {
  it('derives range-backed scenes, sections, synopses, and notes', () => {
    const model = buildScreenplayContext(source);

    expect(
      model.scenes.map(({ heading, sceneNumber, sectionIds }) => ({
        heading,
        sceneNumber,
        sectionIds,
      })),
    ).toEqual([
      {
        heading: 'INT. APARTMENT - MORNING',
        sceneNumber: '1',
        sectionIds: ['section-1'],
      },
      {
        heading: 'EXT. RIVER BANK - GOLDEN HOUR',
        sceneNumber: undefined,
        sectionIds: ['section-1', 'section-2'],
      },
      {
        heading: 'EST. KOTA TUA - NIGHT',
        sceneNumber: undefined,
        sectionIds: ['section-3'],
      },
    ]);
    expect(
      model.sections.map(({ text, depth, parentId, sceneIds }) => ({
        text,
        depth,
        parentId,
        sceneIds,
      })),
    ).toEqual([
      { text: 'Act One', depth: 1, parentId: undefined, sceneIds: ['scene-1', 'scene-2'] },
      {
        text: 'River sequence',
        depth: 2,
        parentId: 'section-1',
        sceneIds: ['scene-2'],
      },
      { text: 'Act Two', depth: 1, parentId: undefined, sceneIds: ['scene-3'] },
    ]);
    expect(model.synopses.map(({ text, sceneId }) => ({ text, sceneId }))).toEqual([
      { text: 'Before the first scene', sceneId: undefined },
      { text: 'Jane waits', sceneId: 'scene-1' },
      { text: 'River overview', sceneId: undefined },
    ]);
    expect(model.notes.map(({ text, closed, sceneId }) => ({ text, closed, sceneId }))).toEqual([
      { text: 'Blue revision note', closed: true, sceneId: 'scene-1' },
      { text: 'An open note', closed: false, sceneId: 'scene-3' },
    ]);

    expect(selected(source, model.scenes[0]!.headingRange)).toBe('INT. APARTMENT - MORNING');
    expect(selected(source, model.sections[1]!.textRange)).toBe('River sequence');
    expect(selected(source, model.synopses[1]!.textRange)).toBe('Jane waits');
    expect(selected(source, model.notes[0]!.contentRange)).toBe('Blue revision note');
    expect(selected(source, model.notes[1]!.contentRange)).toBe('An open note');
    expect(model.scenes[0]!.range.end).toBe(model.scenes[1]!.range.start);
    expect(model.scenes[2]!.range.end).toBe(source.length);
  });

  it('extracts normalized location and time-of-day inventories with exact occurrences', () => {
    const model = buildScreenplayContext(source);

    expect(
      model.scenes.map(({ setting, location, timeOfDay }) => ({
        setting,
        location: location?.name,
        timeOfDay: timeOfDay?.name,
      })),
    ).toEqual([
      { setting: 'interior', location: 'APARTMENT', timeOfDay: 'MORNING' },
      { setting: 'exterior', location: 'RIVER BANK', timeOfDay: 'GOLDEN HOUR' },
      { setting: 'establishing', location: 'KOTA TUA', timeOfDay: 'NIGHT' },
    ]);
    expect(model.locations.map(({ name, sceneIds }) => ({ name, sceneIds }))).toEqual([
      { name: 'APARTMENT', sceneIds: ['scene-1'] },
      { name: 'RIVER BANK', sceneIds: ['scene-2'] },
      { name: 'KOTA TUA', sceneIds: ['scene-3'] },
    ]);
    expect(model.timesOfDay.map(({ name }) => name)).toEqual(['MORNING', 'GOLDEN HOUR', 'NIGHT']);
    expect(selected(source, model.locations[1]!.occurrences[0]!.range)).toBe('RIVER BANK');
    expect(selected(source, model.timesOfDay[1]!.occurrences[0]!.range)).toBe('GOLDEN HOUR');
  });

  it('aggregates character appearances and dialogue counts without extensions or dual markers', () => {
    const model = buildScreenplayContext(source);
    const jane = model.characters.find(({ key }) => key === 'JANE');
    const john = model.characters.find(({ key }) => key === 'JOHN');

    expect(jane).toMatchObject({
      name: 'JANE',
      cueCount: 3,
      dialogueBlockCount: 3,
      dialogueLineCount: 4,
      dialogueWordCount: 11,
      sceneIds: ['scene-1', 'scene-2'],
    });
    expect(
      jane?.appearances.map(({ sceneId, cueCount, dialogueBlockCount }) => ({
        sceneId,
        cueCount,
        dialogueBlockCount,
      })),
    ).toEqual([
      { sceneId: 'scene-1', cueCount: 2, dialogueBlockCount: 2 },
      { sceneId: 'scene-2', cueCount: 1, dialogueBlockCount: 1 },
    ]);
    expect(john).toMatchObject({ cueCount: 1, dialogueBlockCount: 1, dialogueWordCount: 4 });
    expect(model.scenes[0]!.appearances.map(({ name, cueCount }) => ({ name, cueCount }))).toEqual([
      { name: 'JANE', cueCount: 2 },
    ]);
    expect(jane?.cueRanges.map((range) => selected(source, range))).toEqual([
      'JANE',
      'Jane',
      'JANE',
    ]);
    expect(jane?.dialogueRanges.map((range) => selected(source, range))).toEqual([
      'The rain is here.\r\nIt followed me.',
      'Again.',
      'So can I.',
    ]);
  });

  it('accepts already parsed Fountain output and remains deterministic', () => {
    const first = buildScreenplayContext(source);
    const second = buildScreenplayContextFromDocument(parseFountain(source));
    expect(second).toEqual(first);
  });

  it('keeps forced custom headings out of location inventory', () => {
    const model = buildScreenplayContext('.MONTAGE\n\n!Fragments of a day.');
    expect(model.scenes).toHaveLength(1);
    expect(model.scenes[0]?.heading).toBe('MONTAGE');
    expect(model.scenes[0]?.setting).toBeUndefined();
    expect(model.locations).toEqual([]);
    expect(model.timesOfDay).toEqual([]);
  });

  it('aggregates repeated heading context without collapsing slug collisions', () => {
    const collisionSource = [
      'INT./EXT. A-B - DAY',
      '',
      'INT. A B - DAY',
      '',
      'EXT. A-B - NIGHT',
    ].join('\n');
    const model = buildScreenplayContext(collisionSource);

    expect(model.locations.map(({ key, sceneIds }) => ({ key, sceneIds }))).toEqual([
      { key: 'A-B', sceneIds: ['scene-1', 'scene-3'] },
      { key: 'A B', sceneIds: ['scene-2'] },
    ]);
    expect(new Set(model.locations.map(({ id }) => id)).size).toBe(2);
    expect(model.timesOfDay.map(({ key, sceneIds }) => ({ key, sceneIds }))).toEqual([
      { key: 'DAY', sceneIds: ['scene-1', 'scene-2'] },
      { key: 'NIGHT', sceneIds: ['scene-3'] },
    ]);
    expect(model.scenes[0]?.setting).toBe('interior_exterior');
  });

  it('excludes a trailing line ending from an open note content range', () => {
    const noteSource = 'INT. ROOM - DAY\r\n[[unfinished\r\n';
    const note = buildScreenplayContext(noteSource).notes[0];
    expect(note?.closed).toBe(false);
    expect(note && selected(noteSource, note.contentRange)).toBe('unfinished');
  });
});
