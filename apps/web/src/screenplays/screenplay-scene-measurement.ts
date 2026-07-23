import type { ScreenplaySceneContext } from './screenplay-context-model';
import { screenplayPaper, type ScreenplayPaperSpecification } from './screenplay-paper';
import type { ScreenplayPreviewModel, ScreenplayPreviewPage } from './screenplay-preview-model';

export interface ScreenplayMutableSceneMeasure {
  actionWords: number;
  contentWords: number;
  dialogueWords: number;
  wordCount: number;
  renderedLines: number;
  estimatedRows: number;
  estimatedPages: number;
  pages: Set<number>;
}

export function emptySceneMeasure(): ScreenplayMutableSceneMeasure {
  return {
    actionWords: 0,
    contentWords: 0,
    dialogueWords: 0,
    wordCount: 0,
    renderedLines: 0,
    estimatedRows: 0,
    estimatedPages: 0,
    pages: new Set(),
  };
}

export function sceneAtOffset(
  scenes: readonly ScreenplaySceneContext[],
  offset: number,
): ScreenplaySceneContext | undefined {
  let low = 0;
  let high = scenes.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const scene = scenes[middle];
    if (!scene) return undefined;
    if (offset < scene.range.start) high = middle - 1;
    else if (offset >= scene.range.end) low = middle + 1;
    else return scene;
  }
  return undefined;
}

export function measureRenderedPages(
  preview: ScreenplayPreviewModel,
  scenes: readonly ScreenplaySceneContext[],
  measures: ReadonlyMap<string, ScreenplayMutableSceneMeasure>,
): void {
  const paper = screenplayPaper(preview.paperSize);
  for (const page of preview.pages) {
    if (page.pageNumber === null || !page.lines.length) continue;
    const usage = collectPageSceneUsage(page, scenes, paper);
    applyPageLineCounts(page.pageNumber, usage.linesByScene, measures);
    applyPageRowCounts(usage.scenesByRow, measures);
  }
  for (const measure of measures.values()) {
    measure.estimatedPages = measure.estimatedRows / paper.linesPerPage;
  }
}

interface PageSceneUsage {
  linesByScene: Map<string, number>;
  scenesByRow: Map<number, Set<string>>;
}

function collectPageSceneUsage(
  page: ScreenplayPreviewPage,
  scenes: readonly ScreenplaySceneContext[],
  paper: ScreenplayPaperSpecification,
): PageSceneUsage {
  const usage: PageSceneUsage = {
    linesByScene: new Map(),
    scenesByRow: new Map(),
  };
  const firstBaseline =
    page.pageNumber === 1 ? paper.firstBodyBaseline : paper.subsequentBodyBaseline;
  for (const line of page.lines) {
    const scene = sceneAtOffset(scenes, line.sourceStart);
    if (!scene) continue;
    usage.linesByScene.set(scene.id, (usage.linesByScene.get(scene.id) ?? 0) + 1);
    const row = Math.max(0, Math.round((firstBaseline - line.baselineY) / paper.lineHeight));
    const rowScenes = usage.scenesByRow.get(row) ?? new Set<string>();
    rowScenes.add(scene.id);
    usage.scenesByRow.set(row, rowScenes);
  }
  return usage;
}

function applyPageLineCounts(
  pageNumber: number,
  linesByScene: ReadonlyMap<string, number>,
  measures: ReadonlyMap<string, ScreenplayMutableSceneMeasure>,
): void {
  for (const [sceneId, lineCount] of linesByScene) {
    const measure = measures.get(sceneId);
    if (!measure) continue;
    measure.renderedLines += lineCount;
    measure.pages.add(pageNumber);
  }
}

function applyPageRowCounts(
  scenesByRow: ReadonlyMap<number, ReadonlySet<string>>,
  measures: ReadonlyMap<string, ScreenplayMutableSceneMeasure>,
): void {
  let previousRow = -1;
  for (const [row, sceneIds] of [...scenesByRow].sort(([left], [right]) => left - right)) {
    const occupiedRows = row - previousRow;
    for (const sceneId of sceneIds) {
      const measure = measures.get(sceneId);
      if (measure) measure.estimatedRows += occupiedRows;
    }
    previousRow = row;
  }
}
