import { useCallback, useEffect, useRef, useState } from 'react';
import type { CODA_CHROME, CODA_SPACE } from '@coda/design-tokens';
import { ProjectsScreen } from '../ProjectsScreen';
import { EdgePaneSeparator } from '../components/EdgePaneSeparator';
import type { EdgePaneLayoutConfig } from '../components/edge-pane-layout';
import { useEdgePaneLayout } from '../components/useEdgePaneLayout';
import { ScreenplaysScreen } from '../ScreenplaysScreen';
import { SettingsScreen } from '../SettingsScreen';
import {
  isAccountRoute,
  isAdminRoute,
  managementProjectId,
  projectManagementPath,
  projectManagementSection,
  screenplayManagementId,
  screenplaySharePath,
} from '../app-routing';
import type { ThemeId } from '../themes';
import { ApplicationMasthead, type ApplicationMastheadContext } from './ApplicationMasthead';
import { DashboardRail } from './DashboardRail';
import {
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

const CODA_VERSION = '0.0.6';
type DashboardRailDefault = (typeof CODA_CHROME)['wRail'];
type DashboardRailStep = (typeof CODA_SPACE)['space6'];
// Compile-time token mirrors keep browser code aligned without bundling the CommonJS token module.
const DASHBOARD_RAIL_DEFAULT = 272 satisfies DashboardRailDefault;
const DASHBOARD_RAIL_STEP = 16 satisfies DashboardRailStep;
export const DASHBOARD_SIDEBAR_LAYOUT_CONFIG: EdgePaneLayoutConfig = {
  min: 224,
  max: 400,
  default: DASHBOARD_RAIL_DEFAULT,
  step: DASHBOARD_RAIL_STEP,
  storagePrefix: 'coda:dashboard-sidebar-layout:',
};

export interface DashboardShellProps {
  route: string;
  isAdministrator: boolean;
  theme: ThemeId;
  isFullscreen: boolean;
  onNavigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  logout: () => void;
  onOpenProject: (id: string) => void;
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
  if (!manageProjectId) return route;
  // Every management route is now one modal over the breakdowns library, so section navigation
  // never remounts or re-reads the surface underneath it.
  return '/breakdowns';
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
  onCreateProject,
  onOpenScreenplay,
}: {
  route: string;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
  onOpenProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}) {
  if (isAccountRoute(route) || isAdminRoute(route)) {
    return <SettingsScreen route={route} isAdministrator={isAdministrator} />;
  }
  // `/screenplays/:id/manage` is the screenplay library with that screenplay's share modal
  // presented (#169). The URL that used to open a card-stack management page still resolves; it
  // now opens the object with its modal, and dismissing the modal returns to the bare library.
  const shareScreenplayId = screenplayManagementId(route);
  // Every breakdown management URL presents the same sectioned modal over the library. The route
  // controls only which section is active.
  const manageProjectId = managementProjectId(route);
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
      onManage={(id) => onNavigate(projectManagementPath(id))}
      managementProjectId={manageProjectId}
      managementSection={manageProjectId ? projectManagementSection(route) : undefined}
      onManagementSectionChange={(section) => {
        if (manageProjectId) onNavigate(projectManagementPath(manageProjectId, section));
      }}
      onShare={(id) => onNavigate(projectManagementPath(id, 'share'))}
      onCloseManagement={() => onNavigate('/breakdowns')}
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
 * The authenticated dashboard shell in the editors' visual language: the shared declarative menu
 * bar, an optional fixed-width rail, a content container, and the shared status bar — all resolved
 * through the design tokens.
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
  onNavigate,
  chooseTheme,
  toggleFullscreen,
  logout,
  onOpenProject,
  onCreateProject,
  onOpenScreenplay,
}: DashboardShellProps) {
  const sidebar = useEdgePaneLayout('primary', DASHBOARD_SIDEBAR_LAYOUT_CONFIG);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [library, setLibrary] = useState<LibraryTarget>();
  const health = useInstanceHealth();
  const connected = useConnected();
  const storage = useInstanceStorage(isAdministrator);
  const runLibrary = useLibraryDispatch(library, onNavigate);

  const menuContext = {
    surface: 'dashboard',
    route,
    theme,
    isFullscreen,
    railCollapsed: sidebar.collapsed,
    isAdministrator,
    library,
    navigate: onNavigate,
    chooseTheme,
    toggleFullscreen,
    toggleRail: sidebar.toggleCollapsed,
    logout,
    runLibrary,
  } satisfies ApplicationMastheadContext;

  return (
    <div className={styles.shell}>
      <ApplicationMasthead context={menuContext} />
      <div ref={bodyRef} className={styles.body}>
        {!sidebar.collapsed && (
          <>
            <DashboardRail
              route={route}
              width={sidebar.width}
              isAdministrator={isAdministrator}
              onNavigate={onNavigate}
            />
            <EdgePaneSeparator
              edge="leading"
              frameRef={bodyRef}
              width={sidebar.width}
              config={DASHBOARD_SIDEBAR_LAYOUT_CONFIG}
              className={styles.railSeparator}
              label="Resize sidebar"
              onResize={sidebar.resizeTo}
            />
          </>
        )}
        <section className={styles.content}>
          <div className={styles.contentBody} key={contentKey(route)}>
            <LibraryTargetProvider publish={setLibrary}>
              <HomeContent
                route={route}
                isAdministrator={isAdministrator}
                onNavigate={onNavigate}
                onOpenProject={onOpenProject}
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
    </div>
  );
}
