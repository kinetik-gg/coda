// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsOverview, ProjectsTrash } from './ProjectsViews';
import type { Project, TrashedProject } from './types';

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
    render(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[ownedProject]}
        shared={[]}
        onRetry={vi.fn()}
        onOpen={onOpen}
        onManage={onManage}
        onCreate={vi.fn()}
      />,
    );

    // Double-click activates open; the context menu exposes Manage.
    fireEvent.doubleClick(screen.getByRole('row', { name: 'Feature Film' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage…' }));

    expect(onOpen).toHaveBeenCalledWith('project-1');
    expect(onManage).toHaveBeenCalledWith('project-1');
    expect(screen.getByText('Nothing shared with you.')).toBeInTheDocument();
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
    render(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[]}
        shared={[sharedProject]}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={onManage}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Shared Film' }));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Manage…' })).not.toBeInTheDocument();
  });

  it('offers a create action from the empty breakdowns state', () => {
    const onCreate = vi.fn();
    render(
      <ProjectsOverview
        loading={false}
        failed={false}
        owned={[]}
        shared={[]}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onManage={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create a breakdown' }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('keeps trash restore and permanent-delete actions scoped to owners', async () => {
    const project: TrashedProject = {
      ...ownedProject,
      deletedAt: '2026-07-01T00:00:00.000Z',
      purgeAfter: '2026-07-31T00:00:00.000Z',
      canRestore: true,
    };
    const onRestore = vi.fn();
    const onPurge = vi.fn();
    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        projects={[project]}
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={onRestore}
        onPurge={onPurge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Feature Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete permanently…' }));

    expect(onRestore).toHaveBeenCalledWith('project-1');
    expect(onPurge).toHaveBeenCalledWith(project);
    expect(screen.getByText('Breakdown')).toBeInTheDocument();
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
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('No breakdowns match “zzz”.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a breakdown' })).not.toBeInTheDocument();
    cleanup();

    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        projects={[
          {
            ...ownedProject,
            deletedAt: '2026-07-01T00:00:00.000Z',
            purgeAfter: '2026-07-31T00:00:00.000Z',
            canRestore: true,
          },
        ]}
        restoreFailed
        onRetry={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
    );
    expect(
      screen.getByText('The breakdown could not be restored. Please try again.'),
    ).toBeInTheDocument();
    cleanup();

    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        projects={[]}
        query="zzz"
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
      />,
    );
    expect(screen.getByText('No trashed breakdowns match “zzz”.')).toBeInTheDocument();
  });

  it('hides row actions for trashed breakdowns the member cannot restore', () => {
    const project: TrashedProject = {
      ...ownedProject,
      canRestore: false,
      deletedAt: '2026-07-01T00:00:00.000Z',
      purgeAfter: '2026-07-31T00:00:00.000Z',
    };
    render(
      <ProjectsTrash
        loading={false}
        failed={false}
        projects={[project]}
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
