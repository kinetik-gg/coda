// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspacePanel } from '@coda/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { EntityTableHeaderControls } from './EntityTableHeaderControls';
import { InspectorHeaderControls, inspectorMatchesSearch } from './InspectorPanel';
import type { Project } from './types';

vi.mock('../../api', () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);

const project: Project = {
  id: 'project',
  name: 'Project',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [{ id: 'scene', singularName: 'Scene', pluralName: 'Scenes', level: 1, version: 1 }],
  roles: [],
  sourceDocuments: [],
  memberships: [],
};
const entityPanel = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'entity_table' as const,
  configVersion: 1 as const,
  config: {
    entityTypeId: 'scene',
    search: '',
    sort: 'manual' as const,
    direction: 'asc' as const,
    filters: [],
    hiddenColumns: [],
    visibleCustomFieldIds: [],
    columnWidths: {},
  },
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(cleanup);
beforeEach(() => {
  vi.useRealTimers();
  mockedApi.mockReset();
  mockedApi.mockResolvedValue([
    {
      id: 'field',
      name: 'Status',
      key: 'status',
      type: 'TEXT',
      required: false,
      version: 1,
      options: [],
    },
  ]);
});

describe('workspace panel header controls', () => {
  it('debounces entity search and toggles built-in and custom columns', async () => {
    const onPanelChange = vi.fn<(panel: WorkspacePanel) => void>();
    render(
      <EntityTableHeaderControls
        project={project}
        projectId="project"
        panel={entityPanel}
        onPanelChange={onPanelChange}
      />,
      { wrapper },
    );
    await waitFor(() => expect(mockedApi).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Search Scenes' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Scenes' }), {
      target: { value: 'opening' },
    });
    await waitFor(() =>
      expect(
        onPanelChange.mock.calls.some(
          ([changed]) => changed.type === 'entity_table' && changed.config.search === 'opening',
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'CODE' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }));
    expect(
      onPanelChange.mock.calls.some(
        ([changed]) =>
          changed.type === 'entity_table' && changed.config.hiddenColumns.includes('code'),
      ),
    ).toBe(true);
    expect(
      onPanelChange.mock.calls.some(
        ([changed]) =>
          changed.type === 'entity_table' && changed.config.visibleCustomFieldIds.includes('field'),
      ),
    ).toBe(true);
  });

  it('closes empty entity search and clears inspector search with Escape', async () => {
    const onPanelChange = vi.fn<(panel: WorkspacePanel) => void>();
    render(
      <EntityTableHeaderControls
        project={project}
        projectId="project"
        panel={entityPanel}
        onPanelChange={onPanelChange}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search Scenes' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Search Scenes' }));
    expect(screen.getByRole('button', { name: 'Search Scenes' })).toBeTruthy();
    cleanup();

    const inspector = {
      id: '30000000-0000-4000-8000-000000000002',
      type: 'inspector' as const,
      configVersion: 1 as const,
      config: { section: 'details' as const, search: 'old' },
    };
    render(<InspectorHeaderControls panel={inspector} onPanelChange={onPanelChange} />);
    const search = screen.getByRole('textbox', { name: 'Search Inspector keys and values' });
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() =>
      expect(
        onPanelChange.mock.calls.some(
          ([changed]) => changed.type === 'inspector' && changed.config.search === '',
        ),
      ).toBe(true),
    );
    expect(inspectorMatchesSearch(' OPEN ', 'Title', 'Opening scene')).toBe(true);
    expect(inspectorMatchesSearch('missing', 'Title', 'Opening scene')).toBe(false);
    expect(inspectorMatchesSearch('', '', '')).toBe(true);
  });

  it('does not render inspector tools outside details', () => {
    const { container } = render(
      <InspectorHeaderControls
        panel={{
          id: '30000000-0000-4000-8000-000000000002',
          type: 'inspector',
          configVersion: 1,
          config: { section: 'comments', search: '' },
        }}
        onPanelChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
