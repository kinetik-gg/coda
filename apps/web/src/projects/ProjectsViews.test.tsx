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
  it('preserves open and management actions for project rows', () => {
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
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Feature Film/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(onOpen).toHaveBeenCalledWith('project-1');
    expect(onManage).toHaveBeenCalledWith('project-1');
    expect(screen.getByText('Nothing shared with you')).toBeInTheDocument();
  });

  it('keeps trash restore and permanent-delete actions scoped to owners', () => {
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
        restoringProjectId="project-1"
        mutationPending={false}
        restoreFailed={false}
        onRetry={vi.fn()}
        onRestore={onRestore}
        onPurge={onPurge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restoring…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently…' }));

    expect(onRestore).toHaveBeenCalledWith('project-1');
    expect(onPurge).toHaveBeenCalledWith(project);
  });
});
