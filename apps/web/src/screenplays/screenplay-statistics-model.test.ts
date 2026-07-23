import { describe, expect, it } from 'vitest';
import { buildScreenplayContext } from './screenplay-context-model';
import type { ScreenplayLayoutLine, ScreenplayPreviewModel } from './screenplay-preview-model';
import { buildScreenplayStatistics } from './screenplay-statistics-model';

const source = `INT. HOUSE - DAY

ALICE
Hello there.

BOB
Hi Alice, welcome home.

They cross the room and sit beside the window.

INT. PARK - NIGHT

ALICE
We should leave now.

Bob watches as rain covers the empty path and street while a long line of cars slowly passes behind them in the darkness outside.
`;

function line(id: string, sourceStart: number, baselineY: number): ScreenplayLayoutLine {
  return {
    id,
    blockId: id,
    kind: 'action',
    text: '',
    x: 0,
    baselineY,
    width: 0,
    columns: 60,
    align: 'left',
    font: 'regular',
    sourceStart,
    sourceEnd: sourceStart + 1,
  };
}

function previewModel(): ScreenplayPreviewModel {
  const first = source.indexOf('INT. HOUSE');
  const second = source.indexOf('INT. PARK');
  return {
    paperSize: 'a4',
    printableBlocks: [],
    scenes: [],
    pages: [
      {
        id: 'page-1',
        pageNumber: 1,
        blocks: [],
        lines: [
          line('1', first, 769),
          line('2', first + 5, 757),
          line('3', first + 20, 745),
          line('4', second, 733),
        ],
      },
      {
        id: 'page-2',
        pageNumber: 2,
        blocks: [],
        lines: [
          line('5', second, 769.5),
          line('6', second + 5, 757.5),
          line('7', second + 20, 745.5),
          line('8', second + 30, 733.5),
        ],
      },
    ],
  };
}

