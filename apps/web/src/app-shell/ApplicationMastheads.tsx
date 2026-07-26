import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { ShareButton } from '../components/ShareButton';
import { Skeleton } from '../components/Skeleton';
import { messages } from '../messages';
import { canManageProject } from '../projects/access';
import type { ThemeId } from '../themes';
import { WorkspaceLoadingSkeleton } from '../workspace/WorkspaceLoadingSkeleton';
import styles from '../App.styles';
import { MenuBar } from './menu-bar';
import {
  breakdownMenuBarModel,
  type BreakdownMenuContext,
  type ProjectSummary,
} from './breakdown-menu';

export type { ProjectSummary };

interface WorkspaceMastheadProps {
  workspaceId: string;
  currentProject?: ProjectSummary;
  projects?: ProjectSummary[];
  displayName?: string;
  theme: ThemeId;
  isFullscreen: boolean;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => Promise<void>;
  logout: () => Promise<void>;
  onShare: () => void;
}

function BrandButton({ navigate }: { navigate: (path: string) => void }) {
  return (
    <button onClick={() => navigate('/')} className={styles.brand}>
      <span className={styles.logoMark} aria-hidden="true" />
      <span className={styles.visuallyHidden}>{messages.brand}</span>
    </button>
  );
}

/**
 * The breakdown workspace masthead. Its trailing cluster carries the same visible `Share` button
 * the screenplay editor's masthead does, so management is reachable from inside either object in
 * the same place, under the same word, without leaving the object (#176). It renders only for a
 * caller who may actually manage the breakdown.
 */
export function WorkspaceMasthead(props: WorkspaceMastheadProps) {
  const canManage = props.currentProject ? canManageProject(props.currentProject) : false;
  const context: BreakdownMenuContext = {
    workspaceId: props.workspaceId,
    currentProject: props.currentProject,
    projects: props.projects,
    displayName: props.displayName,
    theme: props.theme,
    isFullscreen: props.isFullscreen,
    navigate: props.navigate,
    chooseTheme: props.chooseTheme,
    toggleFullscreen: () => void props.toggleFullscreen(),
    logout: () => void props.logout(),
    openShare: props.onShare,
    canManage,
  };
  return (
    <MenuBar
      model={breakdownMenuBarModel}
      context={context}
      globalActions
      leading={<BrandButton navigate={props.navigate} />}
      trailing={canManage ? <ShareButton onClick={props.onShare} /> : undefined}
    />
  );
}

export function HomeMasthead({
  navigate,
  logout,
}: Pick<WorkspaceMastheadProps, 'navigate' | 'logout'>) {
  return (
    <header className={styles.homeMasthead}>
      <button onClick={() => navigate('/')} className={styles.homeBrand}>
        <span className={styles.logoMark} aria-hidden="true" />
        <span className={styles.visuallyHidden}>{messages.brand}</span>
      </button>
      <div className={styles.homeAccount}>
        <button type="button" onClick={() => void logout()}>
          <SignOutIcon size={12} aria-hidden="true" /> Sign out
        </button>
      </div>
    </header>
  );
}

export function WorkspaceRouteLoadingSkeleton() {
  return (
    <div className={`${styles.shell} ${styles.editorShell}`} aria-busy="true">
      <header className={styles.masthead}>
        <div className={styles.appMenus}>
          <Skeleton width={50} height={18} radius={2} />
          <Skeleton width={188} height={12} />
        </div>
        <Skeleton width={190} height={28} radius={4} />
      </header>
      <WorkspaceLoadingSkeleton />
    </div>
  );
}
