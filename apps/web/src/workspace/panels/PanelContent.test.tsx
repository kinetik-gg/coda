// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelContent } from './PanelContent';

vi.mock('./EntityTablePanel', () => ({ EntityTablePanel: () => <span>entity table</span> }));
vi.mock('./InspectorPanel', () => ({ InspectorPanel: () => <span>inspector</span> }));
vi.mock('./PdfPanel', () => ({ PdfPanel: () => <span>pdf</span> }));
vi.mock('./ActivityPanel', () => ({ ActivityPanel: () => <span>activity</span> }));
vi.mock('./TrashPanel', () => ({ TrashPanel: () => <span>trash</span> }));

const base = {
  project: {
    id: 'project',
    name: 'Project',
    description: null,
    ownerUserId: 'owner',
    version: 1,
    revision: 1,
    entityTypes: [],
    roles: [],
    sourceDocuments: [],
    memberships: [],
  },
  projectId: 'project',
  currentUserId: 'user',
  onSelectEntity: vi.fn(),
  onPanelChange: vi.fn(),
};

afterEach(cleanup);

describe('PanelContent', () => {
  it.each([
    ['entity_table', 'entity table'],
    ['inspector', 'inspector'],
    ['pdf', 'pdf'],
    ['activity', 'activity'],
    ['trash', 'trash'],
  ] as const)('dispatches %s panels', (type, label) => {
    const config =
      type === 'entity_table'
        ? {
            entityTypeId: null,
            search: '',
            sort: 'manual' as const,
            direction: 'asc' as const,
            filters: [],
            hiddenColumns: [],
            visibleCustomFieldIds: [],
            columnWidths: {},
          }
        : type === 'inspector'
          ? { section: 'details' as const, search: '' }
          : type === 'pdf'
            ? { sourceDocumentId: null, page: 1, zoom: 1 }
            : { search: '' };
    render(
      <PanelContent
        {...base}
        panel={
          {
            id: '30000000-0000-4000-8000-000000000001',
            type,
            configVersion: 1,
            config,
          } as never
        }
      />,
    );
    expect(screen.getByText(label)).toBeTruthy();
  });
});
