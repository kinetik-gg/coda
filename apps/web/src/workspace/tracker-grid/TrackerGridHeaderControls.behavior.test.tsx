// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackerField } from '../../trackers/types';
import { freshGridConfig, type GridPanel } from '../tracker-model';
import { TrackerGridHeaderControls } from './TrackerGridHeaderControls';

afterEach(cleanup);

function field(id: string, label: string): TrackerField {
  return { id, name: label, key: id, type: 'text', required: false, version: 1, options: [] };
}

function panelWith(overrides?: Partial<GridPanel['config']>): GridPanel {
  return {
    id: 'p1',
    type: 'grid',
    configVersion: 1,
    config: { ...freshGridConfig(), ...overrides },
  };
}

describe('TrackerGridHeaderControls', () => {
  it('opens the search box and debounces input into a config change', async () => {
    const onPanelChange = vi.fn();
    render(
      <TrackerGridHeaderControls panel={panelWith()} fields={[]} onPanelChange={onPanelChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search records' }));
    const input = await screen.findByLabelText('Search records by title');
    fireEvent.change(input, { target: { value: 'dock' } });
    await waitFor(
      () =>
        expect(onPanelChange).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            config: expect.objectContaining({ search: 'dock' }),
          }),
        ),
      { timeout: 1500 },
    );
  });

  it('starts open when the persisted search is non-empty', () => {
    render(
      <TrackerGridHeaderControls
        panel={panelWith({ search: 'seeded' })}
        fields={[]}
        onPanelChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Search records by title')).toBeDefined();
  });

  it('toggles built-in columns from the columns menu', () => {
    const onPanelChange = vi.fn();
    render(
      <TrackerGridHeaderControls panel={panelWith()} fields={[]} onPanelChange={onPanelChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /UPDATED/ }));
    expect(onPanelChange).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        config: expect.objectContaining({ hiddenColumns: ['updated'] }),
      }),
    );
  });

  it('hides a custom field through the same menu', () => {
    const fields = [field('f1', 'Status')];
    const onPanelChange = vi.fn();
    render(
      <TrackerGridHeaderControls
        panel={panelWith({ visibleCustomFieldIds: ['f1'] })}
        fields={fields}
        onPanelChange={onPanelChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Status/ }));
    expect(onPanelChange).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        config: expect.objectContaining({ hiddenColumns: ['field:f1'] }),
      }),
    );
  });

  it('exposes a drag handle for every visible custom field', () => {
    const fields = [field('f1', 'Status'), field('f2', 'Owner')];
    render(
      <TrackerGridHeaderControls
        panel={panelWith({ visibleCustomFieldIds: ['f1', 'f2'] })}
        fields={fields}
        onPanelChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('button', { name: 'Reorder Status' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reorder Owner' })).toBeDefined();
  });
});
