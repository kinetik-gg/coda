// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsOverview, ProjectsTrash } from './ProjectsViews';
import type { Project, TrashEntry } from './types';

/** The overview hosts the properties pane (#169), which reads through React Query. */
function renderOverview(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

const breakdownEntry: TrashEntry = {
  id: 'project-1',
  kind: 'breakdown',
  name: 'Feature Film',
  deletedAt: '2026-07-01T00:00:00.000Z',
  purgeAfter: '2026-07-31T00:00:00.000Z',
  canRestore: true,
};

const screenplayEntry: TrashEntry = {
  id: 'screenplay-1',
  kind: 'screenplay',
  name: 'Night Bus',
  deletedAt: '2026-07-02T00:00:00.000Z',
  purgeAfter: '2026-08-01T00:00:00.000Z',
  canRestore: true,
};

afterEach(cleanup);

const ownedProject: Project = {
  id: 'project-1',
  name: 'Feature Film',
  description: 'Production breakdown',
  ownerUserId: 'user-1',
  updatedAt: '2026-07-01T00:00:00.000Z',
  currentMembership: {
    id: 'membership-1',
    role: {
      id: 'owner-role',
      name: 'Owner',
      permissions: [{ permission: 'manage_project_settings' }],
    },
  },
};

describe('project page views', () => {
  it('preserves open and management actions through the row context menu', async () => {
    const onOpen = vi.fn();
    const onManage = vi.fn();
    renderOverview(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[ownedProject]}
        shared={[]}
        onRetry={vi.fn()}
        onOpen={onOpen}
        onManage={onManage}
      />,
    );

    // Double-click activates open; the context menu exposes Manage.
    fireEvent.doubleClick(screen.getByRole('row', { name: 'Feature Film' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage breakdown…' }));

    expect(onOpen).toHaveBeenCalledWith('project-1');
    expect(onManage).toHaveBeenCalledWith('project-1');
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Feature Film' })).not.toHaveTextContent('Owner');
  });

  it('omits the manage action for members without manage permission', () => {
    const onManage = vi.fn();
    const sharedProject: Project = {
      ...ownedProject,
      id: 'shared-1',
      name: 'Shared Film',
      currentMembership: {
        ...ownedProject.currentMembership!,
        role: { ...ownedProject.currentMembership!.role, name: 'Viewer', permissions: [] },
      },
    };
    renderOverview(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[]}
        shared={[sharedProject]}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={onManage}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Shared Film' }));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Manage breakdown…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Share…' })).not.toBeInTheDocument();
  });

  /*
   * Moving a breakdown to trash is destructive, so it left the settings page for the row menu and
   * the properties, behind a confirmation (#176). The API restricts deletion to the owner on top of
   * `delete_project`, and the affordance matches: a member holding the permission on someone
   * else's breakdown is not offered a control the server would reject.
   */
  it('offers the trash action only to an owner holding delete_project', () => {
    const onMoveToTrash = vi.fn();
    const deletable: Project = {
      ...ownedProject,
      currentMembership: {
        ...ownedProject.currentMembership!,
        role: {
          ...ownedProject.currentMembership!.role,
          permissions: [
            { permission: 'manage_project_settings' },
            { permission: 'delete_project' },
          ],
        },
      },
    };
    const overview = (project: Project, sessionUserId?: string) => (
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[project]}
        shared={[]}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={vi.fn()}
        onShare={vi.fn()}
        onMoveToTrash={onMoveToTrash}
        sessionUserId={sessionUserId}
      />
    );

    const { unmount } = renderOverview(overview(deletable, 'user-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }));
    expect(onMoveToTrash).toHaveBeenCalledWith(deletable);
    unmount();
    cleanup();

    // Same permission, different owner: no trash action.
    renderOverview(overview(deletable, 'someone-else'));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    expect(screen.queryByRole('menuitem', { name: 'Move to trash' })).not.toBeInTheDocument();
    // The manage-gated actions are still there, so this is deletion narrowing and nothing else.
    expect(screen.getByRole('menuitem', { name: 'Share…' })).toBeInTheDocument();
  });

  it('points the empty breakdowns state at the header action (#193)', () => {
    render(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[]}
        shared={[]}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={vi.fn()}
      />,
    );
    // Creation lives in the page header now, so the empty block guides rather than duplicating it.
    expect(screen.getByText('No breakdowns yet')).toBeInTheDocument();
    expect(
      screen.getByText('Start creating your breakdown using the button above'),
    ).toBeInTheDocument();
  });

  it('restores breakdowns and screenplays and purges through the row menu', async () => {
    const onRestore = vi.fn();
    const onPurge = vi.fn();
    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        entries={[breakdownEntry, screenplayEntry]}
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={onRestore}
        onPurge={onPurge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently…' }));

    expect(onRestore).toHaveBeenCalledWith(breakdownEntry);
    expect(onPurge).toHaveBeenCalledWith(screenplayEntry);
    expect(screen.getByText('Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Screenplay')).toBeInTheDocument();
  });

  it('reports filtered-empty states and restore failures', () => {
    render(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[]}
        shared={[]}
        query="zzz"
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={vi.fn()}
      />,
    );
    expect(screen.getByText('No breakdowns match “zzz”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a breakdown' })).not.toBeInTheDocument();
    cleanup();

    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        entries={[breakdownEntry]}
        restoreFailed
        onRetry={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
    );
    expect(
      screen.getByText('The item could not be restored. Please try again.'),
    ).toBeInTheDocument();
    cleanup();

    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        entries={[]}
        query="zzz"
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
    );
    expect(screen.getByText('No trashed items match “zzz”')).toBeInTheDocument();
  });

  it('hides row actions for trashed items the member cannot restore', () => {
    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        entries={[{ ...breakdownEntry, canRestore: false }]}
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.getByText('Owner only')).toBeInTheDocument();
  });
});
