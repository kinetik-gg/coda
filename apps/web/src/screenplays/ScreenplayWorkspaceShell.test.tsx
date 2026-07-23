// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanelSlots } from '../workspace/layout';
import {
  ScreenplayWorkspaceShell,
  type ScreenplayWorkspaceShellProps,
} from './ScreenplayWorkspaceShell';
import { createDefaultScreenplayPanelLayout } from './screenplay-panel-layout';

afterEach(cleanup);

const ids = Array.from(
  { length: 20 },
  (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function defaultLayout() {
  let index = 0;
  return createDefaultScreenplayPanelLayout(() => ids[index++]!);
}

describe('ScreenplayWorkspaceShell', () => {
  it('renders the screenplay registry and replaces a panel function in place', () => {
    const onLayoutChange = vi.fn<ScreenplayWorkspaceShellProps['onLayoutChange']>();
    const layout = defaultLayout();
    render(
      <ScreenplayWorkspaceShell
        layout={layout}
        onLayoutChange={onLayoutChange}
        renderPanel={({ panel }) => <span>{panel.type}</span>}
      />,
    );

    expect(screen.getByText('outline')).toBeTruthy();
    expect(screen.getByText('editor')).toBeTruthy();
    expect(screen.getByText('preview')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Outline panel function' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Outline panel function' }));
    expect(screen.queryByRole('menu', { name: 'Choose panel function' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Outline panel function' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Outline' }));
    expect(onLayoutChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Outline panel function' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Preview' }));

    const [next, change] = onLayoutChange.mock.calls[0]!;
    expect(change).toMatchObject({ reason: 'replace', action: { type: 'replace' } });
    const originalOutline = collectPanelSlots(layout.root).find(
      (slot) => slot.panel.type === 'outline',
    )!;
    expect(
      collectPanelSlots(next.root).find((slot) => slot.id === originalOutline.id),
    ).toMatchObject({
      id: originalOutline.id,
      panel: { id: originalOutline.panel.id, type: 'preview' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose Preview panel function' }));
    expect(screen.getByRole('menuitemradio', { name: 'Statistics' })).toBeTruthy();
  });

  it('routes layout operations through the screenplay reducer and ID factory', () => {
    const onLayoutChange = vi.fn<ScreenplayWorkspaceShellProps['onLayoutChange']>();
    const generated = ids.slice(12, 15);
    render(
      <ScreenplayWorkspaceShell
        layout={defaultLayout()}
        onLayoutChange={onLayoutChange}
        renderPanel={({ panel }) => panel.type}
        createId={() => generated.shift()!}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Open Editor panel menu' })).toBeNull();
    fireEvent.contextMenu(screen.getByRole('region', { name: 'Editor' }), {
      clientX: 200,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split top / bottom' }));
    const [next, change] = onLayoutChange.mock.calls[0]!;
    expect(change).toMatchObject({ reason: 'split', action: { type: 'split' } });
    expect(collectPanelSlots(next.root).map((slot) => slot.panel.type)).toEqual([
      'editor',
      'editor',
      'preview',
      'outline',
      'inventory',
    ]);
  });

  it.each([
    ['Editor', 'editor', { fontSize: 16, zoom: 1, showLineNumbers: true }],
    ['Preview', 'preview', { zoom: 1, scrollSync: true }],
    ['Inventory', 'inventory', { view: 'characters', search: '' }],
    ['Statistics', 'statistics', { view: 'overview' }],
  ] as const)(
    'creates default %s panel configuration when replacing another function',
    (label, type, config) => {
      const onLayoutChange = vi.fn<ScreenplayWorkspaceShellProps['onLayoutChange']>();
      render(
        <ScreenplayWorkspaceShell
          layout={defaultLayout()}
          onLayoutChange={onLayoutChange}
          renderPanel={({ panel }) => panel.type}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Choose Outline panel function' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: label }));

      const [next] = onLayoutChange.mock.calls[0]!;
      expect(
        collectPanelSlots(next.root).find((slot) => slot.panel.type === type)?.panel,
      ).toMatchObject({ type, config });
    },
  );
});
