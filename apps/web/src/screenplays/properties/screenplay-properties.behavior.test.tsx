// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { allScreenplayPermissions } from '@coda/contracts';
import { DataTable, type ContextMenuItem, type DataColumn } from '../../content-lists';
import type { ManagedScreenplay } from '../management/types';
import type { Screenplay, ScreenplaySummary } from '../types';
import { ScreenplayPropertiesSplit } from './ScreenplayPropertiesSplit';
import {
  resolvePropertiesMembers,
  resolveScreenplayOwnerLabel,
} from './screenplay-properties-access';
import { buildScreenplayPropertiesModel } from './screenplay-properties-model';

const ISO = '2026-07-22T00:00:00.000Z';
const CREATED = '2026-07-01T00:00:00.000Z';

const SOURCE = `Title: Night Bus
Author: A. Writer

INT. BUS - NIGHT

The bus rolls east.

CLARA
We should have walked.

EXT. STOP - LATER

Rain.
`;

/**
 * Beat-compatible embedded revision metadata: two generations of additions and
 * one removal, all inside the declared text length. Fixed values only — the
 * fixture must read the same on every run.
 */
const REVISED_SOURCE = `${SOURCE}
/* BEAT: {"Revision Mode": true, "Revision Level": 2, "Text Length": 4000, "Revision": {"Addition": [[0, 5, 2], [10, 4, 2], [40, 6, 1]], "Removed": [[60, 3, 2]], "RemovalSuggestion": [[80, 2, 1]]}} END_BEAT */
`;

function summary(overrides: Partial<ScreenplaySummary> = {}): ScreenplaySummary {
  return {
    id: 'sp1',
    ownerUserId: 'owner',
    title: 'Night Bus',
    filename: 'night-bus.fountain',
    paperSize: 'a4',
    version: 4,
    createdAt: CREATED,
    updatedAt: ISO,
    ...overrides,
  };
}

function detail(overrides: Partial<Screenplay> = {}): Screenplay {
  return { ...summary(), sourceText: SOURCE, ...overrides };
}

function managed(): ManagedScreenplay {
  return {
    id: 'sp1',
    title: 'Night Bus',
    filename: 'night-bus.fountain',
    ownerUserId: 'owner',
    version: 4,
    createdAt: CREATED,
    updatedAt: ISO,
    roles: [],
    memberships: [
      {
        id: 'm-ed',
        version: 1,
        createdAt: ISO,
        role: { id: 'editor-role', name: 'editor', isOwner: false },
        user: {
          id: 'editor',
          email: 'edda@example.test',
          displayName: 'Edda Editor',
          status: 'ACTIVE',
        },
      },
      {
        id: 'm-owner',
        version: 1,
        createdAt: ISO,
        role: { id: 'owner-role', name: 'owner', isOwner: true },
        user: {
          id: 'owner',
          email: 'olwen@example.test',
          displayName: 'Olwen Owner',
          status: 'ACTIVE',
        },
      },
    ],
    invitations: [],
    currentMembership: {
      id: 'm-owner',
      roleId: 'owner-role',
      permissions: [...allScreenplayPermissions],
    },
  };
}

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function stubFetch({
  screenplay = detail(),
  managementStatus = 200,
  detailStatus = 200,
}: {
  screenplay?: Screenplay;
  managementStatus?: number;
  detailStatus?: number;
} = {}) {
  // Both reads echo the id they were asked for, so a payload can never be
  // mistaken for one belonging to a different selection.
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : input.toString();
    const management = /\/screenplays\/(sp\d+)\/management$/.exec(path);
    if (management) {
      return managementStatus === 200
        ? response({ ...managed(), id: management[1]! })
        : response({ status: managementStatus, title: 'Forbidden' }, managementStatus);
    }
    if (path.endsWith('/auth/session')) {
      return response({ id: 'owner', email: 'olwen@example.test', displayName: 'Olwen Owner' });
    }
    const document = /\/screenplays\/(sp\d+)$/.exec(path);
    if (document) {
      return detailStatus === 200
        ? response({ ...screenplay, id: document[1]! })
        : response({ status: detailStatus, title: 'Boom' }, detailStatus);
    }
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const columns: DataColumn<ScreenplaySummary>[] = [
  { key: 'title', header: 'Title', render: (row) => row.title },
];

function renderList({
  rows = [summary(), summary({ id: 'sp2', title: 'Day Train' })],
  renderPresence,
}: {
  rows?: ScreenplaySummary[];
  renderPresence?: (screenplayId: string) => ReactNode;
} = {}) {
  const onOpen = vi.fn<(row: ScreenplaySummary) => void>();
  const onTrash = vi.fn<(row: ScreenplaySummary) => void>();
  const buildMenu = (row: ScreenplaySummary): ContextMenuItem[] => [
    { id: 'open', label: 'Open', onSelect: () => onOpen(row) },
    { id: 'trash', label: 'Move to trash', danger: true, onSelect: () => onTrash(row) },
  ];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ScreenplayPropertiesSplit rows={rows} buildMenu={buildMenu} renderPresence={renderPresence}>
        {(selection) => (
          <DataTable
            ariaLabel="Screenplays"
            columns={columns}
            gridTemplate="1fr"
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.title}
            buildMenu={buildMenu}
            {...selection}
          />
        )}
      </ScreenplayPropertiesSplit>
    </QueryClientProvider>,
  );
  return { view, onOpen, onTrash, buildMenu };
}

