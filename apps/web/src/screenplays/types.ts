import type { ScreenplayPaperSize } from './screenplay-paper';

export interface ScreenplaySummary {
  id: string;
  ownerUserId: string;
  title: string;
  filename: string;
  paperSize: ScreenplayPaperSize;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Screenplay extends ScreenplaySummary {
  sourceText: string;
}
