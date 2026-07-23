// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataOperationsSection, useDataOperationsController } from './DataOperationsSection';
import { EntityManagement } from './EntityManagementView';
import { useOverviewController } from './OverviewSection';
import { OverviewSection } from './OverviewView';
import { RoleEditor } from './RoleEditor';
import type { ManagedFieldDefinition, ManagedProject, ManagedRole } from './types';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ api: apiMock }));

const fields: ManagedFieldDefinition[] = [
  {
    id: 'field-status',
    entityTypeId: 'shots',
    name: 'Status',
    key: 'status',
    type: 'enum',
    required: true,
    version: 2,
    options: [{ id: 'ready', label: 'Ready' }],
  },
  {
    id: 'field-notes',
    entityTypeId: 'shots',
    name: 'Notes',
    key: 'notes',
    type: 'long_text',
    required: false,
    version: 1,
    options: [],
  },
];

const editorRole: ManagedRole = {
  id: 'editor',
  name: 'Editor',
  description: 'Can edit',
  version: 3,
  permissions: [{ permission: 'read_project' }],
  _count: { memberships: 0 },
};

const project: ManagedProject = {
  id: 'project',
  name: 'Feature Film',
  description: 'Production',
  ownerUserId: 'owner',
  version: 4,
  entityTypes: [
    {
      id: 'shots',
      singularName: 'Shot',
      pluralName: 'Shots',
      displayPrefix: 'SH',
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
    editorRole,
  ],
  memberships: [
    {
      id: 'owner-membership',
      version: 1,
      user: { id: 'owner', displayName: 'Owner', email: 'owner@example.com' },
      role: { id: 'owner-role', name: 'Owner', isOwner: true },
    },
    {
      id: 'member-membership',
      version: 2,
      user: { id: 'member', displayName: 'Member', email: 'member@example.com' },
      role: editorRole,
    },
  ],
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function installDefaultApi() {
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/entity-types/shots/fields')) return fields;
    if (path.endsWith('/available-users')) {
      return [{ id: 'candidate', displayName: 'Candidate', email: 'candidate@example.com' }];
    }
    if (path.endsWith('/entity-types') && init?.method === 'POST') {
      return {
        id: 'sequences',
        singularName: 'Sequence',
        pluralName: 'Sequences',
        level: 2,
        version: 1,
      };
    }
    if (path === '/api/v1/projects/import') {
      return {
        project: { id: 'imported', name: 'Imported Film' },
        counts: { entityTypes: 1, fields: 2, options: 1, items: 3, values: 4 },
        warnings: ['Source files were skipped.'],
      };
    }
    return {};
  });
}

function OverviewHarness({
  permissions,
}: {
  permissions: Parameters<typeof useOverviewController>[0]['permissions'];
}) {
  const controller = useOverviewController({ projectId: project.id, project, permissions });
  return <OverviewSection controller={controller} />;
}

function DataHarness({
  canDeleteProject = true,
  isOwner = true,
  onDeleted = vi.fn(),
}: {
  canDeleteProject?: boolean;
  isOwner?: boolean;
  onDeleted?: () => void;
}) {
  const controller = useDataOperationsController({
    projectId: project.id,
    project,
    canDeleteProject,
    isOwner,
    onDeleted,
  });
  return <DataOperationsSection controller={controller} />;
}

