import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { applyAccountPreferences, preferencesFromAccount } from './account-preferences';
import { managementProjectId, workspaceProjectId } from './app-routing';
import {
  HomeMasthead,
  WorkspaceMasthead,
  WorkspaceRouteLoadingSkeleton,
  type ProjectSummary,
} from './app-shell/ApplicationMastheads';
import { AuthScreen, ResetPasswordScreen } from './auth/AuthScreens';
import { ProjectManagementSkeleton } from './project-management/ProjectManagementSkeleton';
import { takeSensitiveRouteToken } from './sensitive-route-token';
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

export function App() {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState(() => window.location.pathname);
  const [theme, setTheme] = useState<ThemeId>(() => initialTheme());
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const sensitiveRouteTokenRef = useRef(initialSensitiveRouteToken);
  const workspaceId = workspaceProjectId(route);
  const managementId = managementProjectId(route);
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
    await api('/api/v1/auth/logout', { method: 'POST' });
    queryClient.clear();
    navigate('/');
    window.location.reload();
  }, [navigate, queryClient]);

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
      ) : (
        <HomeMasthead navigate={navigate} logout={logout} />
      )}
      {route === '/projects/new' ? (
        <Suspense fallback={<CodaLoadingFallback />}>
          <ProjectSetupScreen
            onCancel={() => navigate('/')}
            onCreated={(id) => navigate(`/projects/${id}`)}
          />
        </Suspense>
      ) : workspaceId ? (
        <Suspense fallback={<WorkspaceLoadingSkeleton />}>
          <Workspace
            projectId={workspaceId}
            currentUserId={session.data!.id}
            onBack={() => navigate('/')}
          />
        </Suspense>
      ) : managementId ? (
        <Suspense fallback={<ProjectManagementSkeleton />}>
          <ProjectManagementScreen
            projectId={managementId}
            onBack={() => navigate(`/projects/${managementId}`)}
            onDeleted={() => navigate('/')}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<CodaLoadingFallback />}>
          <UnifiedHomeScreen
            route={route}
            isAdministrator={instanceAccess.data?.isAdministrator === true}
            onNavigate={navigate}
            onOpenProject={(id) => navigate(`/projects/${id}`)}
            onManageProject={(id) => navigate(`/projects/${id}/manage`)}
            onCreateProject={() => navigate('/projects/new')}
          />
        </Suspense>
      )}
    </div>
  );
}
