import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ProjectsScreen } from '../ProjectsScreen';
import { ProjectManagementSkeleton } from '../project-management/ProjectManagementSkeleton';
import { ScreenplaysScreen } from '../ScreenplaysScreen';
import { SettingsScreen } from '../SettingsScreen';
import {
  isAccountRoute,
  isAdminRoute,
  managementProjectId,
  projectManagementSection,
  screenplayManagementId,
  screenplaySharePath,
} from '../app-routing';
import { isEditableKeyboardTarget, keybindingMatches } from '../keybindings';
import { messages } from '../messages';
import type { ThemeId } from '../themes';
import appStyles from '../App.styles';
import { MenuBar } from './menu-bar';
import { CommandPalette } from './CommandPalette';
import {
  dashboardCommands,
  isCommandEnabled,
  isCommandVisible,
  type PaletteMode,
} from './dashboard-commands';
import { dashboardMenuBarModel, type DashboardMenuContext } from './dashboard-menu';
import { DashboardRail } from './DashboardRail';
import {
  DashboardMastheadTrailing,
  DashboardStatusBar,
  useConnected,
  useInstanceHealth,
  useInstanceStorage,
} from './DashboardChrome';
import {
  LibraryTargetProvider,
  type LibrarySurfaceCapability,
  type LibraryTarget,
} from './library-target';
import styles from './DashboardShell.module.css';

const ProjectManagementScreen = lazy(() =>
  import('../ProjectManagementScreen').then((module) => ({
    default: module.ProjectManagementScreen,
  })),
);

const CODA_VERSION = '0.0.6';

/**
 * Whether the host window paints its own title bar. The Electron shell renders frameless, so the
 * masthead has to leave the top-left corner clear for the platform's window controls; a browser
 * tab has no such corner and reserves nothing.
 */
export type WindowChrome = 'framed' | 'frameless';

export interface DashboardShellProps {
  route: string;
  isAdministrator: boolean;
  theme: ThemeId;
  isFullscreen: boolean;
  displayName?: string;
  updateAvailable?: boolean;
  windowChrome?: WindowChrome;
  onNavigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  logout: () => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}

/**
 * The remount key for the content panel. Routes that address the *same* surface share a key, so
 * presenting a route-addressable modal over a list (`/screenplays/:id/manage`, #169) does not tear
 * the list down and re-read it underneath the modal.
 */
function contentKey(route: string): string {
  const shareScreenplayId = screenplayManagementId(route);
  if (shareScreenplayId) return '/screenplays';
  const manageProjectId = managementProjectId(route);
  return manageProjectId ? `/breakdowns/${manageProjectId}/manage` : route;
}

/**
 * Routes the content panel: the settings surface owns Account and Administration (including the
 * `/admin/settings*` instance-settings sub-tree) behind one entry point (#163), everything else is
 * the library the rail's Library group points at.
 */