/** Reads a metadata field's value by its label, so assertions never depend on ordering. */
function field(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => localStorage.clear());

describe('buildScreenplayPropertiesModel', () => {
  it('paginates with the real layout engine and reports no revision marks', () => {
    const model = buildScreenplayPropertiesModel(detail());
    expect(model.metrics).toEqual({ pageCount: 2, sceneCount: 2 });
    expect(model.revisionMode).toBe(false);
    expect(model.currentGeneration).toBeUndefined();
    expect(model.revisions).toEqual([]);
  });

  it('groups embedded revision generations newest first', () => {
    const model = buildScreenplayPropertiesModel(detail({ sourceText: REVISED_SOURCE }));
    expect(model.revisionMode).toBe(true);
    expect(model.currentGeneration).toBe(2);
    expect(model.revisions).toEqual([
      { generation: 2, marker: '+', additions: 2, removals: 1 },
      { generation: 1, marker: '**', additions: 1, removals: 1 },
    ]);
  });

  it('skips pagination for a source beyond the measurable limit', () => {
    const model = buildScreenplayPropertiesModel(detail(), { sourceLimit: 4 });
    expect(model.metrics).toBeUndefined();
  });

  it('yields an empty model for a payload with no usable source', () => {
    const partial = { ...summary() } as Screenplay;
    expect(buildScreenplayPropertiesModel(partial)).toEqual({
      revisionMode: false,
      revisions: [],
    });
  });
});

describe('properties access resolution', () => {
  it('orders the owner first and names the owner from the management payload', () => {
    expect(resolvePropertiesMembers(managed()).map((member) => member.name)).toEqual([
      'Olwen Owner',
      'Edda Editor',
    ]);
    expect(
      resolveScreenplayOwnerLabel({
        ownerUserId: 'owner',
        sessionUserId: 'owner',
        management: managed(),
      }),
    ).toBe('Olwen Owner (you)');
    expect(
      resolveScreenplayOwnerLabel({
        ownerUserId: 'owner',
        sessionUserId: 'editor',
        management: managed(),
      }),
    ).toBe('Olwen Owner');
  });

  it('falls back honestly when management is not readable', () => {
    expect(resolvePropertiesMembers()).toEqual([]);
    expect(resolveScreenplayOwnerLabel({ ownerUserId: 'owner', sessionUserId: 'owner' })).toBe(
      'You',
    );
    expect(resolveScreenplayOwnerLabel({ ownerUserId: 'owner', sessionUserId: 'editor' })).toBe(
      'Another member',
    );
  });

  it('names a membership whose user or role has gone', () => {
    const payload = managed();
    payload.memberships = [
      { id: 'm-x', version: 1, createdAt: ISO, role: null, user: null },
      {
        id: 'm-y',
        version: 1,
        createdAt: ISO,
        role: { id: 'r', name: 'viewer', isOwner: false },
        user: { id: 'u', email: 'blank@example.test', displayName: '  ', status: 'ACTIVE' },
      },
    ];
    expect(resolvePropertiesMembers(payload)).toEqual([
      { id: 'm-y', name: 'blank@example.test', role: 'viewer', isOwner: false },
      { id: 'm-x', name: 'Removed user', role: 'No role', isOwner: false },
    ]);
  });
});