beforeEach(() => {
  apiMock.mockReset();
  installDefaultApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('entity management behavior', () => {
  it('renames and creates hierarchy levels, reorders fields, and deletes fields after confirmation', async () => {
    const client = makeClient();
    const selectLevel = vi.fn();
    render(
      <EntityManagement
        projectId={project.id}
        entityTypes={project.entityTypes}
        selectedId="shots"
        onSelectId={selectLevel}
        canManageEntities
        canManageFields
      />,
      { wrapper: wrapper(client) },
    );

    expect(await screen.findByText('Status')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Singular name'), { target: { value: 'Scene' } });
    fireEvent.change(screen.getByLabelText('Display prefix'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/entity-types/shots', {
        method: 'PATCH',
        body: JSON.stringify({
          singularName: 'Scene',
          pluralName: 'Shots',
          displayPrefix: null,
          version: 2,
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const addForm = screen.getByText('Level 2').closest('form');
    expect(addForm).not.toBeNull();
    fireEvent.change(within(addForm!).getByLabelText('Singular name'), {
      target: { value: 'Sequence' },
    });
    fireEvent.change(within(addForm!).getByLabelText('Plural name'), {
      target: { value: 'Sequences' },
    });
    fireEvent.click(within(addForm!).getByRole('button', { name: 'Add level' }));
    await waitFor(() => expect(selectLevel).toHaveBeenCalledWith('sequences'));

    fireEvent.click(screen.getByRole('button', { name: 'Move Status down' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/fields/field-status/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ beforeId: null, afterId: 'field-notes', version: 2 }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/fields/field-notes/trash', {
        method: 'DELETE',
        body: JSON.stringify({ version: 1 }),
      }),
    );
    client.clear();
  });

  it('hides creation controls and disables edits without management permissions', async () => {
    const client = makeClient();
    render(
      <EntityManagement
        projectId={project.id}
        entityTypes={project.entityTypes}
        selectedId="shots"
        onSelectId={vi.fn()}
        canManageEntities={false}
        canManageFields={false}
      />,
      { wrapper: wrapper(client) },
    );

    expect(await screen.findByText('Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add level' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add field' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Status' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Status' })).toBeDisabled();
    expect(screen.getByLabelText('Singular name')).toBeDisabled();
    client.clear();
  });
});

describe('overview and roles behavior', () => {
  const permissions = [
    'read_project',
    'manage_items',
    'manage_project_settings',
    'invite_members',
    'manage_member_roles',
    'manage_roles',
  ] as const;

  it('updates project details, creates roles, and confirms member and role removal', async () => {
    const client = makeClient();
    render(<OverviewHarness permissions={[...permissions]} />, { wrapper: wrapper(client) });

    expect(await screen.findByText('Candidate — candidate@example.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Film Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Film Name', description: 'Production', version: 4 }),
      }),
    );

    const createSummary = screen
      .getAllByText('Create role')
      .find((element) => element.tagName === 'SUMMARY')!;
    const createDetails = createSummary.closest('details')!;
    fireEvent.click(createSummary);
    fireEvent.change(within(createDetails).getByLabelText('Role name'), {
      target: { value: 'Reviewer' },
    });
    fireEvent.click(within(createDetails).getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Reviewer',
          description: null,
          permissions: ['read_project'],
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Member from breakdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/projects/project/memberships/member-membership',
        {
          method: 'DELETE',
          body: JSON.stringify({ version: 2 }),
        },
      ),
    );

    const editorDetails = screen
      .getAllByText('Editor')
      .find((element) => element.tagName === 'STRONG')!
      .closest('details')!;
    fireEvent.click(within(editorDetails).getByText('Editor'));
    fireEvent.click(within(editorDetails).getByRole('button', { name: 'Archive role…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive role' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/roles/editor', {
        method: 'DELETE',
        body: JSON.stringify({ version: 3 }),
      }),
    );
    client.clear();
  });

  it('updates only permissions the actor can grant and protects stronger roles', async () => {
    const client = makeClient();
    const archive = vi.fn();
    const { rerender } = render(
      <RoleEditor
        projectId="project"
        role={editorRole}
        canManage
        actorPermissions={['read_project', 'manage_items']}
        onRequestArchive={archive}
      />,
      { wrapper: wrapper(client) },
    );
    fireEvent.click(screen.getByText('Editor'));
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Lead Editor' } });
    fireEvent.click(screen.getByLabelText('Manage items'));
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/roles/editor', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Lead Editor',
          description: 'Can edit',
          permissions: ['read_project', 'manage_items'],
          version: 3,
        }),
      }),
    );

    rerender(
      <RoleEditor
        projectId="project"
        role={{ ...editorRole, permissions: [{ permission: 'delete_project' }] }}
        canManage
        actorPermissions={['read_project']}
        onRequestArchive={archive}
      />,
    );
    fireEvent.click(screen.getByText('Editor'));
    expect(
      screen.getByText(/holds permissions you do not have, so its permission set is read-only/),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Permissions' })).toBeDisabled();
    client.clear();
  });
});

describe('data operations behavior', () => {
  it('rejects oversized imports, imports valid JSON, and confirms project deletion', async () => {
    const client = makeClient();
    const onDeleted = vi.fn();
    const { container } = render(<DataHarness onDeleted={onDeleted} />, {
      wrapper: wrapper(client),
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const oversized = new File(['{}'], 'oversized.json', { type: 'application/json' });
    Object.defineProperty(oversized, 'size', { value: 25 * 1024 * 1024 + 1 });
    fireEvent.change(input!, { target: { files: [oversized] } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Breakdown import exceeds the 25 MB limit.',
    );
    expect(screen.getByRole('button', { name: 'Create breakdown' })).toBeDisabled();

    const valid = new File(['{"schemaVersion":1}'], 'project.json', {
      type: 'application/json',
    });
    fireEvent.change(input!, { target: { files: [valid] } });
    fireEvent.click(screen.getByRole('button', { name: 'Create breakdown' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported Film was created.');
    expect(screen.getByRole('status')).toHaveTextContent('Source files were skipped.');
    expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.coda.project+json' },
      body: '{"schemaVersion":1}',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move to trash…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/api/v1/projects/project/trash', { method: 'DELETE' });
    client.clear();
  });

  it('explains and enforces owner-only deletion', () => {
    const client = makeClient();
    render(<DataHarness canDeleteProject isOwner={false} />, { wrapper: wrapper(client) });
    expect(screen.getByRole('button', { name: 'Move to trash…' })).toBeDisabled();
    expect(
      screen.getByText('Only the breakdown owner can delete this breakdown.'),
    ).toBeInTheDocument();
    client.clear();
  });
});