describe('screenplay statistics model', () => {
  it('measures speaking share, scene share, locations, balance, and co-occurrence deterministically', () => {
    const context = buildScreenplayContext(source);
    const model = buildScreenplayStatistics(source, context, previewModel());

    expect(model.totals).toMatchObject({
      pages: 2,
      scenes: 2,
      speakingCharacters: 2,
      locations: 2,
      dialogueBlocks: 3,
      dialogueWords: 10,
      averageDialogueWords: 3.3,
    });
    expect(
      model.characters.map(({ name, dialogueWordCount, speakingSceneCount }) => ({
        name,
        dialogueWordCount,
        speakingSceneCount,
      })),
    ).toEqual([
      { name: 'ALICE', dialogueWordCount: 6, speakingSceneCount: 2 },
      { name: 'BOB', dialogueWordCount: 4, speakingSceneCount: 1 },
    ]);
    expect(model.characters[0]).toMatchObject({
      dialogueShare: 0.6,
      speakingSceneShare: 1,
      estimatedAppearanceSceneShare: 1,
      firstScene: 1,
      lastScene: 2,
      dialogueWordsPerSpeakingScene: 3,
      averageDialogueWords: 3,
      estimatedSpeakingMinutes: 0.05,
    });
    expect(model.characters[1]).toMatchObject({
      speakingSceneCount: 1,
      estimatedAppearanceSceneCount: 2,
      estimatedAppearanceSceneShare: 1,
    });
    expect(model.locations.map(({ label, count, share }) => ({ label, count, share }))).toEqual([
      { label: 'HOUSE', count: 1, share: 0.5 },
      { label: 'PARK', count: 1, share: 0.5 },
    ]);
    expect(model.coOccurrences[0]).toMatchObject({
      firstCharacter: 'ALICE',
      secondCharacter: 'BOB',
      sharedSceneCount: 1,
      sharedSceneShare: 0.5,
    });
    expect(
      model.dialogueActionBalance.actionShare + model.dialogueActionBalance.dialogueShare,
    ).toBeCloseTo(1);
    expect(model.readingEstimates).toMatchObject({
      estimatedDialogueMinutes: 0.08,
      readingWordsPerMinute: 200,
      speakingWordsPerMinute: 130,
    });
    expect(model.locationReuse).toMatchObject({
      uniqueLocationCount: 2,
      reusedLocationCount: 0,
      singleUseLocationCount: 2,
      reuseRate: 0,
      averageScenesPerLocation: 1,
      maximumScenesAtLocation: 1,
    });
  });

  it('allocates page equivalents by rendered lines and labels structural heuristics explicitly', () => {
    const model = buildScreenplayStatistics(source, buildScreenplayContext(source), previewModel());

    expect(
      model.scenes.map(({ estimatedPages, firstPage, lastPage }) => ({
        estimatedPages,
        firstPage,
        lastPage,
      })),
    ).toEqual([
      { estimatedPages: 0.03, firstPage: 1, lastPage: 1 },
      { estimatedPages: 0.07, firstPage: 1, lastPage: 2 },
    ]);
    expect(model.pacing).toMatchObject({
      averageScenePages: 0.05,
      medianScenePages: 0.05,
      minimumScenePages: 0.03,
      maximumScenePages: 0.07,
      shortSceneCount: 2,
      standardSceneCount: 0,
      longSceneCount: 0,
    });
    expect(model.hasHeuristicEstimates).toBe(true);
    expect(model.sceneMetadata).toEqual([
      {
        sceneId: model.scenes[0]!.id,
        sceneIndex: 1,
        wordCount: model.scenes[0]!.wordCount,
        estimatedPages: 0.03,
        estimatedDurationSeconds: 1.8,
        dialogueDensity: model.scenes[0]!.dialogueDensity,
      },
      {
        sceneId: model.scenes[1]!.id,
        sceneIndex: 2,
        wordCount: model.scenes[1]!.wordCount,
        estimatedPages: 0.07,
        estimatedDurationSeconds: 4.2,
        dialogueDensity: model.scenes[1]!.dialogueDensity,
      },
    ]);
    expect(model.structuralChecks.every((check) => check.status === 'pass')).toBe(true);
    expect(model.observations.join(' ')).toContain('largest dialogue share');
  });

  it('returns safe empty statistics when the draft has no scene headings', () => {
    const emptySource = 'A short unstructured note.';
    const model = buildScreenplayStatistics(emptySource, buildScreenplayContext(emptySource), {
      paperSize: 'a4',
      printableBlocks: [],
      scenes: [],
      pages: [{ id: 'page-1', pageNumber: 1, blocks: [], lines: [] }],
    });

    expect(model.totals.scenes).toBe(0);
    expect(model.characters).toEqual([]);
    expect(model.pacing.averageScenePages).toBe(0);
    expect(model.observations).toEqual(['Add scene headings to unlock structural observations.']);
    expect(model.readingEstimates.estimatedReadingMinutes).toBeGreaterThan(0);
    expect(model.sceneMetadata).toEqual([]);
  });

  it('finds repeated language, reused locations, and structural consistency notices', () => {
    const repeatedSource = `INT. ROOM

Action repeat phrase action repeat phrase.

INT. ROOM

[[open`;
    const model = buildScreenplayStatistics(
      repeatedSource,
      buildScreenplayContext(repeatedSource),
      { paperSize: 'letter', printableBlocks: [], scenes: [], pages: [] },
    );

    expect(model.repeatedWords.map(({ text, count }) => ({ text, count }))).toEqual([
      { text: 'action', count: 2 },
      { text: 'phrase', count: 2 },
      { text: 'repeat', count: 2 },
    ]);
    expect(model.repeatedPhrases).toContainEqual(
      expect.objectContaining({ text: 'action repeat phrase', count: 2, kind: 'phrase' }),
    );
    expect(model.locationReuse).toMatchObject({
      reusedLocationCount: 1,
      singleUseLocationCount: 0,
      reuseRate: 1,
      maximumScenesAtLocation: 2,
    });
    expect(
      Object.fromEntries(model.structuralChecks.map((check) => [check.id, check.count])),
    ).toMatchObject({
      'missing-times': 2,
      'empty-scenes': 1,
      'duplicate-headings': 1,
      'unclosed-comments': 1,
    });
    expect(model.sceneMetadata[1]).not.toHaveProperty('estimatedPages');
    expect(model.sceneMetadata[1]).not.toHaveProperty('dialogueDensity');
  });
});
