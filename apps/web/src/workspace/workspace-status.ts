export type LayoutSaveState = 'saved' | 'saving' | 'dirty' | 'error';
export type WorkspaceStatus = 'loading' | 'updating' | 'saving' | 'saved' | 'idle' | 'error';

export function resolveWorkspaceStatus(input: {
  saveState: LayoutSaveState;
  savedNoticeVisible: boolean;
  loading: number;
  updating: number;
}): WorkspaceStatus {
  if (input.saveState === 'error') return 'error';
  if (input.saveState === 'dirty' || input.saveState === 'saving') return 'saving';
  if (input.updating > 0) return 'updating';
  if (input.loading > 0) return 'loading';
  if (input.savedNoticeVisible) return 'saved';
  return 'idle';
}
