import {
  fountainRevisionMarker,
  parseFountain,
  type FountainRevisionGeneration,
  type FountainRevisionRange,
} from '@coda/fountain';
import { buildScreenplayPreview } from '../screenplay-preview-model';
import type { Screenplay } from '../types';

/**
 * One embedded revision generation, newest first. Generations are the document's
 * own revision marks (the Beat-compatible metadata the parser reads back), so the
 * inspector reports the same revision state the editor prints — no second source
 * of truth.
 */
export interface ScreenplayRevisionEntry {
  generation: FountainRevisionGeneration;
  /** The Fountain revision marker for the generation (`*`, `**`, `+`, …). */
  marker: string;
  additions: number;
  removals: number;
}

export interface ScreenplayInspectorModel {
  /** Absent when the source is too large to lay out on the dashboard thread. */
  metrics?: { pageCount: number; sceneCount: number };
  revisionMode: boolean;
  currentGeneration?: FountainRevisionGeneration;
  revisions: ScreenplayRevisionEntry[];
}

/**
 * Pagination is the real layout engine, not an estimate, so the page count the
 * inspector reports always matches the preview and the PDF. It is also the one
 * expensive step, so a source beyond any plausible feature length skips it rather
 * than blocking the dashboard: the pane reports the metric as unavailable.
 */
export const SCREENPLAY_INSPECTOR_SOURCE_LIMIT = 1_500_000;

function isRemoval(range: FountainRevisionRange): boolean {
  return range.kind === 'removal' || range.kind === 'removal_suggestion';
}

/**
 * Derives the inspector's read-only view of one screenplay from its saved source:
 * paginated page and scene counts, and the embedded revision generations.
 * Deliberately pure so it can be memoised per selection.
 */
export function buildScreenplayInspectorModel(screenplay: Screenplay): ScreenplayInspectorModel {
  const source = screenplay.sourceText;
  const metrics =
    source.length > SCREENPLAY_INSPECTOR_SOURCE_LIMIT
      ? undefined
      : previewMetrics(source, screenplay);
  const revisionMetadata = parseFountain(source).revisionMetadata;
  if (!revisionMetadata) return { metrics, revisionMode: false, revisions: [] };

  const byGeneration = new Map<FountainRevisionGeneration, ScreenplayRevisionEntry>();
  for (const range of revisionMetadata.ranges) {
    const entry = byGeneration.get(range.generation) ?? {
      generation: range.generation,
      marker: fountainRevisionMarker(range.generation),
      additions: 0,
      removals: 0,
    };
    if (isRemoval(range)) entry.removals += 1;
    else entry.additions += 1;
    byGeneration.set(range.generation, entry);
  }

  return {
    metrics,
    revisionMode: revisionMetadata.enabled,
    currentGeneration: revisionMetadata.currentGeneration,
    revisions: [...byGeneration.values()].sort((left, right) => right.generation - left.generation),
  };
}

function previewMetrics(
  source: string,
  screenplay: Screenplay,
): { pageCount: number; sceneCount: number } {
  const preview = buildScreenplayPreview(source, { paperSize: screenplay.paperSize });
  return { pageCount: preview.pages.length, sceneCount: preview.scenes.length };
}
