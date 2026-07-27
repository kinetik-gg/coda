import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import type { KeybindingId } from '../keybindings';
import appStyles from '../App.styles';
import { commandItems, type ApplicationCommand } from '../app-shell/application-command';
import {
  commandPaletteCommand,
  helpCommands,
  helpMenu,
  shareCommand,
  type CommonApplicationCommandContext,
} from '../app-shell/common-commands';
import type { MenuBarModel, MenuNode } from '../app-shell/menu-bar';
import type { ScreenplayCommandId, ScreenplayCommandState } from './screenplay-commands';
import type { FountainFormatCommand } from './screenplay-formatting';
import type { ScreenplayPaperSize } from './screenplay-paper';

export interface ScreenplayMenuContext extends CommonApplicationCommandContext {
  surface: 'screenplay';
  screenplayId: string;
  title: string;
  commandState: Readonly<ScreenplayCommandState>;
  hasEditorTarget: boolean;
  canPaste: boolean;
  paperSize: ScreenplayPaperSize;
  canEdit: boolean;
  canManage: boolean;
  screenplays: Array<{ id: string; title: string }>;
  onBack: () => void;
  onOpenScreenplay: (id: string) => void;
  onSave: () => void;
  onRename: () => void;
  onRenameTitle: (title: string) => Promise<void>;
  openShare: () => void;
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

export type ScreenplayApplicationCommand = ApplicationCommand<ScreenplayMenuContext>;
type ScreenplayNode = MenuNode<ScreenplayMenuContext>;

const withEditor = (ctx: ScreenplayMenuContext) => ctx.hasEditorTarget;
const withWritableEditor = (ctx: ScreenplayMenuContext) => ctx.hasEditorTarget && ctx.canEdit;
const editorReason = (ctx: ScreenplayMenuContext) =>
  ctx.hasEditorTarget ? undefined : 'Open or focus an Editor panel to use this command.';
const writableEditorReason = (ctx: ScreenplayMenuContext) =>
  !ctx.hasEditorTarget
    ? editorReason(ctx)
    : ctx.canEdit
      ? undefined
      : 'This screenplay is read only.';

function editorCommand(
  id: string,
  section: string,
  label: string,
  command: ScreenplayCommandId,
  options: {
    keybinding?: KeybindingId;
    writable?: boolean;
    enabled?: (ctx: ScreenplayMenuContext) => boolean;
    disabledReason?: (ctx: ScreenplayMenuContext) => string | undefined;
  } = {},
): ScreenplayApplicationCommand {
  const writable = options.writable ?? false;
  return {
    id,
    section,
    label: () => label,
    ...(options.keybinding ? { keybinding: options.keybinding } : {}),
    enabled: options.enabled ?? (writable ? withWritableEditor : withEditor),
    disabledReason: options.disabledReason ?? (writable ? writableEditorReason : editorReason),
    run: (ctx) => ctx.onCommand(command),
  };
}

function formatCommand(
  id: string,
  label: string,
  command: FountainFormatCommand,
  keybinding?: KeybindingId,
): ScreenplayApplicationCommand {
  return {
    id,
    section: 'Format',
    label: () => label,
    ...(keybinding ? { keybinding } : {}),
    enabled: withWritableEditor,
    disabledReason: writableEditorReason,
    run: (ctx) => ctx.onFormat(command),
  };
}

const blockFormats = (
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
).map(([command, label]) => formatCommand(`format-${command}`, label, command));

export const screenplayApplicationCommands: readonly ScreenplayApplicationCommand[] = [
  {
    id: 'screenplays',
    section: 'File',
    label: () => 'Screenplays',
    run: (ctx) => ctx.onBack(),
  },
  {
    id: 'rename',
    section: 'File',
    label: () => 'Rename…',
    enabled: (ctx) => ctx.canEdit,
    disabledReason: (ctx) => (ctx.canEdit ? undefined : 'This screenplay is read only.'),
    run: (ctx) => ctx.onRename(),
  },
  shareCommand<ScreenplayMenuContext>(),
  {
    id: 'save',
    section: 'File',
    label: () => 'Save',
    keybinding: 'save',
    enabled: (ctx) => ctx.canEdit,
    disabledReason: (ctx) => (ctx.canEdit ? undefined : 'This screenplay is read only.'),
    run: (ctx) => ctx.onSave(),
  },
  {
    id: 'save-copy',
    section: 'File',
    label: () => 'Save Fountain Copy…',
    keybinding: 'saveCopy',
    run: (ctx) => ctx.onDownload(),
  },
  {
    id: 'export-pdf',
    section: 'Export',
    label: () => 'PDF…',
    keybinding: 'exportPdf',
    run: (ctx) => ctx.onExportPdf(),
  },
  {
    id: 'export-fdx',
    section: 'Export',
    label: () => 'Final Draft (.fdx)…',
    run: (ctx) => ctx.onExportFinalDraft(),
  },
  {
    id: 'paper-letter',
    section: 'Paper Size',
    label: () => 'US Letter (8.5 × 11 in)',
    checked: (ctx) => ctx.paperSize === 'letter',
    current: (ctx) => ctx.paperSize === 'letter',
    enabled: (ctx) => ctx.canEdit,
    disabledReason: (ctx) => (ctx.canEdit ? undefined : 'This screenplay is read only.'),
    run: (ctx) => ctx.onPaperSizeChange('letter'),
  },
  {
    id: 'paper-a4',
    section: 'Paper Size',
    label: () => 'A4 (210 × 297 mm)',
    checked: (ctx) => ctx.paperSize === 'a4',
    current: (ctx) => ctx.paperSize === 'a4',
    enabled: (ctx) => ctx.canEdit,
    disabledReason: (ctx) => (ctx.canEdit ? undefined : 'This screenplay is read only.'),
    run: (ctx) => ctx.onPaperSizeChange('a4'),
  },
  {
    id: 'move-to-trash',
    section: 'File',
    label: () => 'Move to Trash…',
    enabled: (ctx) => ctx.canManage,
    disabledReason: (ctx) =>
      ctx.canManage ? undefined : 'You do not have permission to move this screenplay to trash.',
    run: (ctx) => ctx.onMoveToTrash(),
  },
  editorCommand('undo', 'Edit', 'Undo', 'undo', { keybinding: 'undo', writable: true }),
  editorCommand('redo', 'Edit', 'Redo', 'redo', { keybinding: 'redo', writable: true }),
  editorCommand('cut', 'Edit', 'Cut', 'cut', { keybinding: 'cut', writable: true }),
  editorCommand('copy', 'Edit', 'Copy', 'copy', { keybinding: 'copy' }),
  editorCommand('paste', 'Edit', 'Paste', 'paste', {
    keybinding: 'paste',
    writable: true,
    enabled: (ctx) => ctx.hasEditorTarget && ctx.canEdit && ctx.canPaste,
    disabledReason: (ctx) =>
      writableEditorReason(ctx) ??
      (ctx.canPaste ? undefined : 'Clipboard read access is unavailable in this host.'),
  }),
  editorCommand('select-all', 'Edit', 'Select All', 'select-all', { keybinding: 'selectAll' }),
  editorCommand('find', 'Edit', 'Find…', 'open-find', { keybinding: 'find' }),
  editorCommand('replace', 'Edit', 'Find and Replace…', 'open-replace', {
    keybinding: 'replace',
    writable: true,
  }),
  editorCommand('find-next', 'Edit', 'Find Next', 'find-next', { keybinding: 'findNext' }),
  editorCommand('find-previous', 'Edit', 'Find Previous', 'find-previous', {
    keybinding: 'findPrevious',
  }),
  editorCommand('replace-next', 'Edit', 'Replace', 'replace-next', { writable: true }),
  editorCommand('replace-all', 'Edit', 'Replace All', 'replace-all', { writable: true }),
  formatCommand('format-bold', 'Bold', 'bold', 'formatBold'),
  formatCommand('format-italic', 'Italic', 'italic', 'formatItalic'),
  formatCommand('format-underline', 'Underline', 'underline', 'formatUnderline'),
  ...blockFormats,
  commandPaletteCommand<ScreenplayMenuContext>(),
  editorCommand('zoom-in', 'View', 'Zoom In', 'zoom-in', { keybinding: 'zoomIn' }),
  editorCommand('zoom-out', 'View', 'Zoom Out', 'zoom-out', { keybinding: 'zoomOut' }),
  editorCommand('zoom-reset', 'View', 'Actual Size', 'zoom-reset', { keybinding: 'zoomReset' }),
  editorCommand('font-increase', 'View', 'Increase Editor Font', 'font-size-increase'),
  editorCommand('font-decrease', 'View', 'Decrease Editor Font', 'font-size-decrease'),
  editorCommand('font-reset', 'View', 'Reset Editor Font', 'font-size-reset'),
  {
    id: 'line-numbers',
    section: 'View',
    label: () => 'Line Numbers',
    checked: (ctx) => ctx.showLineNumbers,
    run: (ctx) => ctx.onToggleLineNumbers(),
  },
  {
    id: 'page-breaks',
    section: 'View',
    label: () => 'Estimated Page Breaks',
    checked: (ctx) => ctx.showPageBreaks,
    run: (ctx) => ctx.onTogglePageBreaks(),
  },
  {
    id: 'zen',
    section: 'View',
    label: () => 'Zen Mode',
    keybinding: 'zenMode',
    run: (ctx) => ctx.onToggleZen(),
  },
  {
    id: 'reset-layout',
    section: 'View',
    label: () => 'Reset Workspace Layout',
    run: (ctx) => ctx.onResetLayout(),
  },
  {
    id: 'grammar',
    section: 'Tools',
    label: () => 'Check Spelling and Grammar',
    checked: (ctx) => ctx.commandState.grammarCheckEnabled,
    enabled: withEditor,
    disabledReason: editorReason,
    run: (ctx) => ctx.onCommand('toggle-grammar-check'),
  },
  ...helpCommands<ScreenplayMenuContext>(),
];

const items = (...ids: string[]) => commandItems(screenplayApplicationCommands, ...ids);
const formatIds = blockFormats.map((command) => command.id);

const exportSubmenu: ScreenplayNode = {
  kind: 'submenu',
  id: 'export',
  label: 'Export',
  items: items('export-pdf', 'export-fdx'),
};

const paperSizeSubmenu: ScreenplayNode = {
  kind: 'submenu',
  id: 'paper-size',
  label: 'Paper Size',
  items: items('paper-letter', 'paper-a4'),
};

function screenplayItems(ctx: ScreenplayMenuContext): ScreenplayNode[] {
  return ctx.screenplays.map((screenplay) => ({
    kind: 'action',
    id: `screenplay-${screenplay.id}`,
    label: screenplay.title,
    ariaCurrent: () => screenplay.id === ctx.screenplayId,
    run: (context) => context.onOpenScreenplay(screenplay.id),
  }));
}

export const screenplayMenuBarModel: MenuBarModel<ScreenplayMenuContext> = {
  ariaLabel: 'Screenplay application menu',
  menus: [
    {
      id: 'file',
      label: 'File',
      items: (ctx) => [
        ...items('screenplays', 'rename', 'share', '---', 'save', 'save-copy', '---')(ctx),
        exportSubmenu,
        paperSizeSubmenu,
        ...items('---', 'move-to-trash')(ctx),
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: items(
        'undo',
        'redo',
        '---',
        'cut',
        'copy',
        'paste',
        'select-all',
        '---',
        'find',
        'replace',
        'find-next',
        'find-previous',
        'replace-next',
        'replace-all',
      ),
    },
    {
      id: 'format',
      label: 'Format',
      items: items('format-bold', 'format-italic', 'format-underline', '---', ...formatIds),
    },
    {
      id: 'view',
      label: 'View',
      items: items(
        'command-palette',
        '---',
        'zoom-in',
        'zoom-out',
        'zoom-reset',
        '---',
        'font-increase',
        'font-decrease',
        'font-reset',
        'line-numbers',
        'page-breaks',
        'zen',
        '---',
        'reset-layout',
      ),
    },
    {
      id: 'tools',
      label: 'Tools',
      items: items('grammar'),
    },
    helpMenu(screenplayApplicationCommands),
    {
      id: 'screenplay',
      align: 'end',
      className: appStyles.projectMenu,
      popupClassName: appStyles.projectMenuPopup,
      label: (ctx) => (
        <>
          <BookOpenTextIcon size={12} aria-hidden="true" />
          <span>{ctx.title}</span>
          <CaretUpDownIcon className={appStyles.projectMenuCaret} size={12} aria-hidden="true" />
        </>
      ),
      items: screenplayItems,
    },
  ],
};
