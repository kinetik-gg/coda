export interface ScreenplaySummary {
  id: string;
  ownerUserId: string;
  title: string;
  filename: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Screenplay extends ScreenplaySummary {
  sourceText: string;
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'failed';
