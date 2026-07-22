// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManagementScreen } from './ProjectManagementScreen';
import type { ManagedProject } from './project-management/types';

const project: ManagedProject = {
  id: 'project-1',
  name: 'Feature Film',
  description: 'Production tracking',
  ownerUserId: 'user-1',
  version: 3,
  entityTypes: [
    {
      id: 'entity-1',
      singularName: 'Shot',
      pluralName: 'Shots',
      level: 1,
      version: 2,
      _count: { items: 0 },
    },
  ],
  roles: [
    {
      id: 'owner-role',
      name: 'Owner',
      isOwner: true,
      permissions: [{ permission: 'read_project' }],
      _count: { memberships: 1 },
    },
  ],
  memberships: [
    {
      id: 'membership-1',
      version: 1,
      user: { id: 'user-1', displayName: 'Owner User', email: 'owner@example.com' },
      role: { id: 'owner-role', name: 'Owner', isOwner: true },
    },
  ],
  currentMembership: {
    id: 'membership-1',
    roleId: 'owner-role',
    permissions: [
      'read_project',
      'manage_project_settings',
      'manage_entity_types',
      'manage_fields',
      'delete_project',
    ],
  },
};

function response<T>(data: T) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('ProjectManagementScreen', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path.endsWith('/management')) return response(project);
        if (path.endsWith('/fields')) return response([]);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('composes all management sections and preserves overview drafts while navigating', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectManagementScreen projectId={project.id} onBack={vi.fn()} onDeleted={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Breakdown settings' })).toBeTruthy();
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Working title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Entities' }));
    expect(await screen.findByRole('heading', { name: 'Shots', level: 1 })).toBeTruthy();
    expect(await screen.findByText('No custom fields yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Working title');

    fireEvent.click(screen.getByRole('button', { name: 'Danger' }));
    expect(screen.getByRole('heading', { name: 'Data operations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Breakdown JSON' })).toHaveAttribute(
      'href',
      `/api/v1/projects/${project.id}/exports/project.json`,
    );
  });
});
