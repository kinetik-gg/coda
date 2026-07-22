// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityTableContextMenu, EntityTableDialogs, EntityTableGrid } from './EntityTableView';
import { ItemEditorModal } from './ItemEditorModal';
import type { BreakdownItem } from './types';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: () => void }) => (
    <div data-testid="dnd" onMouseUp={onDragEnd}>
      {children}
    </div>
  ),
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: { x: 1, y: 2 },
    transition: 'move',
    isDragging: true,
  })),
}));

const type = { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 };
function item(id: string, title = id): BreakdownItem {
  return {
    id,
    entityTypeId: 'shot',
    parentId: 'scene',
    title,
    displayCode: id.toUpperCase(),
    description: 'Description',
    version: 1,
    values: [],
    sourceReferences: [],
    _count: { children: 2 },
  };
}
const columns = [
  { key: 'code', label: 'Code' },
  { key: 'title', label: 'Title' },
  { key: 'children', label: 'Children' },
  { key: 'field:missing', label: 'Missing', field: { id: 'missing' } },
];

afterEach(cleanup);

describe('entity table view', () => {
  it('renders rows and forwards row, resize, load, and drag interactions', () => {
    const callbacks = {
      onLoadMore: vi.fn(),
      onResize: vi.fn(),
      onReorder: vi.fn(),
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onSelect: vi.fn(),
      onOpenMenu: vi.fn(),
    };
    const row = item('one', 'First shot');
    render(
      <EntityTableGrid
        type={type}
        isDeepest
        orderingScope="scope"
        columns={columns as never}
        columnWidths={{ title: 240 }}
        items={[row]}
        selectedId="one"
        parentId="scene"
        sort="manual"
        loading={false}
        error={null}
        hasMore
        loadingMore={false}
        {...callbacks}
      />,
    );
    const tableRow = screen.getByText('First shot').closest('tr')!;
    fireEvent.click(tableRow);
    fireEvent.doubleClick(tableRow);
    fireEvent.keyDown(tableRow, { key: 'Enter' });
    fireEvent.contextMenu(tableRow);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more shots' }));
    fireEvent.mouseUp(screen.getByTestId('dnd'));
    expect(callbacks.onSelect).toHaveBeenCalledWith(row);
    expect(callbacks.onEdit).toHaveBeenCalledTimes(2);
    expect(callbacks.onOpenMenu).toHaveBeenCalled();
    expect(callbacks.onResize).toHaveBeenCalled();
    expect(callbacks.onLoadMore).toHaveBeenCalled();
    expect(callbacks.onReorder).toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Reorder First shot' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('renders loading, error, empty, and loading-more states', () => {
    const props = {
      type,
      isDeepest: false,
      orderingScope: 'scope',
      columns: columns.slice(0, 2) as never,
      columnWidths: {},
      items: [] as BreakdownItem[],
      selectedId: undefined,
      parentId: undefined,
      sort: 'title',
      error: null,
      hasMore: false,
      loadingMore: false,
      onLoadMore: vi.fn(),
      onResize: vi.fn(),
      onReorder: vi.fn(),
      onRetry: vi.fn(),
      onEdit: vi.fn(),
      onSelect: vi.fn(),
      onOpenMenu: vi.fn(),
    };
    const { rerender } = render(<EntityTableGrid {...props} loading />);
    expect(screen.getByRole('status').textContent).toContain('Loading Shots');
    rerender(<EntityTableGrid {...props} loading={false} error={new Error('bad')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalled();
    rerender(<EntityTableGrid {...props} loading={false} />);
    expect(screen.getByText('No shots yet.')).toBeTruthy();
    rerender(<EntityTableGrid {...props} loading={false} hasMore loadingMore />);
    expect(screen.getByRole('button', { name: 'Loading more…' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('positions and invokes context menu actions', () => {
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const row = item('one');
    const { rerender } = render(
      <EntityTableContextMenu
        menu={undefined}
        menuRef={createRef()}
        singularName="Shot"
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    rerender(
      <EntityTableContextMenu
        menu={{ x: window.innerWidth + 100, y: window.innerHeight + 100, item: row }}
        menuRef={createRef()}
        singularName="Shot"
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    for (const name of ['Add Shot…', 'Edit…', 'Move to trash'])
      fireEvent.click(screen.getByRole('menuitem', { name }));
    expect(onAdd).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledWith(row);
    expect(onDelete).toHaveBeenCalledWith(row);
  });

  it('validates and submits item editor content, including a required parent', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const parent = { ...item('scene', 'Opening'), entityTypeId: 'scene', displayCode: 'SC-1' };
    render(
      <ItemEditorModal
        entityType={type}
        parentType={{ ...type, id: 'scene', singularName: 'Scene', pluralName: 'Scenes', level: 1 }}
        parents={[parent]}
        defaultParentId={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Shot' }));
    expect(screen.getByRole('alert').textContent).toContain('Title is required.');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: '  New shot  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Shot' }));
    expect(screen.getByRole('alert').textContent).toContain('Choose a scene.');
    fireEvent.click(screen.getByRole('button', { name: 'Scene' }));
    fireEvent.click(screen.getByRole('option', { name: 'SC-1 — Opening' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: ' S1 ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: ' Notes ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Shot' }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'New shot',
      displayCode: 'S1',
      description: 'Notes',
      parentId: 'scene',
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('wires editor and destructive confirmation dialogs', () => {
    const onCloseEditor = vi.fn();
    const onSaveEditor = vi.fn();
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const row = item('one', 'First');
    render(
      <EntityTableDialogs
        type={type}
        parents={[]}
        defaultParentId={null}
        editor={{ mode: 'edit', item: row }}
        editorBusy={false}
        editorError="Save failed"
        deleteConfirmation={row}
        deleteBusy={false}
        deleteError="Delete failed"
        onCloseEditor={onCloseEditor}
        onSaveEditor={onSaveEditor}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
      />,
    );
    expect(screen.getByText('Save failed')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(onCloseEditor).toHaveBeenCalled();
    expect(onConfirmDelete).toHaveBeenCalledWith(row);
  });
});
