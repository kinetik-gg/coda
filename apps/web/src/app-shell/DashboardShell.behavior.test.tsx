// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeId } from '../themes';
import { DashboardShell, type DashboardShellProps } from './DashboardShell';

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const healthyDoctor = {
  rows: [{ status: 'ok' }, { status: 'warn' }],
};

function stubFetch(doctor: unknown = healthyDoctor) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/instance/doctor') return envelope(doctor);
      if (path === '/api/v1/screenplays') return envelope([]);
      if (path === '/api/v1/projects') return envelope([]);
      if (path === '/api/v1/projects/trash') return envelope([]);
      return envelope([]);
    }),
  );
}

function baseProps(overrides: Partial<DashboardShellProps> = {}): DashboardShellProps {
  return {
    route: '/',
    isAdministrator: true,
    theme: 'coda-dark' as ThemeId,
    isFullscreen: false,
    displayName: 'Ada Lovelace',
    onNavigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    logout: vi.fn(),
    onOpenProject: vi.fn(),
    onManageProject: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenScreenplay: vi.fn(),
    ...overrides,
  };
}

function renderShell(props: DashboardShellProps) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardShell {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => stubFetch());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DashboardShell chrome', () => {
  it('mounts the library surfaces inside the content frame', async () => {
    const { rerender } = renderShell(baseProps({ route: '/' }));
    expect(await screen.findByRole('heading', { name: 'Screenplays' })).toBeVisible();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...baseProps({ route: '/trash' })} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Coda pages' })).toBeInTheDocument();
  });

  it('runs File menu actions through the declarative model', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New breakdown' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/breakdowns/new');

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(props.logout).toHaveBeenCalledOnce();
  });

  it('collapses the rail from the View menu and expands it from the rail control', () => {
    renderShell(baseProps());
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide Sidebar' }));
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('chooses a theme from the Edit menu submenu', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Light' }));
    expect(props.chooseTheme).toHaveBeenCalledWith('light');
  });

  it('opens Help links without a full-page navigation', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderShell(baseProps());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    expect(open).toHaveBeenCalledWith('https://coda.github.io', '_blank', 'noopener,noreferrer');
  });

  it('navigates and signs out from the user menu', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Account settings' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account');

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(props.logout).toHaveBeenCalledOnce();
  });

  it('summarizes healthy and unhealthy instance status from the doctor endpoint', async () => {
    renderShell(baseProps());
    expect((await screen.findAllByText('Healthy')).length).toBeGreaterThan(0);

    stubFetch({ rows: [{ status: 'error' }] });
    cleanup();
    renderShell(baseProps());
    expect((await screen.findAllByText('Issues')).length).toBeGreaterThan(0);
  });

  it('shows the update chip only when an update is available', () => {
    const { rerender } = renderShell(baseProps({ updateAvailable: false }));
    expect(screen.queryByText('Update')).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...baseProps({ updateAvailable: true })} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('roves rail focus with the arrow keys', () => {
    renderShell(baseProps());
    const rail = screen.getByRole('navigation', { name: 'Coda pages' });
    const items = within(rail).getAllByRole('button');
    items[0]!.focus();
    fireEvent.keyDown(rail, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });
});
