// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  function renderScreen() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <ProjectManagementScreen projectId={project.id} />
      </QueryClientProvider>,
    );
  }

  it('composes the structure and data sections, and opens details in a dialog', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Breakdown settings' })).toBeTruthy();
    // Entities is the landing section now: breakdown information reads in the breakdowns-list
    // inspector and is edited in a dialog, so it is no longer a section of this surface (#169).
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Shots', level: 1 })).toBeTruthy();
    expect(await screen.findByText('No custom fields yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Details…' }));
    const details = await screen.findByRole('dialog', { name: 'Breakdown details' });
    expect(details).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    // The danger section retired with #176; what is left is import and export, under Data.
    expect(screen.queryByRole('button', { name: 'Danger' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByRole('heading', { name: 'Data operations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Breakdown JSON' })).toHaveAttribute(
      'href',
      `/api/v1/projects/${project.id}/exports/project.json`,
    );
  });

  /*
   * The structure surface is a page, but it is still *inside* the breakdown, so it raises the share
   * modal over itself rather than navigating anywhere — the same contract the editors have (#176).
   * On arrival there is no dialog at all, which is the defect this issue was opened for.
   */
  it('raises the share modal over itself, and presents none on arrival', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Breakdown settings' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    const share = await screen.findByRole('dialog', { name: project.name });
    expect(share).toHaveAttribute('aria-modal', 'true');
    expect(within(share).getByRole('heading', { name: 'Members' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: project.name })).toBeNull();
    // Dismissing it leaves the surface exactly where it was; sharing never navigated.
    expect(screen.getByRole('heading', { name: 'Breakdown settings' })).toBeTruthy();
  });
});
