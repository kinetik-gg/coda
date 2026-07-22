import { parseFountain, type FountainElement } from '@coda/fountain';
import type { ScreenplayContextModel } from './screenplay-context-model';
import type { ScreenplayPreviewModel } from './screenplay-preview-model';
import {
  emptySceneMeasure,
  measureRenderedPages,
  sceneAtOffset,
  type ScreenplayMutableSceneMeasure,
} from './screenplay-scene-measurement';
import {
  buildScreenplaySceneMetadataFromMeasures,
  type ScreenplaySceneMetadata,
} from './screenplay-scene-metadata';
import {
  average,
  formatStatisticPercent,
  median,
  percentile,
  ratio,
  round,
} from './screenplay-statistics-math';
import {
  buildStructuralChecks,
  type ScreenplayStructuralCheck,
} from './screenplay-structural-analytics';
import {
  analyzeRepeatedText,
  buildReadingEstimates,
  SCREENPLAY_SPEAKING_WORDS_PER_MINUTE,
  type ScreenplayReadingEstimates,
  type ScreenplayRepeatedTextStatistic,
} from './screenplay-text-analytics';

export { formatStatisticPercent } from './screenplay-statistics-math';
export type { ScreenplaySceneMetadata } from './screenplay-scene-metadata';

export interface ScreenplayStatisticShare {
  id: string;
  label: string;
  count: number;
  share: number;
  sourceOffset?: number;
}

export interface ScreenplayCharacterStatistic {
  id: string;
  name: string;
  speakingSceneCount: number;
  speakingSceneShare: number;
  estimatedAppearanceSceneCount: number;
  estimatedAppearanceSceneShare: number;
  cueCount: number;
  dialogueBlockCount: number;
  dialogueLineCount: number;
  dialogueWordCount: number;
  dialogueShare: number;
  dialogueWordsPerSpeakingScene: number;
  averageDialogueWords: number;
  estimatedSpeakingMinutes: number;
  firstScene: number;
  lastScene: number;
  sourceOffset: number;
}

export interface ScreenplaySceneStatistic {
  id: string;
  index: number;
  heading: string;
  sourceOffset: number;
  firstPage?: number;
  lastPage?: number;
  renderedLineCount: number;
  estimatedPages: number;
  estimatedMinutes: number;
  estimatedDurationSeconds: number;
  wordCount: number;
  actionWordCount: number;
  dialogueWordCount: number;
  dialogueShare: number;
  /** Share of action + dialogue words that are dialogue. */
  dialogueDensity: number;
  speakingCharacterCount: number;
  dialogueFree: boolean;
  actionHeavy: boolean;
  lengthBand: 'short' | 'standard' | 'long';
  outlier: 'short' | 'long' | null;
}

export interface ScreenplayCoOccurrenceStatistic {
  id: string;
  firstCharacter: string;
  secondCharacter: string;
  sharedSceneCount: number;
  sharedSceneShare: number;
}

export interface ScreenplayLocationReuseStatistic {
  uniqueLocationCount: number;
  reusedLocationCount: number;
  singleUseLocationCount: number;
  reuseRate: number;
  averageScenesPerLocation: number;
  maximumScenesAtLocation: number;
}

export interface ScreenplayStatisticsModel {
  totals: {
    pages: number;
    scenes: number;
    words: number;
    speakingCharacters: number;
    locations: number;
    dialogueBlocks: number;
    dialogueWords: number;
    actionWords: number;
    averageDialogueWords: number;
  };
  dialogueActionBalance: {
    actionWords: number;
    dialogueWords: number;
    actionShare: number;
    dialogueShare: number;
  };
  readingEstimates: ScreenplayReadingEstimates;
  writingBalance: readonly ScreenplayStatisticShare[];
  characters: readonly ScreenplayCharacterStatistic[];
  locations: readonly ScreenplayStatisticShare[];
  timesOfDay: readonly ScreenplayStatisticShare[];
  settings: readonly ScreenplayStatisticShare[];
  scenes: readonly ScreenplaySceneStatistic[];
  coOccurrences: readonly ScreenplayCoOccurrenceStatistic[];
  locationReuse: ScreenplayLocationReuseStatistic;
  repeatedWords: readonly ScreenplayRepeatedTextStatistic[];
  repeatedPhrases: readonly ScreenplayRepeatedTextStatistic[];
  structuralChecks: readonly ScreenplayStructuralCheck[];
  sceneMetadata: readonly ScreenplaySceneMetadata[];
  pacing: {
    averageScenePages: number;
    medianScenePages: number;
    minimumScenePages: number;
    maximumScenePages: number;
    averageSceneWords: number;
    medianSceneWords: number;
    shortSceneCount: number;
    standardSceneCount: number;
    longSceneCount: number;
    dialogueFreeSceneCount: number;
    actionHeavySceneCount: number;
  };
  observations: readonly string[];
  /** The page/minute and rendered-line measures are layout-based estimates. */
  hasHeuristicEstimates: true;
}

