import {
  parseFountain,
  type FountainCharacterElement,
  type FountainCommentElement,
  type FountainDocument,
  type FountainElement,
  type FountainSceneHeadingElement,
} from '@coda/fountain';

export interface ScreenplayContextRange {
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
}

export interface ScreenplayContextOccurrence {
  sceneId: string;
  range: ScreenplayContextRange;
}

export interface ScreenplaySceneHeadingPart {
  name: string;
  range: ScreenplayContextRange;
}

export interface ScreenplayCharacterAppearance {
  characterId: string;
  name: string;
  cueRanges: readonly ScreenplayContextRange[];
  dialogueRanges: readonly ScreenplayContextRange[];
  cueCount: number;
  dialogueBlockCount: number;
  dialogueLineCount: number;
  dialogueWordCount: number;
}

export interface ScreenplaySceneContext {
  id: string;
  index: number;
  heading: string;
  sceneNumber?: string;
  setting?: 'interior' | 'exterior' | 'interior_exterior' | 'establishing';
  range: ScreenplayContextRange;
  headingRange: ScreenplayContextRange;
  location?: ScreenplaySceneHeadingPart & { locationId: string };
  timeOfDay?: ScreenplaySceneHeadingPart & { timeOfDayId: string };
  sectionIds: readonly string[];
  synopsisIds: readonly string[];
  noteIds: readonly string[];
  appearances: readonly ScreenplayCharacterAppearance[];
}

export interface ScreenplaySectionContext {
  id: string;
  text: string;
  depth: number;
  range: ScreenplayContextRange;
  textRange: ScreenplayContextRange;
  parentId?: string;
  sceneIds: readonly string[];
}

export interface ScreenplaySynopsisContext {
  id: string;
  text: string;
  range: ScreenplayContextRange;
  textRange: ScreenplayContextRange;
  sceneId?: string;
}

export interface ScreenplayNoteContext {
  id: string;
  text: string;
  closed: boolean;
  range: ScreenplayContextRange;
  contentRange: ScreenplayContextRange;
  sceneId?: string;
}

export interface ScreenplayCharacterContext {
  id: string;
  key: string;
  name: string;
  cueRanges: readonly ScreenplayContextRange[];
  dialogueRanges: readonly ScreenplayContextRange[];
  sceneIds: readonly string[];
  appearances: readonly (ScreenplayCharacterAppearance & { sceneId: string })[];
  cueCount: number;
  dialogueBlockCount: number;
  dialogueLineCount: number;
  dialogueWordCount: number;
}

export interface ScreenplayLocationContext {
  id: string;
  key: string;
  name: string;
  sceneIds: readonly string[];
  occurrences: readonly ScreenplayContextOccurrence[];
}

export interface ScreenplayTimeOfDayContext {
  id: string;
  key: string;
  name: string;
  sceneIds: readonly string[];
  occurrences: readonly ScreenplayContextOccurrence[];
}

/**
 * Deterministic writing context derived from Fountain structure. This is not a
 * production breakdown inventory; props, wardrobe, cast assignments, and other
 * confirmed production data belong to a separate model.
 */
export interface ScreenplayContextModel {
  scenes: readonly ScreenplaySceneContext[];
  sections: readonly ScreenplaySectionContext[];
  synopses: readonly ScreenplaySynopsisContext[];
  notes: readonly ScreenplayNoteContext[];
  characters: readonly ScreenplayCharacterContext[];
  locations: readonly ScreenplayLocationContext[];
  timesOfDay: readonly ScreenplayTimeOfDayContext[];
}

interface MutableAppearance {
  characterId: string;
  name: string;
  cueRanges: ScreenplayContextRange[];
  dialogueRanges: ScreenplayContextRange[];
  dialogueBlockCount: number;
  dialogueLineCount: number;
  dialogueWordCount: number;
}