function HomeContent({
  route,
  isAdministrator,
  onNavigate,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: {
  route: string;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}) {
  if (isAccountRoute(route) || isAdminRoute(route)) {
    return (
      <SettingsScreen route={route} isAdministrator={isAdministrator} onNavigate={onNavigate} />
    );
  }
  // `/screenplays/:id/manage` is the screenplay library with that screenplay's share modal
  // presented (#169). The URL that used to open a card-stack management page still resolves; it
  // now opens the object with its modal, and dismissing the modal returns to the bare library.
  const shareScreenplayId = screenplayManagementId(route);
  // Breakdown settings mounts in the shell like every other surface (#169), so it inherits the
  // fixed viewport, the rail, and the status bar instead of floating in a centred document column.
  const manageProjectId = managementProjectId(route);
  if (manageProjectId) {
    return (
      <Suspense fallback={<ProjectManagementSkeleton />}>
        <ProjectManagementScreen
          projectId={manageProjectId}
          section={projectManagementSection(route)}
          onNavigate={onNavigate}
          onDeleted={() => onNavigate('/breakdowns')}
        />
      </Suspense>
    );
  }
  if (route === '/' || route === '/screenplays' || shareScreenplayId) {
    return (
      <ScreenplaysScreen
        onOpen={onOpenScreenplay}
        shareScreenplayId={shareScreenplayId}
        onCloseShare={() => onNavigate('/screenplays')}
        onShare={(id) => onNavigate(screenplaySharePath(id))}
      />
    );
  }
  return (
    <ProjectsScreen
      page={route === '/trash' ? 'deleted' : 'overview'}
      embedded
      onOpen={onOpenProject}
      onManage={onManageProject}
      onCreate={onCreateProject}
    />
  );
}

/**
 * Dispatches a surface-owned command. When the mounted surface already offers the capability it
 * runs immediately; otherwise the shell routes to the library and holds the request until a
 * surface that can service it publishes itself — so `New Screenplay` works from the Audit log.
 */
function useLibraryDispatch(library: LibraryTarget | undefined, navigate: (path: string) => void) {
  const [pending, setPending] = useState<LibrarySurfaceCapability>();

  useEffect(() => {
    if (!pending || !library) return;
    const handler = library[pending];
    setPending(undefined);
    handler?.();
  }, [library, pending]);

  return useCallback(
    (capability: LibrarySurfaceCapability) => {
      const handler = library?.[capability];
      if (handler) {
        handler();
        return;
      }
      setPending(capability);
      navigate('/');
    },
    [library, navigate],
  );
}

/**
 * Runs a command's declared chord. Chords fire only outside text entry — apart from the palette
 * itself, which must stay reachable from a search field — and only when the command is both
 * visible and enabled, so a greyed-out menu item has no working shortcut either.
 */
function useCommandShortcuts(context: DashboardMenuContext, suspended: boolean) {
  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editable = isEditableKeyboardTarget(event.target);
      for (const command of dashboardCommands) {
        if (!command.keybinding || !keybindingMatches(command.keybinding, event)) continue;
        if (editable && command.id !== 'command-palette') return;
        if (!isCommandVisible(command, context) || !isCommandEnabled(command, context)) return;
        event.preventDefault();
        command.run(context);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [context, suspended]);
}

/**
 * The authenticated dashboard shell in the editors' visual language: the shared declarative menu
 * bar, a dense collapsible rail, a panel-frame content container, and the shared status bar — all
 * resolved through the design tokens.
 *
 * The chrome is deliberately desktop-native. A menu bar and a status bar are what Finder, Music,
 * and Scrivener carry on their library surfaces, so the menu carries the commands a library
 * genuinely owns (issue #165) and the status bar reports what this instance holds. ⌘K complements
 * the menu rather than replacing it: both project the same command registry.
 */
export function DashboardShell({
  route,
  isAdministrator,
  theme,
  isFullscreen,
  displayName,
  updateAvailable = false,
  windowChrome = 'framed',
  onNavigate,
  chooseTheme,
  toggleFullscreen,
  logout,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: DashboardShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>();
  const [library, setLibrary] = useState<LibraryTarget>();
  const toggleRail = useCallback(() => setRailCollapsed((value) => !value), []);
  const closePalette = useCallback(() => setPaletteMode(undefined), []);
  const health = useInstanceHealth();
  const connected = useConnected();
  const storage = useInstanceStorage(isAdministrator);
  const runLibrary = useLibraryDispatch(library, onNavigate);

  const menuContext: DashboardMenuContext = {
    route,
    theme,
    isFullscreen,
    railCollapsed,
    isAdministrator,
    library,
    navigate: onNavigate,
    chooseTheme,
    toggleFullscreen,
    toggleRail,
    logout,
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    openPalette: setPaletteMode,
    runLibrary,
  };

  useCommandShortcuts(menuContext, paletteMode !== undefined);

  return (
    <div className={styles.shell} data-window-chrome={windowChrome}>
      <MenuBar
        className={`${appStyles.masthead} ${styles.masthead}`}
        model={dashboardMenuBarModel}
        context={menuContext}
        leading={
          <>
            <span className={styles.windowControlsInset} aria-hidden />
            <button type="button" onClick={() => onNavigate('/')} className={appStyles.brand}>
              <span className={appStyles.logoMark} aria-hidden />
              <span className={appStyles.visuallyHidden}>{messages.brand}</span>
            </button>
          </>
        }
        trailing={
          <DashboardMastheadTrailing
            updateAvailable={updateAvailable}
            displayName={displayName}
            onOpenPalette={() => setPaletteMode('all')}
            onNavigate={onNavigate}
            onLogout={logout}
          />
        }
      />
      <div className={styles.body}>
        <DashboardRail
          route={route}
          collapsed={railCollapsed}
          displayName={displayName}
          onToggleCollapsed={toggleRail}
          onNavigate={onNavigate}
        />
        <section className={styles.content}>
          <div className={styles.contentBody} key={contentKey(route)}>
            <LibraryTargetProvider publish={setLibrary}>
              <HomeContent
                route={route}
                isAdministrator={isAdministrator}
                onNavigate={onNavigate}
                onOpenProject={onOpenProject}
                onManageProject={onManageProject}
                onCreateProject={onCreateProject}
                onOpenScreenplay={onOpenScreenplay}
              />
            </LibraryTargetProvider>
          </div>
        </section>
      </div>
      <DashboardStatusBar
        version={CODA_VERSION}
        health={health}
        connected={connected}
        library={library}
        storage={storage}
      />
      {paletteMode && (
        <CommandPalette mode={paletteMode} context={menuContext} onClose={closePalette} />
      )}
    </div>
  );
}
