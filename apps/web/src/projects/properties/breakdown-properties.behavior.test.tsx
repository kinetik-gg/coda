// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type ContextMenuItem, type DataColumn } from '../../content-lists';
import type { ManagedProject } from '../../project-management/types';
import type { Project } from '../types';
import { BreakdownPropertiesSplit } from './BreakdownPropertiesSplit';
import { resolveBreakdownMembers, resolveBreakdownOwnerLabel } from './breakdown-properties-access';
import { buildBreakdownPropertiesModel } from './breakdown-properties-model';

const ISO = '2026-07-22T00:00:00.000Z';

function row(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'The Quiet Signal',
    description: 'Feature breakdown',
    ownerUserId: 'owner',
    updatedAt: ISO,
    currentMembership: {
      id: 'm-owner',
      role: { id: 'owner-role', name: 'owner', permissions: [] },
    },
    ...overrides,
  };
}

function managed(overrides: Partial<ManagedProject> = {}): ManagedProject {
  return {
    id: 'p1',
    name: 'The Quiet Signal',
    description: 'Feature breakdown',
    ownerUserId: 'owner',
    version: 3,
    entityTypes: [
      {
        id: 'shots',
        singularName: 'Shot',
        pluralName: 'Shots',
        level: 3,
        version: 1,
        _count: { items: 42 },
      },
      {
        id: 'sequences',
        singularName: 'Sequence',
        pluralName: 'Sequences',
        level: 1,
        version: 1,
        _count: { items: 4 },
      },
    ],
    roles: [
      { id: 'owner-role', name: 'owner' },
      { id: 'editor-role', name: 'editor' },
    ],
    memberships: [
      {
        id: 'm-ed',
        version: 1,
        user: { id: 'u2', displayName: 'Edda Editor', email: 'edda@example.test' },
        role: { id: 'editor-role', name: 'editor' },
      },
      {
        id: 'm-owner',
        version: 1,
        user: { id: 'owner', displayName: 'Olwen Owner', email: 'owner@example.test' },
        role: { id: 'owner-role', name: 'owner' },
      },
    ],
    currentMembership: { id: 'm-owner', roleId: 'owner-role', permissions: [] },
    _count: { items: 46, sourceDocuments: 2, storageObjects: 5 },
    ...overrides,
  };
}

function envelope(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function stubFetch(management: (id: string) => unknown = () => managed()) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : input.toString();
    if (path === '/api/v1/auth/session') {
      return envelope({ id: 'owner', displayName: 'Olwen Owner', email: 'owner@example.test' });
    }
    const match = /\/api\/v1\/projects\/([^/]+)\/management$/.exec(path);
    if (match) {
      const payload = management(match[1]!);
      return payload === undefined ? envelope({ title: 'Forbidden' }, 403) : envelope(payload);
    }
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const columns: DataColumn<Project>[] = [
  { key: 'name', header: 'Name', render: (project) => project.name },
];

function renderList({ rows = [row()] }: { rows?: Project[] } = {}) {
  const onOpen = vi.fn<(project: Project) => void>();
  const buildMenu = (project: Project): ContextMenuItem[] => [
    { id: 'open', label: 'Open', onSelect: () => onOpen(project) },
    { id: 'details', label: 'Details…', onSelect: () => undefined },
  ];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <BreakdownPropertiesSplit rows={rows} buildMenu={buildMenu}>
        {(selection) => (
          <DataTable
            ariaLabel="Breakdowns"
            columns={columns}
            gridTemplate="1fr"
            rows={rows}
            rowKey={(project) => project.id}
            rowLabel={(project) => project.name}
            buildMenu={buildMenu}
            {...selection}
          />
        )}
      </BreakdownPropertiesSplit>
    </QueryClientProvider>,
  );
  return { view, onOpen };
}

