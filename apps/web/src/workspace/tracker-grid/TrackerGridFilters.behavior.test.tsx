// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackerField } from '../../trackers/types';
import { freshGridConfig, type GridPanel } from '../tracker-model';
import { TrackerGridFilters } from './TrackerGridFilters';

afterEach(cleanup);

type FilterList = GridPanel['config']['filters'];

function field(id: string, label: string, type: string): TrackerField {
  return { id, name: label, key: id, type, required: false, version: 1, options: [] };
}

function panelWith(overrides?: Partial<GridPanel['config']>): GridPanel {
  return {
    id: 'p1',
    type: 'grid',
    configVersion: 1,
    config: { ...freshGridConfig(), ...overrides },
  };
}

function renderFilters(panel: GridPanel, fields: TrackerField[]) {
  const onPanelChange = vi.fn();
  render(<TrackerGridFilters panel={panel} fields={fields} onPanelChange={onPanelChange} />);
  return { onPanelChange };
}

const text = field('f1', 'Scene', 'text');
const number = field('f2', 'Take', 'integer');

describe('TrackerGridFilters', () => {
  it('adds a filter chip from the add menu with the default operator', async () => {
    const expected: FilterList = [{ fieldId: 'f1', operator: 'contains', value: '' }];
    const { onPanelChange } = renderFilters(panelWith(), [text]);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Scene' }));
    await waitFor(() =>
      expect(onPanelChange).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          config: expect.objectContaining({ filters: expected }),
        }),
      ),
    );
  });

  it('renders chips for existing filters and removes them', () => {
    const filters: FilterList = [{ fieldId: 'f1', operator: 'equals', value: 'INT' }];
    const { onPanelChange } = renderFilters(panelWith({ filters }), [text, number]);
    expect(screen.getByText('Scene')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Scene filter' }));
    expect(onPanelChange).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ config: expect.objectContaining({ filters: [] }) }),
    );
  });

  it('edits a filter value through the per-type input', () => {
    const initial: FilterList = [{ fieldId: 'f2', operator: 'equals', value: '' }];
    const expected: FilterList = [{ fieldId: 'f2', operator: 'equals', value: 7 }];
    const { onPanelChange } = renderFilters(panelWith({ filters: initial }), [text, number]);
    fireEvent.change(screen.getByLabelText('Value for Take'), { target: { value: '7' } });
    expect(onPanelChange).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        config: expect.objectContaining({ filters: expected }),
      }),
    );
  });

  it('omits the value input for operators that need none', () => {
    const filters: FilterList = [{ fieldId: 'f1', operator: 'is_empty', value: '' }];
    renderFilters(panelWith({ filters }), [text, number]);
    expect(screen.queryByLabelText(/Scene value/)).toBeNull();
  });

  it('offers only fields that are not already filtered', async () => {
    const filters: FilterList = [{ fieldId: 'f1', operator: 'contains', value: 'x' }];
    renderFilters(panelWith({ filters }), [text, number]);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('Take');
    expect(menu.textContent).not.toContain('Scene');
  });
});
