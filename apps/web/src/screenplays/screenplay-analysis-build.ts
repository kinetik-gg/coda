import { buildScreenplayContext } from './screenplay-context-model';
import { buildScreenplayPreview } from './screenplay-preview-model';
import { buildScreenplayStatistics } from './screenplay-statistics-model';
import type { ScreenplayAnalysis } from './screenplay-analysis';
import type { ScreenplayPaperSize } from './screenplay-paper';

export function buildScreenplayAnalysis(
  source: string,
  paperSize: ScreenplayPaperSize,
): ScreenplayAnalysis {
  const previewModel = buildScreenplayPreview(source, { paperSize });
  const contextModel = buildScreenplayContext(source);
  return Object.freeze({
    contextModel,
    previewModel,
    statisticsModel: buildScreenplayStatistics(source, contextModel, previewModel),
    wordCount: countWords(source),
  });
}

function countWords(source: string): number {
  const trimmed = source.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}
