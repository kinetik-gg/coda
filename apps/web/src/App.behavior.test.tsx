// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app-shell/ApplicationMastheads', () => ({
  HomeMasthead: (props: { navigate: (path: string) => void; logout: () => Promise<void> }) => (
    <header>
      <button onClick={() => props.navigate('/account')}>Home account</button>
      <button onClick={() => void props.logout()}>Home logout</button>
    </header>
  ),
  WorkspaceMasthead: (props: {
    chooseTheme: (theme: 'coda-light') => void;
    toggleFullscreen: () => Promise<void>;
  }) => (
    <header>
      <button onClick={() => props.chooseTheme('coda-light')}>Choose light</button>
      <button onClick={() => void props.toggleFullscreen()}>Fullscreen</button>
    </header>
  ),
  WorkspaceRouteLoadingSkeleton: () => <div>Workspace route loading</div>,
}));
vi.mock('./UnifiedHomeScreen', () => ({
  UnifiedHomeScreen: (props: {
    route: string;
    onNavigate: (path: string) => void;
    onCreateProject: () => void;
  }) => (
    <main>
      <span>Home route {props.route}</span>
      <button onClick={() => props.onNavigate('/trash')}>Go trash</button>
      <button onClick={props.onCreateProject}>Create breakdown</button>
    </main>
  ),
}));
vi.mock('./project-setup/ProjectSetupScreen', () => ({
  ProjectSetupScreen: (props: { onCancel: () => void; onCreated: (id: string) => void }) => (
    <main>
      <span>Setup breakdown</span>
      <button onClick={props.onCancel}>Cancel setup</button>
      <button onClick={() => props.onCreated('10000000-0000-4000-8000-000000000001')}>
        Finish setup
      </button>
    </main>
  ),
}));
vi.mock('./ProjectManagementScreen', () => ({
  ProjectManagementScreen: (props: {
    projectId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <main>
      <span>Manage {props.projectId}</span>
      <button onClick={props.onBack}>Management back</button>
      <button onClick={props.onDeleted}>Management deleted</button>
    </main>
  ),
}));
vi.mock('./Workspace', () => ({
  Workspace: (props: { projectId: string; onBack: () => void }) => (
    <main>
      <span>Workspace {props.projectId}</span>
      <button onClick={props.onBack}>Workspace back</button>
    </main>
  ),
}));
vi.mock('./auth/AuthScreens', () => ({
  AuthScreen: (props: { initialized: boolean; onAuthenticated: () => void }) => (
    <main>
      <span>Auth {String(props.initialized)}</span>
      <button onClick={props.onAuthenticated}>Authenticate</button>
    </main>
  ),
  ResetPasswordScreen: () => <main>Reset route</main>,
}));
vi.mock('./InvitationScreen', () => ({ InvitationScreen: () => <main>Invitation route</main> }));

import { App } from './App';

function envelope(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App routing controller', () => {
  it('loads session context and transitions among home, setup, management, and workspace routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/setup/status')
          return envelope({ initialized: true, setupTokenRequired: false });
        if (path === '/api/v1/auth/session')
          return envelope({
            id: 'user',
            email: 'u@example.com',
            displayName: 'User',
            theme: 'coda-dark',
            fontSize: 'default',
            motionPreference: 'system',
            pdfAppearance: 'theme',
          });
        if (path === '/api/v1/projects')
          return envelope([{ id: '10000000-0000-4000-8000-000000000001', name: 'Film' }]);
        if (path === '/api/v1/instance/access') return envelope({ isAdministrator: true });
        if (path === '/api/v1/account/preferences') return envelope({});
        if (path === '/api/v1/auth/logout') return envelope({});
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    renderApp();
    expect(await screen.findByText('Home route /')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create breakdown' }));
    expect(await screen.findByText('Setup breakdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(
      await screen.findByText('Workspace 10000000-0000-4000-8000-000000000001'),
    ).toBeInTheDocument();

    history.pushState({}, '', '/breakdowns/10000000-0000-4000-8000-000000000001/manage');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(
      await screen.findByText('Manage 10000000-0000-4000-8000-000000000001'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Management back' }));
    expect(
      await screen.findByText('Workspace 10000000-0000-4000-8000-000000000001'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose light' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('coda-light'));
  });

  it('renders setup and session failures through the authentication boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/setup/status')
          return envelope({ initialized: false, setupTokenRequired: true });
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    renderApp();
    expect(await screen.findByText('Auth false')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));
  });
});