const printableKinds = new Set<FountainElement['kind']>([
  'action',
  'centered',
  'character',
  'dialogue',
  'lyric',
  'parenthetical',
  'scene_heading',
  'transition',
]);

export function buildScreenplayStatistics(
  source: string,
  context: ScreenplayContextModel,
  preview: ScreenplayPreviewModel,
): ScreenplayStatisticsModel {
  const document = parseFountain(source);
  const sceneMeasures = new Map(
    context.scenes.map((scene) => [scene.id, emptySceneMeasure()] as const),
  );
  const balanceCounts = new Map<string, number>([
    ['action', 0],
    ['dialogue', 0],
    ['parentheticals', 0],
    ['headings', 0],
    ['other', 0],
  ]);
  const estimatedPresence = new Map(
    context.characters.map((character) => [character.id, new Set(character.sceneIds)] as const),
  );

  for (const element of document.elements) {
    if (!printableKinds.has(element.kind)) continue;
    const category = writingCategory(element);
    const words = countElementWords(element);
    balanceCounts.set(category, (balanceCounts.get(category) ?? 0) + words);
    const scene = sceneAtOffset(context.scenes, element.start);
    if (!scene) continue;
    const measure = sceneMeasures.get(scene.id)!;
    measure.wordCount += words;
    if (element.kind !== 'scene_heading') measure.contentWords += words;
    if (element.kind === 'action' || element.kind === 'centered') measure.actionWords += words;
    if (element.kind === 'dialogue' || element.kind === 'lyric') measure.dialogueWords += words;
    if (element.kind === 'action' || element.kind === 'centered') {
      recordActionMentions(element.text, scene.id, context, estimatedPresence);
    }
  }

  measureRenderedPages(preview, context.scenes, sceneMeasures);
  const scenes = buildSceneStatistics(context, sceneMeasures);
  applyOutliers(scenes);
  const dialogueWords = context.characters.reduce(
    (total, character) => total + character.dialogueWordCount,
    0,
  );
  const dialogueBlocks = context.characters.reduce(
    (total, character) => total + character.dialogueBlockCount,
    0,
  );
  const characters = buildCharacterStatistics(context, dialogueWords, estimatedPresence);
  const locations = context.locations
    .map((location) =>
      shareMetric(
        location.id,
        location.name,
        location.sceneIds.length,
        context.scenes.length,
        location.occurrences[0]?.range.start,
      ),
    )
    .sort(compareShareMetrics);
  const timesOfDay = context.timesOfDay
    .map((time) =>
      shareMetric(
        time.id,
        time.name,
        time.sceneIds.length,
        context.scenes.length,
        time.occurrences[0]?.range.start,
      ),
    )
    .sort(compareShareMetrics);
  const settings = buildSettingShares(context);
  const writingBalance = buildWritingBalance(balanceCounts);
  const coOccurrences = buildCoOccurrences(context);
  const pacing = buildPacing(scenes);
  const totalWords = [...balanceCounts.values()].reduce((total, count) => total + count, 0);
  const actionWords = balanceCounts.get('action') ?? 0;
  const totals = {
    pages: preview.pages.filter((page) => page.pageNumber !== null).length,
    scenes: context.scenes.length,
    words: totalWords,
    speakingCharacters: context.characters.length,
    locations: context.locations.length,
    dialogueBlocks,
    dialogueWords,
    actionWords,
    averageDialogueWords: round(ratio(dialogueWords, dialogueBlocks), 1),
  };
  const dialogueActionTotal = dialogueWords + actionWords;
  const repeatedText = analyzeRepeatedText(document.elements);
  const sceneMetadata = buildScreenplaySceneMetadataFromMeasures(context, sceneMeasures);
  return Object.freeze({
    totals,
    dialogueActionBalance: Object.freeze({
      actionWords,
      dialogueWords,
      actionShare: ratio(actionWords, dialogueActionTotal),
      dialogueShare: ratio(dialogueWords, dialogueActionTotal),
    }),
    readingEstimates: buildReadingEstimates(totalWords, dialogueWords),
    writingBalance: Object.freeze(writingBalance),
    characters: Object.freeze(characters),
    locations: Object.freeze(locations),
    timesOfDay: Object.freeze(timesOfDay),
    settings: Object.freeze(settings),
    scenes: Object.freeze(scenes),
    coOccurrences: Object.freeze(coOccurrences),
    locationReuse: Object.freeze(buildLocationReuse(locations)),
    repeatedWords: Object.freeze(repeatedText.repeatedWords),
    repeatedPhrases: Object.freeze(repeatedText.repeatedPhrases),
    structuralChecks: Object.freeze(
      buildStructuralChecks(
        context,
        document.elements,
        context.scenes.map((scene) => ({
          id: scene.id,
          wordCount: sceneMeasures.get(scene.id)?.contentWords ?? 0,
        })),
      ),
    ),
    sceneMetadata: Object.freeze(sceneMetadata),
    pacing,
    observations: Object.freeze(buildObservations(totals, characters, locations, scenes, pacing)),
    hasHeuristicEstimates: true as const,
  });
}

