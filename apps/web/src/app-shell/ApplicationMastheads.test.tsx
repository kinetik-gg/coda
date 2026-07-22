// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeMasthead, WorkspaceMasthead } from './ApplicationMastheads';

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
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }));

    expect(navigate).toHaveBeenCalledWith('/projects/new');
    expect(screen.queryByRole('menuitem', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('lists project and account actions from the current workspace', () => {
    const { navigate } = renderWorkspaceMasthead();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Feature Film' }));
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Account settings' }));

    expect(navigate).toHaveBeenCalledWith('/account');
  });
});
