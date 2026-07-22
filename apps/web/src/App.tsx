import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { applyAccountPreferences, preferencesFromAccount } from './account-preferences';
import { managementProjectId, screenplayIdFromRoute, workspaceProjectId } from './app-routing';
import {
  HomeMasthead,
  WorkspaceMasthead,
  WorkspaceRouteLoadingSkeleton,
  type ProjectSummary,
} from './app-shell/ApplicationMastheads';
import { AuthScreen, ResetPasswordScreen } from './auth/AuthScreens';
import { reloadBrowserApplication } from './browser-reload';
import { ProjectManagementSkeleton } from './project-management/ProjectManagementSkeleton';
import { takeSensitiveRouteToken } from './sensitive-route-token';
import { indexedDbScreenplayRecoveryStore } from './screenplays/screenplay-recovery-store';
import { applyTheme, initialTheme, type ThemeId } from './themes';
import { WorkspaceLoadingSkeleton } from './workspace/WorkspaceLoadingSkeleton';
import styles from './App.styles';

const InvitationScreen = lazy(() =>
  import('./InvitationScreen').then((module) => ({ default: module.InvitationScreen })),
);
const ProjectManagementScreen = lazy(() =>
  import('./ProjectManagementScreen').then((module) => ({
    default: module.ProjectManagementScreen,
  })),
);
const ProjectSetupScreen = lazy(() =>
  import('./project-setup/ProjectSetupScreen').then((module) => ({
    default: module.ProjectSetupScreen,
  })),
);
const UnifiedHomeScreen = lazy(() =>
  import('./UnifiedHomeScreen').then((module) => ({ default: module.UnifiedHomeScreen })),
);
const ScreenplayEditorScreen = lazy(() =>
  import('./screenplays/ScreenplayEditorScreen').then((module) => ({
    default: module.ScreenplayEditorScreen,
  })),
);
const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
);

const initialSensitiveRouteToken = takeSensitiveRouteToken(window.location, window.history);

interface User {
  id: string;
  email: string;
  displayName: string;
  theme: string;
  fontSize: string;
  motionPreference: string;
  pdfAppearance: string;
}

function CodaLoadingFallback() {
  return <div className={styles.loading}>Loading Coda…</div>;
}

