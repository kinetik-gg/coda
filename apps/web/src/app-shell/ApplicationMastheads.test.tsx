// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HomeMasthead,
  WorkspaceMasthead,
  WorkspaceRouteLoadingSkeleton,
} from './ApplicationMastheads';

afterEach(cleanup);

function renderWorkspaceMasthead() {
  const navigate = vi.fn();
  const logout = vi.fn(() => Promise.resolve());
  render(
    <WorkspaceMasthead
      workspaceId="project-1"
      currentProject={{ id: 'project-1', name: 'Feature Film' }}
      projects={[
        { id: 'project-1', name: 'Feature Film' },
        { id: 'project-2', name: 'Documentary' },
      ]}
      displayName="Editor User"
      theme="coda-dark"
      isFullscreen={false}
      navigate={navigate}
      chooseTheme={vi.fn()}
      toggleFullscreen={vi.fn(() => Promise.resolve())}
      logout={logout}
    />,
  );
  return { navigate, logout };
}

describe('application mastheads', () => {
  it('keeps the home brand and sign-out actions wired', () => {
    const navigate = vi.fn();
    const logout = vi.fn(() => Promise.resolve());
    render(<HomeMasthead navigate={navigate} logout={logout} />);

    fireEvent.click(screen.getByRole('button', { name: 'Coda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(navigate).toHaveBeenCalledWith('/');
    expect(logout).toHaveBeenCalledOnce();
  });

  it('opens the File menu and preserves its navigation actions', () => {
    const { navigate } = renderWorkspaceMasthead();

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New breakdown' }));

    expect(navigate).toHaveBeenCalledWith('/breakdowns/new');
    expect(screen.queryByRole('menuitem', { name: 'New breakdown' })).not.toBeInTheDocument();
  });

  it('lists project and account actions from the current workspace', () => {
    const { navigate } = renderWorkspaceMasthead();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Feature Film' }));
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Account settings' }));

    expect(navigate).toHaveBeenCalledWith('/account');
  });

  it('executes file, edit, view, workspace, and project commands', () => {
    const navigate = vi.fn();
    const chooseTheme = vi.fn();
    const toggleFullscreen = vi.fn().mockResolvedValue(undefined);
    const logout = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceMasthead
        workspaceId="project-1"
        currentProject={{ id: 'project-1', name: 'Feature Film' }}
        projects={[{ id: 'project-2', name: 'Documentary' }]}
        displayName="Editor User"
        theme="coda-dark"
        isFullscreen
        navigate={navigate}
        chooseTheme={chooseTheme}
        toggleFullscreen={toggleFullscreen}
        logout={logout}
      />,
    );
    const select = (menu: string, item: string) => {
      const trigger = screen.getByRole('menuitem', { name: menu });
      if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(item) }));
    };
    select('File', 'Screenplays');
    select('File', 'Sign out');

    const actions: string[] = [];
    for (const action of [
      'undo-item',
      'redo-item',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
      'text-increase',
      'text-decrease',
      'text-reset',
      'reset-workspace',
      'publish-workspace',
    ])
      window.addEventListener(`coda:${action}`, () => actions.push(action));
    select('Edit', 'Undo');
    select('Edit', 'Redo');
    for (const item of [
      'Zoom In',
      'Zoom Out',
      'Actual Size',
      'Increase text size',
      'Decrease text size',
      'Reset text size',
    ])
      select('View', item);
    select('View', 'Exit Full Screen');
    select('Workspace', 'Reset workspace');
    select('Workspace', 'Publish default');
    select('Feature Film', 'Manage current breakdown');
    select('Feature Film', 'Documentary');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    const themeChoice = screen
      .getAllByRole('menuitem')
      .find((entry) => entry.textContent?.includes('Light'))!;
    fireEvent.click(themeChoice);
    expect(chooseTheme).toHaveBeenCalled();
    expect(toggleFullscreen).toHaveBeenCalled();
    expect(actions).toEqual(
      expect.arrayContaining(['undo-item', 'redo-item', 'zoom-in', 'reset-workspace']),
    );
    expect(navigate).toHaveBeenCalledWith('/breakdowns/project-1/manage');
    expect(navigate).toHaveBeenCalledWith('/breakdowns/project-2');
  });

  it('supports keyboard traversal, submenu dismissal, outside clicks, and loading UI', () => {
    renderWorkspaceMasthead();
    const file = screen.getByRole('menuitem', { name: 'File' });
    fireEvent.keyDown(file, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Screenplays' })).toBeInTheDocument();
    const popup = screen.getByRole('menu', { name: 'File' });
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft', 'Tab'])
      fireEvent.keyDown(popup, { key });
    fireEvent.keyDown(file, { key: 'Enter' });
    fireEvent.keyDown(file, { key: 'Escape' });
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit' }), { key: ' ' });
    const theme = screen.getByRole('menuitem', { name: 'Theme' });
    fireEvent.keyDown(theme, { key: 'ArrowRight' });
    const themeMenu = screen.getByRole('menu', { name: 'Theme' });
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft'])
      fireEvent.keyDown(themeMenu, { key });
    fireEvent.pointerDown(document.body);
    cleanup();
    render(<WorkspaceRouteLoadingSkeleton />);
    expect(screen.getByText('Opening workspace')).toBeInTheDocument();
  });
});
