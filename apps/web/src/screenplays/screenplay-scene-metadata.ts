import { parseFountain, type FountainElement } from '@coda/fountain';
import type { ScreenplayContextModel } from './screenplay-context-model';
import {
  emptySceneMeasure,
  measureRenderedPages,
  sceneAtOffset,
  type ScreenplayMutableSceneMeasure,
} from './screenplay-scene-measurement';
import type { ScreenplayPreviewModel } from './screenplay-preview-model';
import { ratio, round } from './screenplay-statistics-math';

export interface ScreenplaySceneMetadata {
  sceneId: string;
  sceneIndex: number;
  wordCount: number;
  /** Layout-derived page estimate. Omitted when the preview has no rendered rows. */
  estimatedPages?: number;
  /** Page-per-minute estimate expressed in seconds. */
  estimatedDurationSeconds?: number;
  /** Dialogue share of action plus dialogue words. */
  dialogueDensity?: number;
}

const measuredKinds = new Set<FountainElement['kind']>([
  'action',
  'centered',
  'character',
  'dialogue',
  'lyric',
  'parenthetical',
  'scene_heading',
  'transition',
]);

/**
 * Builds lightweight per-scene outline metadata without computing the full
 * statistics model. Page and duration values remain preview-layout heuristics.
 */
export function buildScreenplaySceneMetadata(
  source: string,
  context: ScreenplayContextModel,
  preview: ScreenplayPreviewModel,
): readonly ScreenplaySceneMetadata[] {
  const measures = new Map(context.scenes.map((scene) => [scene.id, emptySceneMeasure()] as const));
  for (const element of parseFountain(source).elements) {
    if (!measuredKinds.has(element.kind)) continue;
    const scene = sceneAtOffset(context.scenes, element.start);
    if (!scene) continue;
    measureElement(measures.get(scene.id), element);
  }
  measureRenderedPages(preview, context.scenes, measures);
  return buildScreenplaySceneMetadataFromMeasures(context, measures);
}

export function buildScreenplaySceneMetadataFromMeasures(
  context: ScreenplayContextModel,
  measures: ReadonlyMap<string, ScreenplayMutableSceneMeasure>,
): readonly ScreenplaySceneMetadata[] {
  return Object.freeze(
    context.scenes.map((scene) => {
      const measure = measures.get(scene.id) ?? emptySceneMeasure();
      const estimatedPages = round(measure.estimatedPages, 2);
      const dialogueAndActionWords = measure.actionWords + measure.dialogueWords;
      return Object.freeze({
        sceneId: scene.id,
        sceneIndex: scene.index + 1,
        wordCount: measure.wordCount,
        ...(estimatedPages > 0 ? { estimatedPages } : {}),
        ...(estimatedPages > 0 ? { estimatedDurationSeconds: round(estimatedPages * 60, 1) } : {}),
        ...(dialogueAndActionWords > 0
          ? { dialogueDensity: ratio(measure.dialogueWords, dialogueAndActionWords) }
          : {}),
      });
    }),
  );
}

function measureElement(
  measure: ScreenplayMutableSceneMeasure | undefined,
  element: FountainElement,
): void {
  if (!measure) return;
  const words = element.kind === 'character' || !('text' in element) ? 0 : countWords(element.text);
  measure.wordCount += words;
  if (element.kind !== 'scene_heading') measure.contentWords += words;
  if (element.kind === 'action' || element.kind === 'centered') measure.actionWords += words;
  if (element.kind === 'dialogue' || element.kind === 'lyric') measure.dialogueWords += words;
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
