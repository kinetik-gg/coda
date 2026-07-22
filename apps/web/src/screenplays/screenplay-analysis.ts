import type { ScreenplayContextModel } from './screenplay-context-model';
import type { ScreenplayPaperSize } from './screenplay-paper';
import type { ScreenplayPreviewModel } from './screenplay-preview-model';
import type { ScreenplayStatisticsModel } from './screenplay-statistics-model';

export interface ScreenplayAnalysis {
  contextModel: ScreenplayContextModel;
  previewModel: ScreenplayPreviewModel;
  statisticsModel: ScreenplayStatisticsModel;
  wordCount: number;
}

export interface ScreenplayAnalysisRequest {
  type: 'analyze';
  requestId: number;
  source: string;
  paperSize: ScreenplayPaperSize;
}

export type ScreenplayAnalysisResponse =
  | {
      type: 'result';
      requestId: number;
      analysis: ScreenplayAnalysis;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

const emptyItems = Object.freeze([]);

export const emptyScreenplayAnalysis: ScreenplayAnalysis = Object.freeze({
  contextModel: Object.freeze({
    scenes: emptyItems,
    sections: emptyItems,
    synopses: emptyItems,
    notes: emptyItems,
    characters: emptyItems,
    locations: emptyItems,
    timesOfDay: emptyItems,
  }),
  previewModel: Object.freeze({
    paperSize: 'letter',
    pages: emptyItems,
    scenes: emptyItems,
    printableBlocks: emptyItems,
  }),
  statisticsModel: Object.freeze({
    totals: {
      pages: 0,
      scenes: 0,
      words: 0,
      speakingCharacters: 0,
      locations: 0,
      dialogueBlocks: 0,
      dialogueWords: 0,
      actionWords: 0,
      averageDialogueWords: 0,
    },
    dialogueActionBalance: { actionWords: 0, dialogueWords: 0, actionShare: 0, dialogueShare: 0 },
    readingEstimates: {
      estimatedReadingMinutes: 0,
      estimatedDialogueMinutes: 0,
      readingWordsPerMinute: 200 as const,
      speakingWordsPerMinute: 130 as const,
    },
    writingBalance: emptyItems,
    characters: emptyItems,
    locations: emptyItems,
    timesOfDay: emptyItems,
    settings: emptyItems,
    scenes: emptyItems,
    coOccurrences: emptyItems,
    locationReuse: {
      uniqueLocationCount: 0,
      reusedLocationCount: 0,
      singleUseLocationCount: 0,
      reuseRate: 0,
      averageScenesPerLocation: 0,
      maximumScenesAtLocation: 0,
    },
    repeatedWords: emptyItems,
    repeatedPhrases: emptyItems,
    structuralChecks: emptyItems,
    sceneMetadata: emptyItems,
    pacing: {
      averageScenePages: 0,
      medianScenePages: 0,
      minimumScenePages: 0,
      maximumScenePages: 0,
      averageSceneWords: 0,
      medianSceneWords: 0,
      shortSceneCount: 0,
      standardSceneCount: 0,
      longSceneCount: 0,
      dialogueFreeSceneCount: 0,
      actionHeavySceneCount: 0,
    },
    observations: emptyItems,
    hasHeuristicEstimates: true,
  }),
  wordCount: 0,
});
