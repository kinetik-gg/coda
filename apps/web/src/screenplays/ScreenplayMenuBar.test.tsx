// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenplayMenuBar, type ScreenplayMenuBarProps } from './ScreenplayMenuBar';

afterEach(cleanup);

function createProps(overrides: Partial<ScreenplayMenuBarProps> = {}): ScreenplayMenuBarProps {
  return {
    title: 'A Better Draft',
    filename: 'a-better-draft.fountain',
    commandState: {
      grammarCheckEnabled: true,
      zoomPercent: 100,
      fontSizePx: 16,
      search: { mode: 'closed', query: '', replacement: '', matchCase: false },
    },
    paperSize: 'letter',
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDownload: vi.fn(),
    onExportPdf: vi.fn(),
    onExportFinalDraft: vi.fn(),
    onCommand: vi.fn(),
    onFormat: vi.fn(),
    onToggleZen: vi.fn(),
    showLineNumbers: true,
    onToggleLineNumbers: vi.fn(),
    showPageBreaks: true,
    onTogglePageBreaks: vi.fn(),
    onPaperSizeChange: vi.fn(),
    onResetLayout: vi.fn(),
    ...overrides,
  };
}

describe('ScreenplayMenuBar', () => {
  it('keeps document and editing operations in the application menu bar', () => {
    const props = createProps();
    render(<ScreenplayMenuBar {...props} />);

    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Save\s*Keyboard shortcut Ctrl-S$/i }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Tools' })).toBeInTheDocument();
  });

  it('renders document identity, paper selection, and platform shortcut labels', () => {
    const props = createProps();
    render(<ScreenplayMenuBar {...props} />);

    expect(screen.getByTitle('A Better Draft · a-better-draft.fountain')).toBeInTheDocument();
    openMenu('File');
    expect(screen.getByLabelText('Keyboard shortcut Ctrl-S')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paper Size' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'US Letter (8.5 × 11 in)' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'A4 (210 × 297 mm)' }));
    expect(props.onPaperSizeChange).toHaveBeenCalledWith('a4');
  });

  it('groups PDF and Final Draft operations under Export', () => {
    const props = createProps();
    render(<ScreenplayMenuBar {...props} />);
    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^PDF/u }));
    expect(props.onExportPdf).toHaveBeenCalledOnce();
  });
});

describe('ScreenplayMenuBar editing menus', () => {
  it('dispatches edit, format, view, and tools callbacks from the app bar', () => {
    const props = createProps();
    render(<ScreenplayMenuBar {...props} />);

    openMenu('Edit');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Undo/ }));
    expect(props.onCommand).toHaveBeenCalledWith('undo');

    openMenu('Format');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Page Break' }));
    expect(props.onFormat).toHaveBeenCalledWith('page-break');

    openMenu('View');
    const lineNumbers = screen.getByRole('menuitemcheckbox', { name: 'Line Numbers' });
    expect(lineNumbers).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(lineNumbers);
    expect(props.onToggleLineNumbers).toHaveBeenCalledOnce();

    openMenu('View');
    const pageBreaks = screen.getByRole('menuitemcheckbox', {
      name: 'Estimated Page Breaks',
    });
    expect(pageBreaks).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(pageBreaks);
    expect(props.onTogglePageBreaks).toHaveBeenCalledOnce();

    openMenu('View');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Workspace Layout' }));
    expect(props.onResetLayout).toHaveBeenCalledOnce();

    openMenu('Tools');
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Check Spelling and Grammar' }),
    );
    expect(props.onCommand).toHaveBeenCalledWith('toggle-grammar-check');
  });

  it('moves between editor menu triggers with horizontal arrow keys', () => {
    render(<ScreenplayMenuBar {...createProps()} />);
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    const format = screen.getByRole('menuitem', { name: 'Format' });

    edit.focus();
    fireEvent.keyDown(edit, { key: 'ArrowRight' });
    expect(format).toHaveFocus();

    fireEvent.keyDown(format, { key: 'ArrowLeft' });
    expect(edit).toHaveFocus();
  });

  it('opens by keyboard, navigates menu items, and restores focus on Escape', async () => {
    render(<ScreenplayMenuBar {...createProps()} />);
    const edit = screen.getByRole('menuitem', { name: 'Edit' });

    fireEvent.keyDown(edit, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu', { name: 'Edit' });
    const entries = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(entries[0]).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(entries[1]).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Edit' })).not.toBeInTheDocument();
    expect(edit).toHaveFocus();
  });

  it('switches an open menu with horizontal arrow keys', () => {
    render(<ScreenplayMenuBar {...createProps()} />);
    openMenu('Edit');
    const editMenu = screen.getByRole('menu', { name: 'Edit' });

    fireEvent.keyDown(editMenu, { key: 'ArrowRight' });

    expect(screen.queryByRole('menu', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Format' })).toHaveFocus();
  });
});

function openMenu(name: string) {
  fireEvent.click(screen.getByRole('menuitem', { name }));
}
