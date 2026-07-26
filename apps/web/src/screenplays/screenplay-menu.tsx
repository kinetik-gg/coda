import type { KeybindingId } from '../keybindings';
import type { MenuBarModel, MenuNode } from '../app-shell/menu-bar';
import type { ScreenplayCommandId, ScreenplayCommandState } from './screenplay-commands';
import type { FountainFormatCommand } from './screenplay-formatting';
import type { ScreenplayPaperSize } from './screenplay-paper';

/**
 * The screenplay editor's menu-bar context. Carries the document identity,
 * live command state, and the callbacks the declarative model runs. Equivalent
 * to the breakdown context — same shape of dependency, editor-specific fields.
 */
export interface ScreenplayMenuContext {
  title: string;
  filename: string;
  commandState: Readonly<ScreenplayCommandState>;
  /**
   * Whether an editor command target is active. Target-gated Edit items (undo,
   * redo, cut/copy/paste, select-all, find/replace) are disabled without one,
   * so they never dead-end into the "no editor" notice.
   */
  hasEditorTarget: boolean;
  /**
   * Whether the platform exposes clipboard `readText`. When false, Paste is
   * disabled in the menu; the native keyboard shortcut still works and stays
   * documented in the item's shortcut label.
   */
  canPaste: boolean;
  paperSize: ScreenplayPaperSize;
  /** Whether the caller may edit this screenplay (`edit_screenplay`); false renders a read-only editor. */
  canEdit: boolean;
  /** Whether the caller may open the management/share surface (`manage_screenplay_settings`). */
  canManage: boolean;
  onBack: () => void;
  onSave: () => void;
  onRename: () => void;
  onShare: () => void;
  onMoveToTrash: () => void;
  onDownload: () => void;
  onExportPdf: () => void;
  onExportFinalDraft: () => void;
  onCommand: (command: ScreenplayCommandId) => void;
  onFormat: (command: FountainFormatCommand) => void;
  onToggleZen: () => void;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
  showPageBreaks: boolean;
  onTogglePageBreaks: () => void;
  onPaperSizeChange: (paperSize: ScreenplayPaperSize) => void;
  onResetLayout: () => void;
}

type ScreenplayNode = MenuNode<ScreenplayMenuContext>;

function commandItem(
  id: string,
  label: string,
  command: ScreenplayCommandId,
  keybinding?: KeybindingId,
  enabled?: (ctx: ScreenplayMenuContext) => boolean,
): ScreenplayNode {
  return { kind: 'action', id, label, keybinding, enabled, run: (c) => c.onCommand(command) };
}

/** Target-gated Edit commands need a mounted editor to act on. */
const withEditor = (c: ScreenplayMenuContext) => c.hasEditorTarget;

function formatItem(
  id: string,
  label: string,
  command: FountainFormatCommand,
  keybinding?: KeybindingId,
): ScreenplayNode {
  return { kind: 'action', id, label, keybinding, run: (c) => c.onFormat(command) };
}

const blockFormatItems: ScreenplayNode[] = (
  [
    ['scene-heading', 'Scene Heading'],
    ['action', 'Action'],
    ['character', 'Character'],
    ['parenthetical', 'Parenthetical'],
    ['transition', 'Transition'],
    ['lyric', 'Lyric'],
    ['centered', 'Centered'],
    ['note', 'Note'],
    ['page-break', 'Page Break'],
  ] as const
).map(([command, label]) => formatItem(`format-${command}`, label, command));

const fileMenu = {
  id: 'file',
  label: 'File',
  items: (): ScreenplayNode[] => [
    { kind: 'action', id: 'screenplays', label: 'Screenplays', run: (c) => c.onBack() },
    {
      kind: 'action',
      id: 'rename',
      label: 'Rename…',
      enabled: (c) => c.canEdit,
      run: (c) => c.onRename(),
    },
    {
      kind: 'action',
      id: 'share',
      label: 'Share…',
      enabled: (c) => c.canManage,
      run: (c) => c.onShare(),
    },
    { kind: 'separator', id: 'file-sep-1' },
    {
      kind: 'action',
      id: 'save',
      label: 'Save',
      keybinding: 'save',
      enabled: (c) => c.canEdit,
      run: (c) => c.onSave(),
    },
    {
      kind: 'action',
      id: 'save-copy',
      label: 'Save Fountain Copy…',
      keybinding: 'saveCopy',
      run: (c) => c.onDownload(),
    },
    { kind: 'separator', id: 'file-sep-2' },
    {
      kind: 'submenu',
      id: 'export',
      label: 'Export',
      items: (): ScreenplayNode[] => [
        {
          kind: 'action',
          id: 'export-pdf',
          label: 'PDF…',
          keybinding: 'exportPdf',
          run: (c) => c.onExportPdf(),
        },
        {
          kind: 'action',
          id: 'export-fdx',
          label: 'Final Draft (.fdx)…',
          run: (c) => c.onExportFinalDraft(),
        },
      ],
    },
    {
      kind: 'submenu',
      id: 'paper-size',
      label: 'Paper Size',
      items: (): ScreenplayNode[] => [
        {
          kind: 'action',
          id: 'paper-letter',
          label: 'US Letter (8.5 × 11 in)',
          checked: (c) => c.paperSize === 'letter',
          enabled: (c) => c.canEdit,
          run: (c) => c.onPaperSizeChange('letter'),
        },
        {
          kind: 'action',
          id: 'paper-a4',
          label: 'A4 (210 × 297 mm)',
          checked: (c) => c.paperSize === 'a4',
          enabled: (c) => c.canEdit,
          run: (c) => c.onPaperSizeChange('a4'),
        },
      ],
    },
    { kind: 'separator', id: 'file-sep-3' },
    {
      kind: 'action',
      id: 'move-to-trash',
      label: 'Move to Trash…',
      enabled: (c) => c.canManage,
      run: (c) => c.onMoveToTrash(),
    },
  ],
} satisfies MenuBarModel<ScreenplayMenuContext>['menus'][number];