function AuthenticatedRoute({
  route,
  workspaceId,
  managementId,
  screenplayId,
  userId,
  isAdministrator,
  navigate,
}: {
  route: string;
  workspaceId?: string;
  managementId?: string;
  screenplayId?: string;
  userId: string;
  isAdministrator: boolean;
  navigate: (path: string) => void;
}) {
  if (screenplayId) {
    return (
      <Suspense fallback={<CodaLoadingFallback />}>
        <ScreenplayEditorScreen screenplayId={screenplayId} onBack={() => navigate('/')} />
      </Suspense>
    );
  }
  if (route === '/breakdowns/new') {
    return (
      <Suspense fallback={<CodaLoadingFallback />}>
        <ProjectSetupScreen
          onCancel={() => navigate('/breakdowns')}
          onCreated={(id) => navigate(`/breakdowns/${id}`)}
        />
      </Suspense>
    );
  }
  if (workspaceId) {
    return (
      <Suspense fallback={<WorkspaceLoadingSkeleton />}>
        <Workspace
          projectId={workspaceId}
          currentUserId={userId}
          onBack={() => navigate('/breakdowns')}
        />
      </Suspense>
    );
  }
  if (managementId) {
    return (
      <Suspense fallback={<ProjectManagementSkeleton />}>
        <ProjectManagementScreen
          projectId={managementId}
          onBack={() => navigate(`/breakdowns/${managementId}`)}
          onDeleted={() => navigate('/breakdowns')}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<CodaLoadingFallback />}>
      <UnifiedHomeScreen
        route={route}
        isAdministrator={isAdministrator}
        onNavigate={navigate}
        onOpenProject={(id) => navigate(`/breakdowns/${id}`)}
        onManageProject={(id) => navigate(`/breakdowns/${id}/manage`)}
        onCreateProject={() => navigate('/breakdowns/new')}
        onOpenScreenplay={(id) => navigate(`/screenplays/${id}`)}
      />
    </Suspense>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState(() => window.location.pathname);
  const [theme, setTheme] = useState<ThemeId>(() => initialTheme());
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const sensitiveRouteTokenRef = useRef(initialSensitiveRouteToken);
  const workspaceId = workspaceProjectId(route);
  const managementId = managementProjectId(route);
  const screenplayId = screenplayIdFromRoute(route);
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () =>
      api<{ initialized: boolean; setupTokenRequired: boolean }>('/api/v1/setup/status'),
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<User>('/api/v1/auth/session'),
    enabled: setup.data?.initialized === true,
    retry: false,
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectSummary[]>('/api/v1/projects'),
    enabled: Boolean(session.data),
  });
  const instanceAccess = useQuery({
    queryKey: ['instance-access'],
    queryFn: () => api<{ isAdministrator: boolean }>('/api/v1/instance/access'),
    enabled: Boolean(session.data),
    retry: false,
  });

  const navigate = useCallback((path: string) => {
    history.pushState({}, '', path);
    sensitiveRouteTokenRef.current = takeSensitiveRouteToken(window.location, window.history);
    setRoute(window.location.pathname);
  }, []);
  const chooseTheme = useCallback(
    (nextTheme: ThemeId) => {
      setTheme(nextTheme);
      applyTheme(nextTheme);
      if (!session.data) return;
      const preferences = preferencesFromAccount(session.data);
      void api('/api/v1/account/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ ...preferences, theme: nextTheme }),
      })
        .then(() => {
          queryClient.setQueryData<User>(['session'], (current) =>
            current ? { ...current, theme: nextTheme } : current,
          );
          void queryClient.invalidateQueries({ queryKey: ['account'] });
        })
        .catch(() => {
          // The applied theme remains a valid in-session preview when persistence is unavailable.
        });
    },
    [queryClient, session.data],
  );
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen can be denied by browser policy; the native F11 shortcut remains available.
    }
  }, []);
  const logout = useCallback(async () => {
    const accountId = session.data?.id;
    await api('/api/v1/auth/logout', { method: 'POST' });
    try {
      if (accountId) await indexedDbScreenplayRecoveryStore.purgeAccount(accountId);
    } catch {
      // Server logout has already succeeded; client teardown must not leave a stale authenticated UI.
    } finally {
      queryClient.clear();
      navigate('/');
      reloadBrowserApplication();
    }
  }, [navigate, queryClient, session.data]);

  useEffect(() => {
    void indexedDbScreenplayRecoveryStore.purgeExpired().catch(() => {
      // A screenplay tab still surfaces recovery storage failures if the browser blocks IndexedDB.
    });
  }, []);

  useEffect(() => {
    const updateRoute = () => {
      sensitiveRouteTokenRef.current = takeSensitiveRouteToken(window.location, window.history);
      setRoute(window.location.pathname);
    };
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);
  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);
  useEffect(() => {
    if (!session.data) return;
    const preferences = preferencesFromAccount(session.data);
    applyAccountPreferences(preferences);
    setTheme(preferences.theme);
  }, [session.data]);
  useEffect(() => {
    const syncThemeState = (event: Event) => {
      const nextTheme = (event as CustomEvent<ThemeId>).detail;
      if (nextTheme) setTheme(nextTheme);
    };
    window.addEventListener('coda:theme-change', syncThemeState);
    return () => window.removeEventListener('coda:theme-change', syncThemeState);
  }, []);

  const token = sensitiveRouteTokenRef.current;
  if (route === '/accept-invitation') {
    return (
      <Suspense fallback={<CodaLoadingFallback />}>
        <InvitationScreen
          token={token}
          onAccepted={() => {
            void queryClient.invalidateQueries({ queryKey: ['session'] });
            navigate('/');
          }}
        />
      </Suspense>
    );
  }
  if (route === '/reset-password') {
    return <ResetPasswordScreen token={token} onReset={() => navigate('/')} />;
  }
  if (setup.isLoading || (setup.data?.initialized && session.isLoading)) {
    return workspaceId ? (
      <WorkspaceRouteLoadingSkeleton />
    ) : (
      <div className={styles.loading}>Loading Coda…</div>
    );
  }
  if (setup.error) return <div className={styles.loading}>Coda could not reach its API.</div>;
  if (!setup.data?.initialized || session.error instanceof ApiError) {
    return (
      <AuthScreen
        initialized={setup.data?.initialized ?? false}
        setupTokenRequired={setup.data?.setupTokenRequired ?? false}
        onAuthenticated={() => void queryClient.invalidateQueries({ queryKey: ['session'] })}
      />
    );
  }

  const activeProjectId = workspaceId ?? managementId;
  const currentProject = projects.data?.find((project) => project.id === activeProjectId);
  return (
    <div className={`${styles.shell} ${workspaceId ? styles.editorShell : ''}`}>
      {workspaceId ? (
        <WorkspaceMasthead
          workspaceId={workspaceId}
          currentProject={currentProject}
          projects={projects.data}
          displayName={session.data?.displayName}
          theme={theme}
          isFullscreen={isFullscreen}
          navigate={navigate}
          chooseTheme={chooseTheme}
          toggleFullscreen={toggleFullscreen}
          logout={logout}
        />
      ) : !screenplayId ? (
        <HomeMasthead navigate={navigate} logout={logout} />
      ) : null}
      <AuthenticatedRoute
        route={route}
        workspaceId={workspaceId}
        managementId={managementId}
        screenplayId={screenplayId}
        userId={session.data!.id}
        isAdministrator={instanceAccess.data?.isAdministrator === true}
        navigate={navigate}
      />
    </div>
  );
}
