// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspacePanel } from '@coda/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelCommandMenu } from './PanelCommandMenu';
import { PanelSelector, entityTypeIcon } from './WorkspacePanelSelector';
import type { Project } from './panels/types';

const project: Project = {
  id: 'project',
  name: 'Feature Film',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [
    { id: 'scene', singularName: 'Scene', pluralName: 'Scenes', level: 1, version: 1 },
    { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 },
    { id: 'element', singularName: 'Element', pluralName: 'Elements', level: 3, version: 1 },
  ],
  roles: [],
  sourceDocuments: [
    {
      id: 'document',
      title: 'Script',
      pageCount: 10,
      storageObject: { id: 'storage', originalFilename: 'script.pdf' },
    },
  ],
  memberships: [],
};

const slot = {
  id: '30000000-0000-4000-8000-000000000001',
  kind: 'panel' as const,
  panel: {
    id: '30000000-0000-4000-8000-000000000002',
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
  },
};

beforeEach(() => {
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: (value: string) => value,
  });
});

afterEach(cleanup);

describe('workspace menus', () => {
  it('executes checked, persistent, disabled, outside-click, and escape command paths', () => {
    const checked = vi.fn();
    const persistent = vi.fn();
    render(
      <PanelCommandMenu
        label="Panel menu"
        items={[
          { label: 'Checked action', checked: true, separatorBefore: true, action: checked },
          { label: 'Persistent action', dismissOnSelect: false, action: persistent },
          { label: 'Unavailable action', disabled: true, action: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Panel menu' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Checked action' }));
    expect(checked).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Persistent action' }));
    expect(persistent).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('switches an entity table among hierarchy and auxiliary panel types', () => {
    const onChange = vi.fn<(panel: WorkspacePanel) => void>();
    const { rerender } = render(
      <PanelSelector slot={slot} project={project} icon="I" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scenes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Shots/ }));
    const selectedShot = onChange.mock.calls.at(-1)?.[0];
    expect(selectedShot?.type).toBe('entity_table');
    expect(selectedShot?.type === 'entity_table' && selectedShot.config.entityTypeId).toBe('shot');

    for (const label of ['Inspector', 'PDF Viewer', 'Activity', 'Trash']) {
      fireEvent.click(screen.getByRole('button', { name: 'Scenes' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
    }
    expect(onChange.mock.calls.map(([panel]) => panel.type)).toEqual([
      'entity_table',
      'inspector',
      'pdf',
      'activity',
      'trash',
    ]);

    rerender(
      <PanelSelector
        slot={{
          ...slot,
          panel: { ...slot.panel, config: { ...slot.panel.config, entityTypeId: null } },
        }}
        project={{ ...project, entityTypes: [], sourceDocuments: [] }}
        icon="I"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Items' })).toBeInTheDocument();
    expect(entityTypeIcon(1)).not.toBe(entityTypeIcon(2));
    expect(entityTypeIcon(2)).not.toBe(entityTypeIcon(3));
  });
});