describe('select → inspect → act', () => {
  it('starts empty and populates every section from the selected row', async () => {
    stubFetch();
    renderList();
    const pane = screen.getByRole('complementary', { name: 'Properties' });
    expect(pane).toHaveTextContent('Select a screenplay');

    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    expect(screen.getByRole('heading', { name: 'Night Bus', level: 2 })).toBeInTheDocument();

    await waitFor(() => expect(field('Pages')).toBe('2'));
    expect(field('Format')).toBe('a4');
    expect(field('Scenes')).toBe('2');
    expect(field('Revision')).toBe('4');
    expect(field('Owner')).toBe('Olwen Owner (you)');
    expect(screen.getByRole('region', { name: 'Recent revisions' })).toHaveTextContent(
      'no revision marks',
    );
    const members = screen.getByRole('region', { name: 'Members' });
    expect(members).toHaveTextContent('Olwen Owner');
    expect(members).toHaveTextContent('Edda Editor');
    expect(
      Array.from(members.querySelectorAll('[data-user-initials]'), (badge) => badge.textContent),
    ).toEqual(['OO', 'EE']);
  });

  it('runs the same handler the row context menu runs', async () => {
    stubFetch();
    const { onTrash } = renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    await waitFor(() => expect(field('Pages')).toBe('2'));

    const group = screen.getByRole('group', { name: 'Quick actions' });
    expect(
      Array.from(group.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['Open', 'Move to trash']);
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

    fireEvent.contextMenu(screen.getByRole('row', { name: 'Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
    expect(onTrash).toHaveBeenCalledTimes(2);
    expect(onTrash.mock.calls[0]).toEqual(onTrash.mock.calls[1]);
  });

  it('reports the document revision generations it finds', async () => {
    stubFetch({ screenplay: detail({ sourceText: REVISED_SOURCE }) });
    renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    const revisions = await screen.findByRole('region', { name: 'Recent revisions' });
    await waitFor(() => expect(revisions).toHaveTextContent('Generation 3'));
    expect(revisions).toHaveTextContent('+2 −1');
    expect(revisions).toHaveTextContent('Revision marking is on');
  });

  it('marks the pane busy while the document is being read', async () => {
    stubFetch();
    renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    expect(screen.getByRole('complementary', { name: 'Properties' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Recent revisions' })).toHaveTextContent(
      'Reading the document…',
    );
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Properties' })).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    );
  });

  it('keeps collaborators private when sharing cannot be read', async () => {
    stubFetch({ managementStatus: 403 });
    renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Members' })).toHaveTextContent(
        'visible to members who can manage sharing',
      ),
    );
    expect(field('Owner')).toBe('You');
  });

  it('offers a retry when the document read fails', async () => {
    const fetchMock = stubFetch({ detailStatus: 500 });
    renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Document details could not be read.'),
    );
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('renders the presence slot for the selected screenplay', async () => {
    stubFetch();
    renderList({ renderPresence: (id) => <p>{`presence:${id}`}</p> });
    expect(screen.queryByText('presence:sp1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    expect(await screen.findByText('presence:sp1')).toBeInTheDocument();
  });

  it('collapses to the rail and restores across a remount', async () => {
    stubFetch();
    const { view } = renderList();
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    await waitFor(() => expect(field('Pages')).toBe('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Hide properties' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    view.unmount();

    stubFetch();
    renderList();
    expect(screen.getByRole('button', { name: 'Show properties' })).toBeInTheDocument();
  });
});

describe('selection traversal', () => {
  const threeRows = [
    summary(),
    summary({ id: 'sp2', title: 'Day Train' }),
    summary({ id: 'sp3', title: 'Quarry Road' }),
  ];

  it('collapses an arrow-key traversal into a single document read', async () => {
    const fetchMock = stubFetch();
    renderList({ rows: threeRows });

    const first = screen.getByRole('row', { name: 'Night Bus' });
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('row', { name: 'Day Train' }), { key: 'ArrowDown' });

    // The pane follows the keyboard immediately, off the row's own data.
    expect(screen.getByRole('heading', { name: 'Quarry Road', level: 2 })).toBeInTheDocument();

    // Only the row the traversal came to rest on is read: `/api/v1/screenplays` is
    // rate limited per client, so one read per row traversed is not affordable.
    await waitFor(() => expect(field('Pages')).toBe('2'));
    const documentReads = fetchMock.mock.calls
      .map(([input]) => (input instanceof Request ? input.url : input.toString()))
      .filter((path) => /\/screenplays\/sp\d+$/.test(path));
    expect(documentReads).toHaveLength(1);
    expect(documentReads[0]).toContain('sp3');
  });

  it('never paints a read against the wrong selection', async () => {
    stubFetch();
    renderList({ rows: threeRows });
    fireEvent.click(screen.getByRole('row', { name: 'Night Bus' }));
    await waitFor(() => expect(field('Pages')).toBe('2'));

    // Moving on blanks the document-derived figures rather than carrying the
    // previous row's numbers under the new row's title.
    fireEvent.click(screen.getByRole('row', { name: 'Day Train' }));
    expect(screen.getByRole('heading', { name: 'Day Train', level: 2 })).toBeInTheDocument();
    expect(field('Pages')).toBe('—');
    expect(field('Scenes')).toBe('—');
    await waitFor(() => expect(field('Pages')).toBe('2'));
  });
});
