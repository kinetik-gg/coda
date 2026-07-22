export const SCREENPLAY_LIMITS = Symbol('SCREENPLAY_LIMITS');
export const MAX_CHECKPOINTS_PER_SCREENPLAY = 100;

export interface ScreenplayLimits {
  maxDocumentsPerOwner: number;
  maxSourceBytesPerOwner: number;
  maxCheckpointsPerScreenplay: number;
  maxCheckpointBytesPerOwner: number;
}