interface MutableScene extends Omit<ScreenplaySceneContext, 'appearances'> {
  appearances: Map<string, MutableAppearance>;
}

interface MutableCharacter {
  id: string;
  key: string;
  name: string;
  cueRanges: ScreenplayContextRange[];
  dialogueRanges: ScreenplayContextRange[];
  appearances: Map<string, MutableAppearance>;
  dialogueBlockCount: number;
  dialogueLineCount: number;
  dialogueWordCount: number;
}

interface HeadingParts {
  setting?: ScreenplaySceneContext['setting'];
  location?: { name: string; start: number; end: number };
  timeOfDay?: { name: string; start: number; end: number };
}

export function buildScreenplayContext(source: string): ScreenplayContextModel {
  return buildScreenplayContextFromDocument(parseFountain(source));
}

export function buildScreenplayContextFromDocument(
  document: FountainDocument,
): ScreenplayContextModel {
  const structure = buildStructure(document);
  const characters = collectCharacters(document.elements, structure.scenes);
  return {
    scenes: finalizeScenes(structure.scenes),
    sections: structure.sections,
    synopses: structure.synopses,
    notes: structure.notes,
    characters: finalizeCharacters(characters),
    locations: collectLocations(structure.scenes),
    timesOfDay: collectTimesOfDay(structure.scenes),
  };
}

function buildStructure(document: FountainDocument) {
  const headings = document.elements.filter(
    (element): element is FountainSceneHeadingElement => element.kind === 'scene_heading',
  );
  const scenes: MutableScene[] = [];
  const sections: ScreenplaySectionContext[] = [];
  const synopses: ScreenplaySynopsisContext[] = [];
  const notes: ScreenplayNoteContext[] = [];
  const sectionStack: ScreenplaySectionContext[] = [];
  let currentScene: MutableScene | undefined;

  for (const element of document.elements) {
    if (element.kind === 'section') {
      while ((sectionStack.at(-1)?.depth ?? 0) >= element.depth) sectionStack.pop();
      const section = sectionContext(element, sections.length, sectionStack.at(-1)?.id);
      sections.push(section);
      sectionStack.push(section);
      currentScene = undefined;
      continue;
    }
    if (element.kind === 'scene_heading') {
      currentScene = sceneContext(
        element,
        headings[scenes.length + 1],
        document,
        scenes.length,
        sectionStack.map(({ id }) => id),
      );
      scenes.push(currentScene);
      continue;
    }
    if (element.kind === 'synopsis') {
      const synopsis = synopsisContext(element, synopses.length, currentScene?.id);
      synopses.push(synopsis);
      if (currentScene) currentScene.synopsisIds = [...currentScene.synopsisIds, synopsis.id];
      continue;
    }
    if (element.kind === 'note') {
      const note = noteContext(element, notes.length, currentScene?.id);
      notes.push(note);
      if (currentScene) currentScene.noteIds = [...currentScene.noteIds, note.id];
    }
  }

  for (const section of sections) {
    section.sceneIds = scenes
      .filter(({ sectionIds }) => sectionIds.includes(section.id))
      .map(({ id }) => id);
  }
  return { scenes, sections, synopses, notes };
}