const editMenu = {
  id: 'edit',
  label: 'Edit',
  items: (): ScreenplayNode[] => [
    commandItem('undo', 'Undo', 'undo', 'undo', withEditor),
    commandItem('redo', 'Redo', 'redo', 'redo', withEditor),
    { kind: 'separator', id: 'edit-sep-1' },
    commandItem('cut', 'Cut', 'cut', 'cut', withEditor),
    commandItem('copy', 'Copy', 'copy', 'copy', withEditor),
    commandItem('paste', 'Paste', 'paste', 'paste', (c) => c.hasEditorTarget && c.canPaste),
    commandItem('select-all', 'Select All', 'select-all', 'selectAll', withEditor),
    { kind: 'separator', id: 'edit-sep-2' },
    commandItem('find', 'Find…', 'open-find', 'find', withEditor),
    commandItem('replace', 'Find and Replace…', 'open-replace', 'replace', withEditor),
    commandItem('find-next', 'Find Next', 'find-next', 'findNext', withEditor),
    commandItem('find-previous', 'Find Previous', 'find-previous', 'findPrevious', withEditor),
  ],
} satisfies MenuBarModel<ScreenplayMenuContext>['menus'][number];

const formatMenu = {
  id: 'format',
  label: 'Format',
  items: (): ScreenplayNode[] => [
    formatItem('format-bold', 'Bold', 'bold', 'formatBold'),
    formatItem('format-italic', 'Italic', 'italic', 'formatItalic'),
    formatItem('format-underline', 'Underline', 'underline', 'formatUnderline'),
    { kind: 'separator', id: 'format-sep-1' },
    ...blockFormatItems,
  ],
} satisfies MenuBarModel<ScreenplayMenuContext>['menus'][number];

const viewMenu = {
  id: 'view',
  label: 'View',
  items: (): ScreenplayNode[] => [
    commandItem('zoom-in', 'Zoom In', 'zoom-in', 'zoomIn'),
    commandItem('zoom-out', 'Zoom Out', 'zoom-out', 'zoomOut'),
    commandItem('zoom-reset', 'Actual Size', 'zoom-reset', 'zoomReset'),
    { kind: 'separator', id: 'view-sep-1' },
    commandItem('font-increase', 'Increase Editor Font', 'font-size-increase'),
    commandItem('font-decrease', 'Decrease Editor Font', 'font-size-decrease'),
    commandItem('font-reset', 'Reset Editor Font', 'font-size-reset'),
    {
      kind: 'action',
      id: 'line-numbers',
      label: 'Line Numbers',
      checked: (c) => c.showLineNumbers,
      run: (c) => c.onToggleLineNumbers(),
    },
    {
      kind: 'action',
      id: 'page-breaks',
      label: 'Estimated Page Breaks',
      checked: (c) => c.showPageBreaks,
      run: (c) => c.onTogglePageBreaks(),
    },
    {
      kind: 'action',
      id: 'zen',
      label: 'Zen Mode',
      keybinding: 'zenMode',
      run: (c) => c.onToggleZen(),
    },
    { kind: 'separator', id: 'view-sep-2' },
    {
      kind: 'action',
      id: 'reset-layout',
      label: 'Reset Workspace Layout',
      run: (c) => c.onResetLayout(),
    },
  ],
} satisfies MenuBarModel<ScreenplayMenuContext>['menus'][number];

const toolsMenu = {
  id: 'tools',
  label: 'Tools',
  items: (): ScreenplayNode[] => [
    {
      kind: 'action',
      id: 'grammar',
      label: 'Check Spelling and Grammar',
      checked: (c) => c.commandState.grammarCheckEnabled,
      run: (c) => c.onCommand('toggle-grammar-check'),
    },
  ],
} satisfies MenuBarModel<ScreenplayMenuContext>['menus'][number];

/**
 * The screenplay masthead, declared as data. Shares File/Edit/View semantics
 * with the breakdown editor; `Format` and `Tools` are its editor-specific
 * menus. All shortcut labels resolve through the keybindings layer.
 */
export const screenplayMenuBarModel: MenuBarModel<ScreenplayMenuContext> = {
  ariaLabel: 'Screenplay application menu',
  menus: [fileMenu, editMenu, formatMenu, viewMenu, toolsMenu],
};
