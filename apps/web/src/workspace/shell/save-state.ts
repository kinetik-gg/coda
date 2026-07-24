/**
 * Canonical save-state vocabulary shared by every editor's status bar.
 *
 * This is the superset union of the breakdown workspace's layout-persistence states
 * (saved/saving/dirty→unsaved/error→failed, plus the read-activity states loading/updating)
 * and the screenplay autosave states (saved/unsaved/saving/offline/conflict/failed). Every
 * editor's persistence layer maps onto this single vocabulary instead of inventing its own.
 */
export type SaveState =
  'loading' | 'updating' | 'saving' | 'saved' | 'unsaved' | 'conflict' | 'failed' | 'offline';

export type SaveStateTone = 'muted' | 'success' | 'danger';

export interface SaveStateDescriptor {
  label: string;
  tone: SaveStateTone;
  /** Whether the chip should render a spinning activity icon instead of a static one. */
  spinning: boolean;
}

export const SAVE_STATES: readonly SaveState[] = [
  'loading',
  'updating',
  'saving',
  'saved',
  'unsaved',
  'conflict',
  'failed',
  'offline',
];

export const SAVE_STATE_DESCRIPTORS: Readonly<Record<SaveState, SaveStateDescriptor>> = {
  loading: { label: 'LOADING', tone: 'muted', spinning: true },
  updating: { label: 'UPDATING', tone: 'muted', spinning: true },
  saving: { label: 'SAVING', tone: 'muted', spinning: true },
  saved: { label: 'SAVED', tone: 'success', spinning: false },
  unsaved: { label: 'UNSAVED', tone: 'muted', spinning: false },
  offline: { label: 'OFFLINE · LOCAL CHANGES KEPT', tone: 'muted', spinning: false },
  conflict: { label: 'SAVE CONFLICT', tone: 'danger', spinning: false },
  failed: { label: 'SAVE ERROR', tone: 'danger', spinning: false },
};
