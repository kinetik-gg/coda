// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import {
  Chip,
  DataTable,
  PropertiesEmpty,
  PropertiesField,
  PropertiesFields,
  PropertiesIdentity,
  PropertiesListRow,
  PropertiesNote,
  PropertiesPane,
  PropertiesQuickActions,
  PropertiesSection,
  PropertiesSplit,
  clampPropertiesWidth,
  createDefaultPropertiesLayout,
  readPropertiesLayout,
  usePropertiesLayout,
  useRowSelection,
  writePropertiesLayout,
  PROPERTIES_DEFAULT_WIDTH,
  PROPERTIES_MAX_WIDTH,
  PROPERTIES_MIN_WIDTH,
  PROPERTIES_WIDTH_STEP,
  type ContextMenuItem,
  type DataColumn,
} from './index';

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Bravo' },
  { id: '3', name: 'Charlie' },
];

const columns: DataColumn<Item>[] = [{ key: 'name', header: 'Name', render: (item) => item.name }];

afterEach(cleanup);
beforeEach(() => localStorage.clear());

/**
 * The composition every host uses: a dense table beside the pane, selection
 * driving the pane, geometry persisted per scope. Exercised as one unit so a
 * regression in the seam fails here rather than only in the browser.
 */
function Harness({
  rows = items,
  actions,
  scope = 'test-list',
}: {
  rows?: Item[];
  actions?: ContextMenuItem[];
  scope?: string;
}) {
  const layout = usePropertiesLayout(scope);
  const selection = useRowSelection({ rows, rowKey: (item: Item) => item.id });
  return (
    <PropertiesSplit
      width={layout.width}
      collapsed={layout.collapsed}
      onResize={layout.resizeTo}
      onToggleCollapsed={layout.toggleCollapsed}
      properties={
        <PropertiesPane
          width={layout.width}
          collapsed={layout.collapsed}
          onToggleCollapsed={layout.toggleCollapsed}
        >
          {selection.selected ? (
            <>
              <PropertiesIdentity name={selection.selected.name} meta="item.txt" />
              <PropertiesSection label="Metadata">
                <PropertiesFields>
                  <PropertiesField label="Identity">{selection.selected.id}</PropertiesField>
                  <PropertiesField label="Pages" numeric>
                    12
                  </PropertiesField>
                </PropertiesFields>
              </PropertiesSection>
              <PropertiesSection label="Quick actions">
                <PropertiesQuickActions items={actions ?? []} />
              </PropertiesSection>
            </>
          ) : (
            <PropertiesEmpty message="Select a row." />
          )}
        </PropertiesPane>
      }
    >
      <DataTable
        ariaLabel="Items"
        columns={columns}
        gridTemplate="1fr"
        rows={rows}
        rowKey={(item) => item.id}
        rowLabel={(item) => item.name}
        isSelected={selection.isSelected}
        onSelect={selection.select}
      />
    </PropertiesSplit>
  );
}