function field(label: string): string | undefined {
  const pane = screen.getByRole('complementary', { name: 'Properties' });
  return pane.querySelector(`dt:not([hidden])`)
    ? Array.from(pane.querySelectorAll('dt'))
        .find((term) => term.textContent === label)
        ?.nextElementSibling?.textContent?.trim()
    : undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('breakdown properties model and access', () => {
  it('orders levels shallowest first and carries their counts', () => {
    const model = buildBreakdownPropertiesModel(managed());
    expect(model.levels.map((level) => level.name)).toEqual(['Sequences', 'Shots']);
    expect(model.levels.map((level) => level.itemCount)).toEqual([4, 42]);
    expect(model.itemCount).toBe(46);
    expect(model.sourceDocumentCount).toBe(2);
    expect(model.roleCount).toBe(2);
  });

  it('puts the owner first, then alphabetical, and names the owner honestly', () => {
    const members = resolveBreakdownMembers(managed());
    expect(members.map((member) => member.name)).toEqual(['Olwen Owner', 'Edda Editor']);
    expect(members[0]!.isOwner).toBe(true);

    expect(
      resolveBreakdownOwnerLabel({
        ownerUserId: 'owner',
        sessionUserId: 'owner',
        management: managed(),
      }),
    ).toBe('Olwen Owner (you)');
    // Without the permission-gated payload the pane never leaks an identifier.
    expect(resolveBreakdownOwnerLabel({ ownerUserId: 'owner', sessionUserId: 'owner' })).toBe(
      'You',
    );
    expect(resolveBreakdownOwnerLabel({ ownerUserId: 'owner', sessionUserId: 'u2' })).toBe(
      'Another member',
    );
  });
});

describe('breakdown select → inspect → act', () => {
  it('is absent until a row is selected, then populates every section from it', async () => {
    stubFetch();
    renderList();
    // #193: with no subject the pane does not render at all.
    expect(screen.queryByRole('complementary', { name: 'Properties' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('row', { name: 'The Quiet Signal' }));
    // The pane follows the selection immediately, off the row's own data.
    expect(screen.getByRole('heading', { name: 'The Quiet Signal', level: 2 })).toBeInTheDocument();

    await waitFor(() => expect(field('Levels')).toBe('2'));
    expect(field('Items')).toBe('46');
    expect(field('Sources')).toBe('2');
    expect(field('Roles')).toBe('2');
    expect(field('Owner')).toBe('Olwen Owner (you)');

    const hierarchy = screen.getByRole('region', { name: 'Hierarchy' });
    expect(hierarchy).toHaveTextContent('Sequences');
    expect(hierarchy).toHaveTextContent('Shots');
    const members = screen.getByRole('region', { name: 'Members' });
    expect(members).toHaveTextContent('Olwen Owner');
    expect(members).toHaveTextContent('Edda Editor');
    expect(
      Array.from(members.querySelectorAll('[data-user-initials]'), (badge) => badge.textContent),
    ).toEqual(['OO', 'EE']);
  });

  it('offers the row menu verbatim as quick actions', async () => {
    stubFetch();
    const { onOpen } = renderList();
    fireEvent.click(screen.getByRole('row', { name: 'The Quiet Signal' }));

    const actions = screen.getByRole('group', { name: 'Quick actions' });
    expect(actions.querySelectorAll('button')).toHaveLength(2);
    await waitFor(() => expect(field('Levels')).toBe('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('states the permission caveat rather than failing when management is forbidden', async () => {
    stubFetch(() => undefined);
    renderList();
    fireEvent.click(screen.getByRole('row', { name: 'The Quiet Signal' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Members' })).toHaveTextContent(
        'members who can manage sharing',
      ),
    );
    expect(screen.getByRole('region', { name: 'Hierarchy' })).toHaveTextContent(
      'needs breakdown management access',
    );
    // The row's own data still renders; only the gated read is withheld.
    expect(screen.getByRole('heading', { name: 'The Quiet Signal', level: 2 })).toBeInTheDocument();
  });
});

describe('breakdown selection traversal', () => {
  const threeRows = [
    row(),
    row({ id: 'p2', name: 'Day Train' }),
    row({ id: 'p3', name: 'Quarry Road' }),
  ];

  /**
   * The discipline #164 established for screenplays, asserted for breakdowns: holding ArrowDown
   * walks every row in between, and none of them is a request worth making.
   */
  it('collapses an arrow-key traversal into a single management read', async () => {
    const fetchMock = stubFetch((id) => managed({ id, name: `Breakdown ${id}` }));
    renderList({ rows: threeRows });

    const first = screen.getByRole('row', { name: 'The Quiet Signal' });
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('row', { name: 'Day Train' }), { key: 'ArrowDown' });

    // The pane follows the keyboard immediately, off the row's own data.
    expect(screen.getByRole('heading', { name: 'Quarry Road', level: 2 })).toBeInTheDocument();

    await waitFor(() => expect(field('Levels')).toBe('2'));
    const managementReads = fetchMock.mock.calls
      .map(([input]) => (input instanceof Request ? input.url : input.toString()))
      .filter((path) => /\/projects\/p\d+\/management$/.test(path));
    expect(managementReads).toHaveLength(1);
    expect(managementReads[0]).toContain('p3');
  });

  it('never paints a read against the wrong selection', async () => {
    stubFetch((id) => managed({ id, name: `Breakdown ${id}` }));
    renderList({ rows: threeRows });
    fireEvent.click(screen.getByRole('row', { name: 'The Quiet Signal' }));
    await waitFor(() => expect(field('Levels')).toBe('2'));

    // Moving on blanks the read-derived figures rather than carrying the previous row's numbers
    // under the new row's name.
    fireEvent.click(screen.getByRole('row', { name: 'Day Train' }));
    expect(screen.getByRole('heading', { name: 'Day Train', level: 2 })).toBeInTheDocument();
    expect(field('Levels')).toBe('—');
    expect(field('Items')).toBe('—');
    await waitFor(() => expect(field('Levels')).toBe('2'));
  });

  it('removes the pane when the selected row leaves the list', async () => {
    stubFetch();
    const { view } = renderList({ rows: [row(), row({ id: 'p2', name: 'Day Train' })] });
    fireEvent.click(screen.getByRole('row', { name: 'The Quiet Signal' }));
    await waitFor(() => expect(field('Levels')).toBe('2'));

    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BreakdownPropertiesSplit
          rows={[row({ id: 'p2', name: 'Day Train' })]}
          buildMenu={() => []}
        >
          {(selection) => (
            <DataTable
              ariaLabel="Breakdowns"
              columns={columns}
              gridTemplate="1fr"
              rows={[row({ id: 'p2', name: 'Day Train' })]}
              rowKey={(project) => project.id}
              rowLabel={(project) => project.name}
              buildMenu={() => []}
              {...selection}
            />
          )}
        </BreakdownPropertiesSplit>
      </QueryClientProvider>,
    );
    // The subject is gone, so the pane goes with it rather than reverting to a placeholder (#193).
    expect(screen.queryByRole('complementary', { name: 'Properties' })).not.toBeInTheDocument();
  });
});
