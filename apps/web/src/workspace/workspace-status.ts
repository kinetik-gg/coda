import type { WorkspaceLayout } from '@coda/contracts';
import type { SaveState } from './shell';

/** The breakdown workspace's own layout-persistence vocabulary, mapped onto the canonical `SaveState`. */
export type LayoutPersistState = 'saved' | 'saving' | 'dirty' | 'error';

/**
 * A publish that lost the optimistic-concurrency race against another publisher, held pending an
 * explicit user choice: overwrite the concurrently-published default, or adopt {@link latestDefault}.
 */
export interface PublishConflict {
  latestDefault: WorkspaceLayout;
}

/**
 * Maps the breakdown workspace's layout-persistence state and read-activity counters onto the
 * canonical `SaveState` vocabulary shared with the screenplay editor. Layout persistence (a
 * pending or in-flight write) always outranks read activity (loading/updating), matching the
 * priority order the workspace previously encoded ad hoc.
 */
export function resolveBreakdownSaveState(input: {
  persistState: LayoutPersistState;
  loading: number;
  updating: number;
}): SaveState {
  if (input.persistState === 'error') return 'failed';
  if (input.persistState === 'saving') return 'saving';
  if (input.persistState === 'dirty') return 'unsaved';
  if (input.updating > 0) return 'updating';
  if (input.loading > 0) return 'loading';
  return 'saved';
}