describe('properties layout persistence', () => {
  it('clamps widths and falls back to the canonical layout', () => {
    expect(clampPropertiesWidth(10)).toBe(PROPERTIES_MIN_WIDTH);
    expect(clampPropertiesWidth(9_000)).toBe(PROPERTIES_MAX_WIDTH);
    expect(clampPropertiesWidth(Number.NaN)).toBe(PROPERTIES_DEFAULT_WIDTH);
    expect(clampPropertiesWidth(300.4)).toBe(300);
    expect(readPropertiesLayout('unknown')).toEqual(createDefaultPropertiesLayout());
  });

  it('round-trips a stored layout and ignores a corrupt one', () => {
    writePropertiesLayout('scope', { collapsed: true, width: 9_000 });
    expect(readPropertiesLayout('scope')).toEqual({ collapsed: true, width: PROPERTIES_MAX_WIDTH });
    localStorage.setItem('coda:properties-layout:scope', 'not json');
    expect(readPropertiesLayout('scope')).toEqual(createDefaultPropertiesLayout());
    localStorage.setItem('coda:properties-layout:scope', JSON.stringify({ collapsed: 'yes' }));
    expect(readPropertiesLayout('scope')).toEqual(createDefaultPropertiesLayout());
  });

  it('survives unavailable storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPropertiesLayout('scope')).toEqual(createDefaultPropertiesLayout());
    expect(() => writePropertiesLayout('scope', createDefaultPropertiesLayout())).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('persists collapse state and width across a remount', () => {
    const first = render(<Harness scope="persist" />);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize properties' }), {
      key: 'ArrowLeft',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hide properties' }));
    first.unmount();

    render(<Harness scope="persist" />);
    expect(screen.getByRole('button', { name: 'Show properties' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show properties' }));
    expect(screen.getByRole('separator', { name: 'Resize properties' })).toHaveAttribute(
      'aria-valuenow',
      String(PROPERTIES_DEFAULT_WIDTH + PROPERTIES_WIDTH_STEP),
    );
  });
});

describe('PropertiesSplit separator', () => {
  it('resizes by keyboard within the pane bounds and toggles on Enter', () => {
    render(<Harness />);
    const separator = screen.getByRole('separator', { name: 'Resize properties' });
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuemin', String(PROPERTIES_MIN_WIDTH));
    expect(separator).toHaveAttribute('aria-valuemax', String(PROPERTIES_MAX_WIDTH));

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(PROPERTIES_DEFAULT_WIDTH - PROPERTIES_WIDTH_STEP),
    );
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', String(PROPERTIES_MAX_WIDTH));
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', String(PROPERTIES_MIN_WIDTH));
    fireEvent.keyDown(separator, { key: 'Tab' });
    expect(separator).toHaveAttribute('aria-valuenow', String(PROPERTIES_MIN_WIDTH));

    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show properties' })).toBeInTheDocument();
  });

  it('resizes by pointer drag against the frame edge', () => {
    render(<Harness />);
    const separator = screen.getByRole('separator', { name: 'Resize properties' });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      right: 1_000,
    } as DOMRect);
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerMove(separator, { clientX: 600 });
    expect(separator).toHaveAttribute('aria-valuenow', String(PROPERTIES_DEFAULT_WIDTH));

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 700, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 400, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    vi.restoreAllMocks();
  });

  it('ignores a non-primary pointer button', () => {
    render(<Harness />);
    const separator = screen.getByRole('separator', { name: 'Resize properties' });
    const setPointerCapture = vi.fn<(pointerId: number) => void>();
    separator.setPointerCapture = setPointerCapture;
    fireEvent.pointerDown(separator, { button: 2, pointerId: 1 });
    expect(setPointerCapture).not.toHaveBeenCalled();
  });
});

describe('selection drives the pane', () => {
  it('shows the empty state until a row is selected, then follows the keyboard', () => {
    render(<Harness />);
    const pane = screen.getByRole('complementary', { name: 'Properties' });
    expect(pane).toHaveTextContent('Select a row.');

    fireEvent.click(screen.getByRole('row', { name: 'Alpha' }));
    expect(screen.getByRole('heading', { name: 'Alpha', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('row', { name: 'Alpha' }), { key: 'ArrowDown' });
    expect(screen.getByRole('heading', { name: 'Bravo', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Bravo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('row', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
  });

  it('empties the pane when the selected row leaves the list', () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole('row', { name: 'Charlie' }));
    expect(screen.getByRole('heading', { name: 'Charlie', level: 2 })).toBeInTheDocument();
    rerender(<Harness rows={items.slice(0, 2)} />);
    expect(screen.getByRole('complementary', { name: 'Properties' })).toHaveTextContent(
      'Select a row.',
    );
  });

  it('reports each move once', () => {
    const onSelect = vi.fn();
    render(
      <DataTable
        ariaLabel="Items"
        columns={columns}
        gridTemplate="1fr"
        rows={items}
        rowKey={(item) => item.id}
        rowLabel={(item) => item.name}
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('row', { name: 'Alpha' });
    fireEvent.click(row);
    fireEvent.focus(row);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(items[1]);
  });
});

describe('quick actions', () => {
  it('renders the row menu vocabulary verbatim and runs the same handlers', () => {
    const trash = vi.fn();
    const actions: ContextMenuItem[] = [
      { id: 'open', label: 'Open', onSelect: vi.fn() },
      { id: 'trash', label: 'Move to trash', icon: TrashIcon, danger: true, onSelect: trash },
      { id: 'export', label: 'Export', disabled: true, shortcut: '⌘E', onSelect: vi.fn() },
    ];
    render(<Harness actions={actions} />);
    fireEvent.click(screen.getByRole('row', { name: 'Alpha' }));

    const group = screen.getByRole('group', { name: 'Quick actions' });
    expect(
      Array.from(group.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['Open', 'Move to trash', 'Export⌘E']);
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(trash).toHaveBeenCalledOnce();
  });

  it('renders nothing when the subject has no actions', () => {
    render(<Harness actions={[]} />);
    fireEvent.click(screen.getByRole('row', { name: 'Alpha' }));
    expect(screen.queryByRole('group', { name: 'Quick actions' })).not.toBeInTheDocument();
  });
});

describe('pane primitives', () => {
  it('labels sections, fields, rows, and notes', () => {
    const onClick = vi.fn();
    render(
      <PropertiesPane width={280} collapsed={false} busy onToggleCollapsed={vi.fn()}>
        <PropertiesIdentity name="Night Bus" />
        <PropertiesSection label="Members" count={2}>
          <PropertiesListRow leading="*" primary="Olwen Owner" secondary={<Chip>owner</Chip>} />
          <PropertiesListRow primary="Edda Editor" />
        </PropertiesSection>
        <PropertiesNote alert action={{ label: 'Try again', onClick }}>
          It failed.
        </PropertiesNote>
      </PropertiesPane>,
    );
    expect(screen.getByRole('complementary', { name: 'Properties' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Members/, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Olwen Owner')).toBeInTheDocument();
    expect(screen.getByText('Edda Editor')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('It failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps a restore affordance while collapsed', () => {
    render(
      <PropertiesPane width={280} collapsed onToggleCollapsed={vi.fn()}>
        <PropertiesEmpty message="hidden" />
      </PropertiesPane>,
    );
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show properties' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