function writingCategory(element: FountainElement): string {
  if (element.kind === 'action' || element.kind === 'centered') return 'action';
  if (element.kind === 'dialogue' || element.kind === 'lyric') return 'dialogue';
  if (element.kind === 'parenthetical') return 'parentheticals';
  if (element.kind === 'scene_heading') return 'headings';
  return 'other';
}

function countElementWords(element: FountainElement): number {
  if (element.kind === 'character') return 0;
  if ('text' in element) return countWords(element.text);
  return 0;
}

function buildWritingBalance(counts: ReadonlyMap<string, number>): ScreenplayStatisticShare[] {
  const labels: Readonly<Record<string, string>> = {
    action: 'Action',
    dialogue: 'Dialogue',
    parentheticals: 'Parentheticals',
    headings: 'Scene headings',
    other: 'Transitions & other',
  };
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()].map(([id, count]) => ({
    id,
    label: labels[id] ?? id,
    count,
    share: ratio(count, total),
  }));
}

function buildCharacterStatistics(
  context: ScreenplayContextModel,
  totalDialogueWords: number,
  estimatedPresence: ReadonlyMap<string, ReadonlySet<string>>,
): ScreenplayCharacterStatistic[] {
  const sceneIndexes = new Map(context.scenes.map((scene) => [scene.id, scene.index + 1]));
  return context.characters
    .map((character) => {
      const indexes = character.sceneIds
        .map((sceneId) => sceneIndexes.get(sceneId))
        .filter((value): value is number => value !== undefined);
      return {
        id: character.id,
        name: character.name,
        speakingSceneCount: character.sceneIds.length,
        speakingSceneShare: ratio(character.sceneIds.length, context.scenes.length),
        estimatedAppearanceSceneCount: estimatedPresence.get(character.id)?.size ?? 0,
        estimatedAppearanceSceneShare: ratio(
          estimatedPresence.get(character.id)?.size ?? 0,
          context.scenes.length,
        ),
        cueCount: character.cueCount,
        dialogueBlockCount: character.dialogueBlockCount,
        dialogueLineCount: character.dialogueLineCount,
        dialogueWordCount: character.dialogueWordCount,
        dialogueShare: ratio(character.dialogueWordCount, totalDialogueWords),
        dialogueWordsPerSpeakingScene: ratio(
          character.dialogueWordCount,
          character.sceneIds.length,
        ),
        averageDialogueWords: round(
          ratio(character.dialogueWordCount, character.dialogueBlockCount),
          1,
        ),
        estimatedSpeakingMinutes: round(
          character.dialogueWordCount / SCREENPLAY_SPEAKING_WORDS_PER_MINUTE,
          2,
        ),
        firstScene: indexes.length ? Math.min(...indexes) : 0,
        lastScene: indexes.length ? Math.max(...indexes) : 0,
        sourceOffset: character.cueRanges[0]?.start ?? 0,
      };
    })
    .sort(
      (first, second) =>
        second.dialogueWordCount - first.dialogueWordCount || first.name.localeCompare(second.name),
    );
}

