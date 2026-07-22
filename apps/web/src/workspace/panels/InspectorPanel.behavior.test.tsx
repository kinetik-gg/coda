// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiCursorPage } from '../../api';
import { InspectorPanel } from './InspectorPanel';
import type { InspectorEditorValue } from './inspector-values';
import type { ActiveEntity, BreakdownItem, FieldDefinition, ItemOperation, Project } from './types';

vi.mock('../../api', () => ({ api: vi.fn(), apiCursorPage: vi.fn() }));
vi.mock('./InspectorInlineValue', () => ({
  InlineValue: ({
    kind = 'text',
    value,
    display,
    onSave,
  }: {
    kind?: string;
    value: InspectorEditorValue;
    display?: ReactNode;
    onSave: (value: InspectorEditorValue) => Promise<void>;
  }) => (
    <button
      data-kind={kind}
      onClick={() =>
        void onSave(
          kind === 'enum'
            ? Array.isArray(value)
              ? ['option']
              : 'parent'
            : kind === 'boolean'
              ? 'true'
              : kind === 'number'
                ? '7'
                : 'Changed',
        )
      }
    >
      inline:{typeof display === 'string' ? display : String(value)}
    </button>
  ),
}));

const mockedApi = vi.mocked(api);
const mockedCursor = vi.mocked(apiCursorPage);
const sceneType = {
  id: 'scene',
  singularName: 'Scene',
  pluralName: 'Scenes',
  level: 1,
  version: 1,
};
const shotType = { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 };
const fields: FieldDefinition[] = [
  {
    id: 'text',
    name: 'Notes',
    key: 'notes',
    type: 'TEXT',
    required: false,
    version: 1,
    options: [],
  },
  {
    id: 'number',
    name: 'Estimate',
    key: 'estimate',
    type: 'INTEGER',
    required: false,
    version: 1,
    options: [],
  },
  {
    id: 'asset',
    name: 'Image',
    key: 'image',
    type: 'IMAGE',
    required: false,
    version: 1,
    options: [],
  },
];
function item(id = 'item'): BreakdownItem {
  return {
    id,
    entityTypeId: 'shot',
    parentId: 'parent',
    title: 'Opening',
    displayCode: 'SH-1',
    description: 'Description',
    version: 1,
    values: [
      {
        fieldId: 'text',
        textValue: 'Old notes',
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        options: [],
      },
    ],
    sourceReferences: [{ id: 'ref', sourceDocumentId: 'document', startPage: 2, endPage: 4 }],
  };
}
const project: Project = {
  id: 'project',
  name: 'Project',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [sceneType, shotType],
  roles: [],
  sourceDocuments: [],
  memberships: [],
};
const activeEntity: ActiveEntity = { entityType: shotType, item: item() };
function inspector(section: 'details' | 'references' | 'comments' | 'activity', search = '') {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    type: 'inspector' as const,
    configVersion: 1 as const,
    config: { section, search },
  };
}
function renderPanel(
  section: 'details' | 'references' | 'comments' | 'activity',
  overrides: Partial<React.ComponentProps<typeof InspectorPanel>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const props = {
    project,
    projectId: 'project',
    currentUserId: 'user',
    panel: inspector(section),
    activeEntity,
    onSelectEntity: vi.fn(),
    onPanelChange: vi.fn(),
    onItemOperation: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <QueryClientProvider client={client}>
        <InspectorPanel {...props} />
      </QueryClientProvider>,
    ),
    props,
  };
}

afterEach(cleanup);
beforeEach(() => {
  mockedApi.mockReset();
  mockedCursor.mockReset();
  mockedCursor.mockResolvedValue({
    items: [
      {
        ...item('parent'),
        entityTypeId: 'scene',
        parentId: null,
        title: 'Scene',
        displayCode: 'SC-1',
      },
    ],
    nextCursor: null,
  });
  mockedApi.mockImplementation((url, options) => {
    const path = String(url);
    if (path.endsWith('/fields')) return Promise.resolve(fields);
    if (path.endsWith('/comments') && options?.method === 'POST') return Promise.resolve(undefined);
    if (path.endsWith('/comments'))
      return Promise.resolve([
        {
          id: 'comment',
          body: 'Looks good',
          createdAt: '2026-01-01T00:00:00Z',
          author: { displayName: 'Ari' },
        },
      ]);
    if (path.endsWith('/activity'))
      return Promise.resolve([
        {
          id: 'one',
          action: 'updated',
          resourceType: 'item',
          resourceId: 'item',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'two',
          action: 'ignored',
          resourceType: 'item',
          resourceId: 'other',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
    if (options?.method === 'PATCH') return Promise.resolve({ version: 2, title: 'Changed' });
    if (options?.method === 'PUT') return Promise.resolve({ version: 3 });
    return Promise.resolve(undefined);
  });
});

describe('inspector panel', () => {
  it('shows empty guidance without an active entity', () => {
    renderPanel('details', { activeEntity: undefined });
    expect(screen.getByText(/Select an entity/)).toBeTruthy();
  });

  it('renders searchable details and registers reversible core and custom edits', async () => {
    const operations: ItemOperation[] = [];
    const { props } = renderPanel('details', {
      onItemOperation: (operation) => operations.push(operation),
    });
    await screen.findByText('inline:Opening');
    expect(screen.getByText('Manage this asset from its source panel.')).toBeTruthy();
    fireEvent.click(screen.getByText('inline:Opening'));
    fireEvent.click(screen.getByText('inline:Old notes'));
    fireEvent.click(screen.getByText('inline:—'));
    await waitFor(() => expect(operations).toHaveLength(3));
    expect(props.onSelectEntity).toHaveBeenCalled();
    const firstOperation = operations[0];
    const secondOperation = operations[1];
    if (!firstOperation || !secondOperation) throw new Error('Expected edit operation fixtures');
    await firstOperation.undo();
    await firstOperation.redo();
    await secondOperation.undo();
    await secondOperation.redo();
    expect(mockedApi.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(
      3,
    );
    expect(mockedApi.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(4);
  });

  it('shows no-match details and source reference states', async () => {
    const { rerender } = renderPanel('details', { panel: inspector('details', 'not-found') });
    await screen.findByText('No matching properties.');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InspectorPanel
          project={project}
          projectId="project"
          currentUserId="user"
          panel={inspector('references')}
          activeEntity={activeEntity}
          onSelectEntity={vi.fn()}
          onPanelChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Pages 2–4')).toBeTruthy();
  });

  it('loads and posts comments while trimming blank submissions', async () => {
    renderPanel('comments');
    await screen.findByText('Looks good');
    const input = screen.getByPlaceholderText('Add a comment');
    fireEvent.change(input, { target: { value: '  New comment  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/projects/project/items/item/comments',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'New comment' }) }),
      ),
    );
    await waitFor(() => expect(input).toHaveProperty('value', ''));
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  });

  it('filters activity to the active item', async () => {
    renderPanel('activity');
    expect(await screen.findByText('updated item')).toBeTruthy();
    expect(screen.queryByText('ignored item')).toBeNull();
  });

  it('renders retry controls for failed details, comments, and activity queries', async () => {
    mockedApi.mockRejectedValue(new Error('offline'));
    mockedCursor.mockRejectedValue(new Error('offline'));
    const details = renderPanel('details');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    details.unmount();
    const comments = renderPanel('comments');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    comments.unmount();
    renderPanel('activity');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  });
});
