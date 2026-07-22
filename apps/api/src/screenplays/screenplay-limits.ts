export const SCREENPLAY_LIMITS = Symbol('SCREENPLAY_LIMITS');

export interface ScreenplayLimits {
  maxDocumentsPerOwner: number;
  maxSourceBytesPerOwner: number;
}