function recordActionMentions(
  text: string,
  sceneId: string,
  context: ScreenplayContextModel,
  presence: ReadonlyMap<string, Set<string>>,
): void {
  for (const character of context.characters) {
    if (containsWholeName(text, character.name)) presence.get(character.id)?.add(sceneId);
  }
}

function containsWholeName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function buildSceneStatistics(
  context: ScreenplayContextModel,
  measures: ReadonlyMap<string, ScreenplayMutableSceneMeasure>,
): ScreenplaySceneStatistic[] {
  return context.scenes.map((scene) => {
    const measure = measures.get(scene.id) ?? emptySceneMeasure();
    const pages = [...measure.pages].sort((first, second) => first - second);
    const estimatedPages = round(measure.estimatedPages, 2);
    return {
      id: scene.id,
      index: scene.index + 1,
      heading: scene.heading,
      sourceOffset: scene.range.start,
      ...(pages[0] === undefined ? {} : { firstPage: pages[0] }),
      ...(pages.at(-1) === undefined ? {} : { lastPage: pages.at(-1) }),
      renderedLineCount: measure.renderedLines,
      estimatedPages,
      estimatedMinutes: estimatedPages,
      estimatedDurationSeconds: round(estimatedPages * 60, 1),
      wordCount: measure.wordCount,
      actionWordCount: measure.actionWords,
      dialogueWordCount: measure.dialogueWords,
      dialogueShare: ratio(measure.dialogueWords, measure.actionWords + measure.dialogueWords),
      dialogueDensity: ratio(measure.dialogueWords, measure.actionWords + measure.dialogueWords),
      speakingCharacterCount: scene.appearances.length,
      dialogueFree: measure.dialogueWords === 0,
      actionHeavy:
        measure.actionWords >= 20 &&
        ratio(measure.actionWords, measure.actionWords + measure.dialogueWords) >= 0.7,
      lengthBand: estimatedPages < 0.5 ? 'short' : estimatedPages > 2 ? 'long' : 'standard',
      outlier: null,
    };
  });
}

function applyOutliers(scenes: ScreenplaySceneStatistic[]): void {
  if (scenes.length < 4) return;
  const lengths = scenes.map((scene) => scene.estimatedPages).sort((a, b) => a - b);
  const firstQuartile = percentile(lengths, 0.25);
  const thirdQuartile = percentile(lengths, 0.75);
  const spread = thirdQuartile - firstQuartile;
  const low = Math.max(0, firstQuartile - spread * 1.5);
  const high = thirdQuartile + spread * 1.5;
  for (const scene of scenes) {
    if (scene.estimatedPages < low) scene.outlier = 'short';
    else if (scene.estimatedPages > high) scene.outlier = 'long';
  }
}

function buildCoOccurrences(context: ScreenplayContextModel): ScreenplayCoOccurrenceStatistic[] {
  const names = new Map(context.characters.map((character) => [character.id, character.name]));
  const counts = new Map<string, { firstId: string; secondId: string; count: number }>();
  for (const scene of context.scenes) {
    const ids = [...new Set(scene.appearances.map((appearance) => appearance.characterId))].sort();
    for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < ids.length; secondIndex += 1) {
        const firstId = ids[firstIndex]!;
        const secondId = ids[secondIndex]!;
        const id = `${firstId}::${secondId}`;
        const current = counts.get(id);
        counts.set(id, { firstId, secondId, count: (current?.count ?? 0) + 1 });
      }
    }
  }
  return [...counts.entries()]
    .map(([id, value]) => ({
      id,
      firstCharacter: names.get(value.firstId) ?? 'Unknown',
      secondCharacter: names.get(value.secondId) ?? 'Unknown',
      sharedSceneCount: value.count,
      sharedSceneShare: ratio(value.count, context.scenes.length),
    }))
    .sort(
      (first, second) =>
        second.sharedSceneCount - first.sharedSceneCount || first.id.localeCompare(second.id),
    );
}

