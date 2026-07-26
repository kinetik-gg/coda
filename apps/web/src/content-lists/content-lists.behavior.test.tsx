// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import {
  CellIcon,
  Chip,
  ContentListPage,
  DataTable,
  HeaderButton,
  InlineError,
  LibraryHeader,
  PrimaryText,
  RowStatus,
  ScrollBody,
  SectionLabel,
  StateBlock,
  TimeCell,
  absoluteTime,
  relativeTime,
  type ContextMenuItem,
  type DataColumn,
} from './index';

afterEach(cleanup);

interface Item {
  id: string;
  name: string;
  updatedAt: string;
}

const items: Item[] = [
  { id: '1', name: 'Alpha', updatedAt: '2026-07-20T00:00:00.000Z' },
  { id: '2', name: 'Bravo', updatedAt: '2026-07-21T00:00:00.000Z' },
  { id: '3', name: 'Charlie', updatedAt: '2026-07-22T00:00:00.000Z' },
];

const columns: DataColumn<Item>[] = [
  { key: 'icon', header: '', render: () => <CellIcon icon={BookOpenTextIcon} /> },
  {
    key: 'name',
    header: 'Name',
    render: (item) => <PrimaryText name={item.name} subtitle="sub" />,
  },
  {
    key: 'updated',
    header: 'Updated',
    numeric: true,
    render: (item) => <TimeCell iso={item.updatedAt} />,
  },
];

function renderTable(overrides: { buildMenu?: (item: Item) => ContextMenuItem[] } = {}) {
  const onActivate = vi.fn();
  const buildMenu =
    overrides.buildMenu ??
    ((item: Item): ContextMenuItem[] => [
      {
        id: 'open',
        label: 'Open',
        onSelect: () => {
          onActivate(item);
        },
      },
      { id: 'del', label: 'Delete', danger: true, onSelect: vi.fn() },
    ]);
  render(
    <DataTable
      ariaLabel="Items"
      columns={columns}
      gridTemplate="16px 1fr 1fr 28px"
      rows={items}
      rowKey={(item) => item.id}
      rowLabel={(item) => item.name}
      onActivate={onActivate}
      buildMenu={buildMenu}
    />,
  );
  return { onActivate, buildMenu };
}

describe('relative-time', () => {
  it('formats past and future timestamps and rejects invalid input', () => {
    const now = new Date('2026-07-23T00:00:00.000Z');
    expect(relativeTime('2026-07-20T00:00:00.000Z', now)).toMatch(/3|day/i);
    expect(relativeTime('2026-08-23T00:00:00.000Z', now)).toMatch(/mo|month/i);
    expect(relativeTime('not-a-date')).toBe('');
    expect(absoluteTime('not-a-date')).toBe('');
    expect(absoluteTime('2026-07-20T00:00:00.000Z')).not.toBe('');
  });
});

describe('DataTable', () => {
  it('renders a headerless object grid with labelled rows', () => {
    renderTable();
    expect(screen.getByRole('grid', { name: 'Items' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(items.length);
    expect(screen.getByRole('row', { name: 'Bravo' })).toBeInTheDocument();
  });

  it('roves row focus with the arrow, Home, and End keys', () => {
    renderTable();
    const rows = screen.getAllByRole('row', { name: /Alpha|Bravo|Charlie/ });
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('activates a row with Enter and double-click', () => {
    const { onActivate } = renderTable();
    const row = screen.getByRole('row', { name: 'Alpha' });
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.doubleClick(screen.getByRole('row', { name: 'Bravo' }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('opens the row menu from the overflow button and keyboard', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const row = screen.getByRole('row', { name: 'Bravo' });
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('row', { name: 'Charlie' }), { key: 'ContextMenu' });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('opens the row menu from a right-click', async () => {
    renderTable();
    fireEvent.contextMenu(screen.getByRole('row', { name: 'Alpha' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides the overflow affordance when a row has no actions', () => {
    renderTable({ buildMenu: () => [] });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });
});

describe('RowContextMenu keyboard', () => {
  it('roves menu items and dismisses on outside click', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('runs the selected action and closes', async () => {
    const { onActivate } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Charlie' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(onActivate).toHaveBeenCalledWith(items[2]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('list chrome', () => {
  it('renders the library breadcrumb, search, and action buttons', () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(
      <LibraryHeader
        crumbs={['Library', 'Breakdowns']}
        count={4}
        search={{ value: 'q', onChange, label: 'Search breakdowns' }}
        actions={
          <HeaderButton primary onClick={onClick}>
            New
          </HeaderButton>
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Breakdowns' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'LibraryBreakdowns4',
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search breakdowns' }), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onChange).toHaveBeenCalledWith('x');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders state, section, chip, and status helpers', () => {
    const onClick = vi.fn();
    render(
      <ContentListPage busy>
        <ScrollBody>
          <SectionLabel label="Owned" count={2} />
          <Chip title="role">Owner</Chip>
          <RowStatus>Restoring…</RowStatus>
          <InlineError message="It failed." />
          <StateBlock alert message="Broken." action={{ label: 'Retry', onClick, busy: false }} />
        </ScrollBody>
      </ContentListPage>,
    );
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Restoring…')).toBeInTheDocument();
    expect(screen.getByText('It failed.')).toBeInTheDocument();
    expect(screen.getByText('Broken.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
