// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManagementModal } from './project-management/ProjectManagementModal';
import type { ManagedProject, SectionId } from './project-management/types';

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
  invitations: [],
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

function ManagementHarness({
  initialSection,
  onClose = vi.fn(),
  onSectionChange = vi.fn(),
}: {
  initialSection: SectionId;
  onClose?: () => void;
  onSectionChange?: (section: SectionId) => void;
}) {
  const [section, setSection] = useState(initialSection);
  return (
    <ProjectManagementModal
      projectId={project.id}
      section={section}
      onSectionChange={(nextSection) => {
        onSectionChange(nextSection);
        setSection(nextSection);
      }}
      onClose={onClose}
      onDeleted={vi.fn()}
    />
  );
}

function renderModal(
  initialSection: SectionId,
  options?: { onClose?: () => void; onSectionChange?: (section: SectionId) => void },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManagementHarness initialSection={initialSection} {...options} />
    </QueryClientProvider>,
  );
}

describe('ProjectManagementModal', () => {
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

  it('composes every concern in one large sectioned modal', async () => {
    const onSectionChange = vi.fn();
    renderModal('details', { onSectionChange });

    const dialog = await screen.findByRole('dialog', { name: project.name });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('large');
    expect(
      within(dialog).getByRole('navigation', { name: 'Breakdown management sections' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Details', level: 1 })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Entities & fields' }));
    expect(onSectionChange).toHaveBeenLastCalledWith('structure');
    expect(
      within(dialog).getByRole('heading', { name: 'Entities & fields', level: 1 }),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText('No custom fields yet')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Data operations' }));
    expect(within(dialog).getByRole('heading', { name: 'Data operations', level: 1 })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Breakdown JSON' })).toHaveAttribute(
      'href',
      `/api/v1/projects/${project.id}/exports/project.json`,
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Danger zone' }));
    expect(within(dialog).getByRole('button', { name: 'Move to trash…' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));
    expect(within(dialog).getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Invitations' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'Roles and permissions' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['share', 'Share'],
    ['details', 'Details'],
    ['structure', 'Entities & fields'],
    ['data', 'Data operations'],
    ['danger', 'Danger zone'],
  ] as const)(
    'opens a deep link to %s in the identical active section state',
    async (section, title) => {
      renderModal(section);

      const dialog = await screen.findByRole('dialog', { name: project.name });
      expect(within(dialog).getByRole('button', { name: title })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(dialog).getByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    },
  );

  it('dismisses through the shell and leaves nested confirmations on the shared stack', async () => {
    const onClose = vi.fn();
    renderModal('danger', { onClose });

    const dialog = await screen.findByRole('dialog', { name: project.name });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to trash…' }));
    expect(await screen.findByRole('dialog', { name: 'Move breakdown to trash?' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Move breakdown to trash?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
