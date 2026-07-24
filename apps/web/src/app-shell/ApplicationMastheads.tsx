import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { Skeleton } from '../components/Skeleton';
import { messages } from '../messages';
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
}

function BrandButton({ navigate }: { navigate: (path: string) => void }) {
  return (
    <button onClick={() => navigate('/')} className={styles.brand}>
      <span className={styles.logoMark} aria-hidden="true" />
      <span className={styles.visuallyHidden}>{messages.brand}</span>
    </button>
  );
}

export function WorkspaceMasthead(props: WorkspaceMastheadProps) {
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
  };
  return (
    <MenuBar
      model={breakdownMenuBarModel}
      context={context}
      globalActions
      leading={<BrandButton navigate={props.navigate} />}
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
