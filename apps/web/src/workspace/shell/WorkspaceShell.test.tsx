// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLayout } from '@coda/contracts';
import { collectPanelSlots } from '../layout';
import { WorkspaceShell } from './WorkspaceShell';
import type { WorkspaceShellProps } from './types';

afterEach(cleanup);

const ids = {
  split: '10000000-0000-4000-8000-000000000001',
  firstSlot: '10000000-0000-4000-8000-000000000002',
  firstPanel: '10000000-0000-4000-8000-000000000003',
  secondSlot: '10000000-0000-4000-8000-000000000004',
  secondPanel: '10000000-0000-4000-8000-000000000005',
  newSplit: '10000000-0000-4000-8000-000000000006',
  newSlot: '10000000-0000-4000-8000-000000000007',
  newPanel: '10000000-0000-4000-8000-000000000008',
} as const;

function layout(): WorkspaceLayout {
  return {
    schemaVersion: 1,
    root: {
      kind: 'split',
      id: ids.split,
      axis: 'horizontal',
      ratioBasisPoints: 5000,
      first: {
        kind: 'panel',
        id: ids.firstSlot,
        panel: {
          id: ids.firstPanel,
          type: 'pdf',
          configVersion: 1,
          config: { sourceDocumentId: null, page: 1, zoom: 1 },
        },
      },
      second: {
        kind: 'panel',
        id: ids.secondSlot,
        panel: {
          id: ids.secondPanel,
          type: 'inspector',
          configVersion: 1,
          config: { section: 'details', search: '' },
        },
      },
    },
  };
}

function renderShell(options: { onUndo?: () => void } = {}) {
  const generated = [ids.newSplit, ids.newSlot, ids.newPanel];
  const onLayoutChange = vi.fn<WorkspaceShellProps['onLayoutChange']>();
  render(
    <div style={{ width: 900, height: 600 }}>
      <WorkspaceShell
        layout={layout()}
        onLayoutChange={onLayoutChange}
        renderPanel={({ panel, isFullscreen }) => (
          <span>{`${panel.type}:${isFullscreen ? 'fullscreen' : 'panel'}`}</span>
        )}
        canUndo
        onUndo={options.onUndo}
        createId={() => generated.shift()!}
      />
    </div>,
  );
  return onLayoutChange;
}

function openPanelMenu(name: string) {
  fireEvent.contextMenu(screen.getByRole('region', { name }), { clientX: 120, clientY: 80 });
}

describe('WorkspaceShell', () => {
  it('renders registered panel content and delegates undo', () => {
    const onUndo = vi.fn();
    renderShell({ onUndo });
    expect(screen.getByText('pdf:panel')).toBeTruthy();
    expect(screen.getByText('inspector:panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('exposes a fullscreen toggle as the sole header affordance on every panel, with no more-menu button', () => {
    renderShell();
    expect(screen.getAllByRole('button', { name: 'Fullscreen' })).toHaveLength(2);
    expect(screen.queryByLabelText(/panel menu$/)).toBeNull();
  });

  it('splits a panel through the context menu with immutable cloned configuration', () => {
    const onLayoutChange = renderShell();
    openPanelMenu('PDF Viewer');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split left / right' }));
    expect(onLayoutChange).toHaveBeenCalledOnce();
    const [next, change] = onLayoutChange.mock.calls[0]!;
    expect(change).toMatchObject({ reason: 'split', action: { type: 'split' } });
    expect(collectPanelSlots(next.root)).toHaveLength(3);
    const pdfPanels = collectPanelSlots(next.root).filter((slot) => slot.panel.type === 'pdf');
    expect(pdfPanels[0]!.panel.config).toEqual(pdfPanels[1]!.panel.config);
    expect(pdfPanels[0]!.panel.config).not.toBe(pdfPanels[1]!.panel.config);
  });

  it('exposes the complete panel operations set through the context menu', () => {
    renderShell();
    openPanelMenu('PDF Viewer');
    for (const name of [
      'Split left / right',
      'Split top / bottom',
      'Join left',
      'Join right',
      'Join up',
      'Join down',
      'Swap left',
      'Swap right',
      'Swap up',
      'Swap down',
      'Fullscreen',
      'Close panel',
    ])
      expect(screen.getByRole('menuitem', { name })).toBeTruthy();
  });

  it('commits keyboard splitter changes only through the controlled callback', () => {
    const onLayoutChange = renderShell();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onLayoutChange).toHaveBeenCalledOnce();
    expect(onLayoutChange.mock.calls[0]![1]).toMatchObject({
      reason: 'ratio',
      action: { type: 'set-ratio', splitId: ids.split, ratioBasisPoints: 5250 },
    });
    expect((layout().root as { ratioBasisPoints: number }).ratioBasisPoints).toBe(5000);
  });

  it('replaces the current panel function through the registry picker', () => {
    const onLayoutChange = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Choose PDF Viewer panel function' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Inspector' }));

    expect(onLayoutChange).toHaveBeenCalledOnce();
    const [next, change] = onLayoutChange.mock.calls[0]!;
    expect(change).toMatchObject({ reason: 'replace', action: { type: 'replace' } });
    expect(collectPanelSlots(next.root)[0]).toMatchObject({
      id: ids.firstSlot,
      panel: { id: ids.firstPanel, type: 'inspector' },
    });
  });

  it('keeps fullscreen transient and closes panels through the layout reducer', () => {
    const onLayoutChange = renderShell();
    openPanelMenu('PDF Viewer');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fullscreen' }));
    expect(screen.getByText('pdf:fullscreen')).toBeTruthy();
    expect(onLayoutChange).not.toHaveBeenCalled();

    openPanelMenu('PDF Viewer');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close panel' }));
    expect(onLayoutChange).toHaveBeenCalledOnce();
    expect(collectPanelSlots(onLayoutChange.mock.calls[0]![0].root)).toHaveLength(1);
  });
});
