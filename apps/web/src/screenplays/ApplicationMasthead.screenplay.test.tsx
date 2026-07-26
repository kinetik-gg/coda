// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ApplicationMasthead,
  type ApplicationMastheadContext,
} from '../app-shell/ApplicationMasthead';

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(cleanup);

type ScreenplayMastheadContext = Extract<ApplicationMastheadContext, { surface: 'screenplay' }>;

function createProps(
  overrides: Partial<Omit<ScreenplayMastheadContext, 'surface'>> = {},
): ScreenplayMastheadContext {
  return {
    surface: 'screenplay',
    title: 'A Better Draft',
    filename: 'a-better-draft.fountain',
    commandState: {
      grammarCheckEnabled: true,
      zoomPercent: 100,
      fontSizePx: 16,
      search: { mode: 'closed', query: '', replacement: '', matchCase: false },
      hasEditorTarget: true,
    },
    hasEditorTarget: true,
    canPaste: true,
    canEdit: true,
    canManage: true,
    paperSize: 'letter',
    onBack: vi.fn(),
    onSave: vi.fn(),
    onRename: vi.fn(),
    openShare: vi.fn(),
    onMoveToTrash: vi.fn(),
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

describe('screenplay application masthead', () => {
  it('keeps document and editing operations in the application menu bar', () => {
    const props = createProps();
    render(<ApplicationMasthead context={props} />);

    openMenu('File');
    fireEvent.click(
      screen.getByRole('menuitem', { name: /^Save\s*Keyboard shortcut Ctrl \+ S$/i }),
    );
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Tools' })).toBeInTheDocument();
  });

  it('renders document identity, paper selection, and platform shortcut labels', () => {
    const props = createProps();
    render(<ApplicationMasthead context={props} />);

    expect(screen.getByTitle('A Better Draft · a-better-draft.fountain')).toBeInTheDocument();
    openMenu('File');
    expect(screen.getByLabelText('Keyboard shortcut Ctrl + S')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paper Size' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'US Letter (8.5 × 11 in)' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'A4 (210 × 297 mm)' }));
    expect(props.onPaperSizeChange).toHaveBeenCalledWith('a4');
  });

  it('groups PDF and Final Draft operations under Export', () => {
    const props = createProps();
    render(<ApplicationMasthead context={props} />);
    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^PDF/u }));
    expect(props.onExportPdf).toHaveBeenCalledOnce();
  });

  it('opens the screenplay command registry from the shared palette trigger and chord', () => {
    const props = createProps();
    const { rerender } = render(<ApplicationMasthead context={props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open the command palette' }));
    let palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('option', { name: /^Find…/u })).toBeVisible();
    expect(
      within(palette).getByRole('option', { name: 'Check Spelling and Grammar' }),
    ).toBeVisible();
    expect(within(palette).getByRole('option', { name: /^Documentation/u })).toBeVisible();
    expect(within(palette).queryByRole('option', { name: 'Breakdowns' })).not.toBeInTheDocument();
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });

    rerender(<ApplicationMasthead context={props} />);
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true });
    palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(palette).toBeVisible();
  });
});

describe('screenplay application masthead editing menus', () => {
  it('dispatches edit, format, view, and tools callbacks from the app bar', () => {
    const props = createProps();
    render(<ApplicationMasthead context={props} />);

    openMenu('Edit');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Undo/ }));
    expect(props.onCommand).toHaveBeenCalledWith('undo');
    openMenu('Edit');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Replace All' }));
    expect(props.onCommand).toHaveBeenCalledWith('replace-all');

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
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Check Spelling and Grammar' }));
    expect(props.onCommand).toHaveBeenCalledWith('toggle-grammar-check');
  });

  it('disables target-gated Edit items when no editor panel is active', () => {
    const props = createProps({
      hasEditorTarget: false,
      commandState: {
        grammarCheckEnabled: true,
        zoomPercent: 100,
        fontSizePx: 16,
        search: { mode: 'closed', query: '', replacement: '', matchCase: false },
        hasEditorTarget: false,
      },
    });
    render(<ApplicationMasthead context={props} />);

    openMenu('Edit');
    for (const name of [/^Undo/, /^Redo/, /^Cut/, /^Copy/, /^Paste/, /^Select All/, /^Find…/]) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /^Undo/ }));
    expect(props.onCommand).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Edit' }), { key: 'Escape' });

    openMenu('Format');
    expect(screen.getByRole('menuitem', { name: /^Bold/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Page Break' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Format' }), { key: 'Escape' });

    openMenu('View');
    expect(screen.getByRole('menuitem', { name: /^Zoom In/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Increase Editor Font' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'View' }), { key: 'Escape' });

    openMenu('Tools');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Check Spelling and Grammar' }),
    ).toBeDisabled();
  });

  it('disables only Paste when clipboard read is unavailable but an editor is active', () => {
    const props = createProps({ canPaste: false });
    render(<ApplicationMasthead context={props} />);

    openMenu('Edit');
    expect(screen.getByRole('menuitem', { name: /^Paste/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /^Copy/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /^Cut/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('menuitem', { name: /^Copy/ }));
    expect(props.onCommand).toHaveBeenCalledWith('copy');
  });

  it('moves between editor menu triggers with horizontal arrow keys', () => {
    render(<ApplicationMasthead context={createProps()} />);
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    const format = screen.getByRole('menuitem', { name: 'Format' });

    edit.focus();
    fireEvent.keyDown(edit, { key: 'ArrowRight' });
    expect(format).toHaveFocus();

    fireEvent.keyDown(format, { key: 'ArrowLeft' });
    expect(edit).toHaveFocus();
  });

  it('opens by keyboard, navigates menu items, and restores focus on Escape', async () => {
    render(<ApplicationMasthead context={createProps()} />);
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
    render(<ApplicationMasthead context={createProps()} />);
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