function sceneContext(
  heading: FountainSceneHeadingElement,
  nextHeading: FountainSceneHeadingElement | undefined,
  document: FountainDocument,
  index: number,
  sectionIds: readonly string[],
): MutableScene {
  const id = `scene-${index + 1}`;
  const headingRange = textRange(heading, heading.text);
  const parts = parseHeadingParts(heading.text);
  const locationId = parts.location ? entityId('location', normalizeKey(parts.location.name)) : '';
  const timeOfDayId = parts.timeOfDay ? entityId('time', normalizeKey(parts.timeOfDay.name)) : '';
  return {
    id,
    index,
    heading: heading.text,
    ...(heading.sceneNumber ? { sceneNumber: heading.sceneNumber } : {}),
    ...(parts.setting ? { setting: parts.setting } : {}),
    range: {
      start: heading.start,
      end: nextHeading?.start ?? document.source.length,
      lineStart: heading.lineStart,
      lineEnd: nextHeading
        ? Math.max(heading.lineEnd, nextHeading.lineStart - 1)
        : (document.elements.at(-1)?.lineEnd ?? heading.lineEnd),
    },
    headingRange,
    ...(parts.location
      ? {
          location: {
            locationId,
            name: parts.location.name,
            range: subrange(headingRange, parts.location.start, parts.location.end),
          },
        }
      : {}),
    ...(parts.timeOfDay
      ? {
          timeOfDay: {
            timeOfDayId,
            name: parts.timeOfDay.name,
            range: subrange(headingRange, parts.timeOfDay.start, parts.timeOfDay.end),
          },
        }
      : {}),
    sectionIds: [...sectionIds],
    synopsisIds: [],
    noteIds: [],
    appearances: new Map(),
  };
}

function sectionContext(
  element: Extract<FountainElement, { kind: 'section' }>,
  index: number,
  parentId: string | undefined,
): ScreenplaySectionContext {
  return {
    id: `section-${index + 1}`,
    text: element.text,
    depth: element.depth,
    range: elementRange(element),
    textRange: textRange(element, element.text),
    ...(parentId ? { parentId } : {}),
    sceneIds: [],
  };
}

function synopsisContext(
  element: Extract<FountainElement, { kind: 'synopsis' }>,
  index: number,
  sceneId: string | undefined,
): ScreenplaySynopsisContext {
  return {
    id: `synopsis-${index + 1}`,
    text: element.text,
    range: elementRange(element),
    textRange: textRange(element, element.text),
    ...(sceneId ? { sceneId } : {}),
  };
}

function noteContext(
  element: FountainCommentElement,
  index: number,
  sceneId: string | undefined,
): ScreenplayNoteContext {
  return {
    id: `note-${index + 1}`,
    text: element.text,
    closed: element.closed,
    range: elementRange(element),
    contentRange: delimitedContentRange(element, '[[', ']]'),
    ...(sceneId ? { sceneId } : {}),
  };
}

function collectCharacters(elements: readonly FountainElement[], scenes: MutableScene[]) {
  const characters = new Map<string, MutableCharacter>();
  let sceneIndex = -1;
  let activeCharacter: MutableCharacter | undefined;
  let activeAppearance: MutableAppearance | undefined;

  for (const element of elements) {
    while (scenes[sceneIndex + 1] && element.start >= scenes[sceneIndex + 1]!.range.start) {
      sceneIndex += 1;
    }
    const scene = scenes[sceneIndex];
    if (element.kind === 'character') {
      const result = recordCharacterCue(characters, scene, element);
      activeCharacter = result.character;
      activeAppearance = result.appearance;
      continue;
    }
    if (element.kind === 'dialogue' && activeCharacter) {
      recordDialogue(activeCharacter, activeAppearance, element);
      continue;
    }
    if (element.kind !== 'parenthetical' && element.kind !== 'lyric') {
      activeCharacter = undefined;
      activeAppearance = undefined;
    }
  }
  return characters;
}

function recordCharacterCue(
  characters: Map<string, MutableCharacter>,
  scene: MutableScene | undefined,
  element: FountainCharacterElement,
) {
  const key = normalizeKey(element.name);
  const id = entityId('character', key);
  let character = characters.get(key);
  if (!character) {
    character = {
      id,
      key,
      name: element.name,
      cueRanges: [],
      dialogueRanges: [],
      appearances: new Map(),
      dialogueBlockCount: 0,
      dialogueLineCount: 0,
      dialogueWordCount: 0,
    };
    characters.set(key, character);
  }
  const cueRange = textRange(element, element.name);
  character.cueRanges.push(cueRange);
  if (!scene) return { character, appearance: undefined };
  let appearance = scene.appearances.get(id);
  if (!appearance) {
    appearance = {
      characterId: id,
      name: character.name,
      cueRanges: [],
      dialogueRanges: [],
      dialogueBlockCount: 0,
      dialogueLineCount: 0,
      dialogueWordCount: 0,
    };
    scene.appearances.set(id, appearance);
    character.appearances.set(scene.id, appearance);
  }
  appearance.cueRanges.push(cueRange);
  return { character, appearance };
}