function buildSettingShares(context: ScreenplayContextModel): ScreenplayStatisticShare[] {
  const labels = {
    interior: 'Interior',
    exterior: 'Exterior',
    interior_exterior: 'Interior / exterior',
    establishing: 'Establishing',
    unspecified: 'Unspecified',
  } as const;
  const counts = new Map<keyof typeof labels, number>();
  for (const scene of context.scenes) {
    const key = scene.setting ?? 'unspecified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => shareMetric(id, labels[id], count, context.scenes.length))
    .sort(compareShareMetrics);
}

function buildLocationReuse(
  locations: readonly ScreenplayStatisticShare[],
): ScreenplayLocationReuseStatistic {
  const reusedLocationCount = locations.filter((location) => location.count > 1).length;
  return {
    uniqueLocationCount: locations.length,
    reusedLocationCount,
    singleUseLocationCount: locations.length - reusedLocationCount,
    reuseRate: ratio(reusedLocationCount, locations.length),
    averageScenesPerLocation: round(average(locations.map((location) => location.count)), 1),
    maximumScenesAtLocation: locations[0]?.count ?? 0,
  };
}

function buildPacing(scenes: readonly ScreenplaySceneStatistic[]) {
  const pages = scenes.map((scene) => scene.estimatedPages);
  const words = scenes.map((scene) => scene.wordCount);
  return {
    averageScenePages: round(average(pages), 2),
    medianScenePages: round(median(pages), 2),
    minimumScenePages: round(pages.length ? Math.min(...pages) : 0, 2),
    maximumScenePages: round(pages.length ? Math.max(...pages) : 0, 2),
    averageSceneWords: round(average(words), 1),
    medianSceneWords: round(median(words), 1),
    shortSceneCount: scenes.filter((scene) => scene.lengthBand === 'short').length,
    standardSceneCount: scenes.filter((scene) => scene.lengthBand === 'standard').length,
    longSceneCount: scenes.filter((scene) => scene.lengthBand === 'long').length,
    dialogueFreeSceneCount: scenes.filter((scene) => scene.dialogueFree).length,
    actionHeavySceneCount: scenes.filter((scene) => scene.actionHeavy).length,
  };
}

function buildObservations(
  totals: ScreenplayStatisticsModel['totals'],
  characters: readonly ScreenplayCharacterStatistic[],
  locations: readonly ScreenplayStatisticShare[],
  scenes: readonly ScreenplaySceneStatistic[],
  pacing: ScreenplayStatisticsModel['pacing'],
): string[] {
  if (!totals.scenes) return ['Add scene headings to unlock structural observations.'];
  const observations: string[] = [];
  const leadSpeaker = characters[0];
  if (leadSpeaker) {
    observations.push(
      `${leadSpeaker.name} has the largest dialogue share at ${formatStatisticPercent(leadSpeaker.dialogueShare)} across ${String(leadSpeaker.speakingSceneCount)} speaking scenes.`,
    );
  }
  const primaryLocation = locations[0];
  if (primaryLocation) {
    observations.push(
      `${primaryLocation.label} is the most-used parsed location (${String(primaryLocation.count)} scenes, ${formatStatisticPercent(primaryLocation.share)}).`,
    );
  }
  if (pacing.dialogueFreeSceneCount) {
    observations.push(
      `${String(pacing.dialogueFreeSceneCount)} of ${String(totals.scenes)} scenes contain no parsed dialogue.`,
    );
  }
  if (pacing.actionHeavySceneCount) {
    observations.push(
      `${String(pacing.actionHeavySceneCount)} scenes are action-heavy by the 70% action-word heuristic.`,
    );
  }
  const ensembleScenes = scenes.filter((scene) => scene.speakingCharacterCount >= 4).length;
  if (ensembleScenes) {
    observations.push(`${String(ensembleScenes)} scenes have cues from four or more characters.`);
  }
  if (pacing.medianScenePages > 0 && pacing.maximumScenePages > pacing.medianScenePages * 2.5) {
    observations.push(
      `The longest scene is ${pacing.maximumScenePages.toFixed(2)} estimated pages, over 2.5× the median.`,
    );
  }
  return observations.slice(0, 6);
}

function shareMetric(
  id: string,
  label: string,
  count: number,
  total: number,
  sourceOffset?: number,
): ScreenplayStatisticShare {
  return {
    id,
    label,
    count,
    share: ratio(count, total),
    ...(sourceOffset === undefined ? {} : { sourceOffset }),
  };
}

function compareShareMetrics(
  first: ScreenplayStatisticShare,
  second: ScreenplayStatisticShare,
): number {
  return second.count - first.count || first.label.localeCompare(second.label);
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
