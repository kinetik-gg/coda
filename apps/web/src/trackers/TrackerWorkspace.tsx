import type { TrackerCurrentUser } from './types';
import { TrackerWorkspaceScreen } from '../workspace/TrackerWorkspaceScreen';

/**
 * The route `/trackers/:id` entry (#379). S15 reserved this addressable URL with a loading
 * shell; the real workspace now replaces it wholesale — layout sync, record grid, inspector,
 * activity, and undo all live in the tracker workspace screen.
 */
export function TrackerWorkspace({
  trackerId,
  currentUser,
  onBack,
}: {
  trackerId: string;
  currentUser: TrackerCurrentUser;
  onBack: () => void;
}) {
  return <TrackerWorkspaceScreen trackerId={trackerId} currentUser={currentUser} onBack={onBack} />;
}