function recordDialogue(
  character: MutableCharacter,
  appearance: MutableAppearance | undefined,
  element: Extract<FountainElement, { kind: 'dialogue' }>,
) {
  const range = textRange(element, element.text);
  const lines = countDialogueLines(element.text);
  const words = countWords(element.text);
  character.dialogueRanges.push(range);
  character.dialogueBlockCount += 1;
  character.dialogueLineCount += lines;
  character.dialogueWordCount += words;
  if (!appearance) return;
  appearance.dialogueRanges.push(range);
  appearance.dialogueBlockCount += 1;
  appearance.dialogueLineCount += lines;
  appearance.dialogueWordCount += words;
}

function finalizeScenes(scenes: readonly MutableScene[]): ScreenplaySceneContext[] {
  return scenes.map(({ appearances, ...scene }) => ({
    ...scene,
    appearances: [...appearances.values()].map(finalizeAppearance),
  }));
}

function finalizeCharacters(
  characters: ReadonlyMap<string, MutableCharacter>,
): ScreenplayCharacterContext[] {
  return [...characters.values()].map((character) => ({
    id: character.id,
    key: character.key,
    name: character.name,
    cueRanges: character.cueRanges,
    dialogueRanges: character.dialogueRanges,
    sceneIds: [...character.appearances.keys()],
    appearances: [...character.appearances.entries()].map(([sceneId, appearance]) => ({
      sceneId,
      ...finalizeAppearance(appearance),
    })),
    cueCount: character.cueRanges.length,
    dialogueBlockCount: character.dialogueBlockCount,
    dialogueLineCount: character.dialogueLineCount,
    dialogueWordCount: character.dialogueWordCount,
  }));
}

function finalizeAppearance(appearance: MutableAppearance): ScreenplayCharacterAppearance {
  return {
    characterId: appearance.characterId,
    name: appearance.name,
    cueRanges: appearance.cueRanges,
    dialogueRanges: appearance.dialogueRanges,
    cueCount: appearance.cueRanges.length,
    dialogueBlockCount: appearance.dialogueBlockCount,
    dialogueLineCount: appearance.dialogueLineCount,
    dialogueWordCount: appearance.dialogueWordCount,
  };
}

function collectLocations(scenes: readonly MutableScene[]): ScreenplayLocationContext[] {
  return collectHeadingInventory(scenes, (scene) => {
    const value = scene.location;
    return value ? { id: value.locationId, name: value.name, range: value.range } : undefined;
  });
}

function collectTimesOfDay(scenes: readonly MutableScene[]): ScreenplayTimeOfDayContext[] {
  return collectHeadingInventory(scenes, (scene) => {
    const value = scene.timeOfDay;
    return value ? { id: value.timeOfDayId, name: value.name, range: value.range } : undefined;
  });
}

function collectHeadingInventory(
  scenes: readonly MutableScene[],
  select: (
    scene: MutableScene,
  ) => { id: string; name: string; range: ScreenplayContextRange } | undefined,
) {
  const inventory = new Map<
    string,
    {
      id: string;
      key: string;
      name: string;
      sceneIds: string[];
      occurrences: ScreenplayContextOccurrence[];
    }
  >();
  for (const scene of scenes) {
    const value = select(scene);
    if (!value) continue;
    const key = normalizeKey(value.name);
    const existing = inventory.get(key);
    if (existing) {
      existing.sceneIds = [...existing.sceneIds, scene.id];
      existing.occurrences = [...existing.occurrences, { sceneId: scene.id, range: value.range }];
      continue;
    }
    inventory.set(key, {
      id: value.id,
      key,
      name: value.name,
      sceneIds: [scene.id],
      occurrences: [{ sceneId: scene.id, range: value.range }],
    });
  }
  return [...inventory.values()];
}

function parseHeadingParts(heading: string): HeadingParts {
  const match = /^(INT\.\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+(.+)$/iu.exec(
    heading.trim(),
  );
  if (!match?.[1] || !match[2]) return {};
  const prefix = match[1].toUpperCase();
  const remainder = match[2];
  const remainderStart = heading.indexOf(remainder);
  const separator = /\s+-\s+/u.exec(remainder);
  const rawLocation = separator ? remainder.slice(0, separator.index) : remainder;
  const rawTime = separator ? remainder.slice(separator.index + separator[0].length) : '';
  const location = trimmedPart(rawLocation, remainderStart);
  const timeOfDay = trimmedPart(
    rawTime,
    remainderStart + (separator?.index ?? remainder.length) + (separator?.[0].length ?? 0),
  );
  return {
    setting: headingSetting(prefix),
    ...(location ? { location } : {}),
    ...(timeOfDay ? { timeOfDay } : {}),
  };
}

function headingSetting(prefix: string): ScreenplaySceneContext['setting'] {
  if (prefix.startsWith('INT') && prefix.includes('EXT')) return 'interior_exterior';
  if (prefix.startsWith('I/E')) return 'interior_exterior';
  if (prefix.startsWith('INT')) return 'interior';
  if (prefix.startsWith('EXT')) return 'exterior';
  return 'establishing';
}

function trimmedPart(value: string, sourceStart: number) {
  const name = value.trim();
  if (!name) return undefined;
  const leading = value.indexOf(name);
  return { name, start: sourceStart + leading, end: sourceStart + leading + name.length };
}

function elementRange(element: FountainElement): ScreenplayContextRange {
  return {
    start: element.start,
    end: element.end,
    lineStart: element.lineStart,
    lineEnd: element.lineEnd,
  };
}

function textRange(element: FountainElement, text: string): ScreenplayContextRange {
  const exactOffset = element.raw.indexOf(text);
  const firstLine = text.split('\n')[0] ?? text;
  const lastLine = text.split('\n').at(-1) ?? text;
  const offset = exactOffset >= 0 ? exactOffset : element.raw.indexOf(firstLine);
  if (offset < 0) return elementRange(element);
  const endOffset =
    exactOffset >= 0
      ? exactOffset + text.length
      : element.raw.lastIndexOf(lastLine) + lastLine.length;
  return {
    start: element.start + offset,
    end: element.start + endOffset,
    lineStart: element.lineStart,
    lineEnd: element.lineEnd,
  };
}

function delimitedContentRange(
  element: FountainCommentElement,
  opener: string,
  closer: string,
): ScreenplayContextRange {
  const contentStart = Math.max(0, element.raw.indexOf(opener) + opener.length);
  const closerAt = element.closed
    ? element.raw.lastIndexOf(closer)
    : contentStart + element.text.length;
  return {
    start: element.start + contentStart,
    end: element.start + Math.max(contentStart, closerAt),
    lineStart: element.lineStart,
    lineEnd: element.lineEnd,
  };
}

function subrange(
  parent: ScreenplayContextRange,
  relativeStart: number,
  relativeEnd: number,
): ScreenplayContextRange {
  return {
    start: parent.start + relativeStart,
    end: parent.start + relativeEnd,
    lineStart: parent.lineStart,
    lineEnd: parent.lineEnd,
  };
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
}

function entityId(prefix: string, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '');
  return `${prefix}-${slug || 'unnamed'}-${stableHash(key)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function countDialogueLines(text: string): number {
  return text.split('\n').filter((line) => line.trim().length > 0).length;
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
