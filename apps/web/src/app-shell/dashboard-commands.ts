import type { KeybindingId } from '../keybindings';
import { themes, type ThemeId } from '../themes';
import type { LibraryCapability, LibrarySurfaceCapability, LibraryTarget } from './library-target';
import { railGroups } from './nav-model';

const DOCS_URL = 'https://coda.github.io';
const GITHUB_URL = 'https://github.com/kinetik-gg/coda';
const ISSUES_URL = 'https://github.com/kinetik-gg/coda/issues';

/**
 * How the command palette was opened. `all` is the ⌘K entry point; the object modes are opened by
 * a menu command that needs a target — the palette then doubles as the object picker instead of
 * the shell growing a second, bespoke chooser dialog.
 */
export type PaletteMode = 'all' | 'open' | 'rename' | 'export' | 'trash';

/**
 * Everything the dashboard's commands need to label, enable, and run themselves. Menu bar and
 * command palette are both projections of the same context — neither owns behaviour of its own.
 */
export interface DashboardCommandContext {
  route: string;
  theme: ThemeId;
  isFullscreen: boolean;
  railCollapsed: boolean;
  isAdministrator: boolean;
  /** The mounted library surface, when one has published itself. */
  library?: LibraryTarget;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  toggleRail: () => void;
  logout: () => void;
  /** Opens an external resource without a full-page navigation (Electron-safe). */
  openExternal: (url: string) => void;
  openPalette: (mode: PaletteMode) => void;
  /** Runs a library capability, routing to the library first when no surface offers it yet. */
  runLibrary: (capability: LibrarySurfaceCapability) => void;
}

/**
 * One dashboard command, declared once and rendered twice: as a menu item (discoverability) and as
 * a palette row (speed). Because both surfaces read this list, a command cannot exist in one and
 * be missing from the other — {@link ./dashboard-commands.test.ts} locks that structurally.
 */
export interface DashboardCommand {
  id: string;
  /** Palette group heading, and the command's provenance in the menu bar. */
  section: string;
  label: (ctx: DashboardCommandContext) => string;
  keybinding?: KeybindingId;
  /** Whether the command exists at all for this context (e.g. administration routes). */
  visible?: (ctx: DashboardCommandContext) => boolean;
  enabled?: (ctx: DashboardCommandContext) => boolean;
  /** Checkbox state; when defined the menu renders a `menuitemcheckbox`. */
  checked?: (ctx: DashboardCommandContext) => boolean;
  /** Marks the command as the current choice within a set (e.g. the active theme). */
  current?: (ctx: DashboardCommandContext) => boolean;
  /** Extra terms the palette matches against, beyond the label and section. */
  keywords?: readonly string[];
  run: (ctx: DashboardCommandContext) => void;
}

function hasObjects(ctx: DashboardCommandContext, capability: LibraryCapability): boolean {
  return Boolean(ctx.library?.[capability]) && (ctx.library?.objects.length ?? 0) > 0;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const fileCommands: readonly DashboardCommand[] = [
  {
    id: 'new-screenplay',
    section: 'File',
    label: () => 'New Screenplay',
    keybinding: 'newScreenplay',
    keywords: ['create', 'add', 'blank', 'draft'],
    run: (ctx) => ctx.runLibrary('createItem'),
  },
  {
    id: 'new-breakdown',
    section: 'File',
    label: () => 'New Breakdown',
    keybinding: 'newBreakdown',
    keywords: ['create', 'project', 'schedule'],
    run: (ctx) => ctx.navigate('/breakdowns/new'),
  },
  {
    id: 'import-screenplay',
    section: 'File',
    label: () => 'Import Screenplay…',
    keybinding: 'importScreenplay',
    keywords: ['fountain', 'final draft', 'fdx', 'open file'],
    run: (ctx) => ctx.runLibrary('importItem'),
  },
  {
    id: 'export-screenplay',
    section: 'File',
    label: () => 'Export Screenplay…',
    keybinding: 'exportScreenplay',
    keywords: ['download', 'fountain', 'save as'],
    enabled: (ctx) => hasObjects(ctx, 'exportObject'),
    run: (ctx) => ctx.openPalette('export'),
  },
  {
    id: 'rename-item',
    section: 'File',
    label: (ctx) => `Rename ${ctx.library?.singular ?? 'Item'}…`,
    keywords: ['title', 'retitle'],
    enabled: (ctx) => hasObjects(ctx, 'renameObject'),
    run: (ctx) => ctx.openPalette('rename'),
  },
  {
    id: 'move-to-trash',
    section: 'File',
    label: () => 'Move to Trash…',
    keybinding: 'moveToTrash',
    keywords: ['delete', 'remove', 'discard'],
    enabled: (ctx) => hasObjects(ctx, 'trashObject'),
    run: (ctx) => ctx.openPalette('trash'),
  },
  {
    id: 'sign-out',
    section: 'File',
    label: () => 'Sign Out',
    keywords: ['log out', 'session'],
    run: (ctx) => ctx.logout(),
  },
];

const editCommands: readonly DashboardCommand[] = [
  {
    id: 'find-in-library',
    section: 'Edit',
    label: (ctx) => `Find in ${titleCase(ctx.library?.noun ?? 'Library')}`,
    keybinding: 'find',
    keywords: ['search', 'filter'],
    enabled: (ctx) => Boolean(ctx.library?.focusSearch),
    run: (ctx) => ctx.runLibrary('focusSearch'),
  },
  {
    id: 'preferences',
    section: 'Edit',
    label: () => 'Preferences…',
    keybinding: 'preferences',
    keywords: ['settings', 'options', 'account'],
    run: (ctx) => ctx.navigate('/account/preferences'),
  },
];

const themeCommands: readonly DashboardCommand[] = themes.map((entry) => ({
  id: `theme-${entry.id}`,
  section: 'Theme',
  label: () => entry.label,
  keywords: ['appearance', 'colour', 'color', 'dark', 'light'],
  checked: (ctx) => ctx.theme === entry.id,
  current: (ctx) => ctx.theme === entry.id,
  run: (ctx) => ctx.chooseTheme(entry.id),
}));

const viewCommands: readonly DashboardCommand[] = [
  {
    id: 'command-palette',
    section: 'View',
    label: () => 'Command Palette…',
    keybinding: 'commandPalette',
    keywords: ['commands', 'run', 'search', 'quick open'],
    run: (ctx) => ctx.openPalette('all'),
  },
  {
    id: 'toggle-rail',
    section: 'View',
    label: (ctx) => (ctx.railCollapsed ? 'Show Sidebar' : 'Hide Sidebar'),
    keybinding: 'toggleSidebar',
    keywords: ['rail', 'navigation', 'collapse', 'expand'],
    run: (ctx) => ctx.toggleRail(),
  },
  {
    id: 'refresh-library',
    section: 'View',
    label: (ctx) => `Refresh ${titleCase(ctx.library?.noun ?? 'Library')}`,
    keywords: ['reload', 'sync', 'fetch'],
    enabled: (ctx) => Boolean(ctx.library?.refresh),
    run: (ctx) => ctx.runLibrary('refresh'),
  },
  {
    id: 'fullscreen',
    section: 'View',
    label: (ctx) => (ctx.isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'),
    keybinding: 'toggleFullscreen',
    keywords: ['window', 'maximise', 'maximize'],
    run: (ctx) => ctx.toggleFullscreen(),
  },
];

/**
 * Navigation commands derived from the rail declarations, so the Go menu and the palette can never
 * drift from the sidebar. Administration entries disappear entirely for non-administrators rather
 * than rendering as dead rows.
 */
export const goCommandGroups: readonly {
  id: string;
  label: string;
  commands: readonly DashboardCommand[];
}[] = railGroups.map((group) => ({
  id: group.id,
  label: group.label,
  commands: group.items.map((item) => ({
    id: `go-${group.id}-${item.id}`,
    section: `Go to ${group.label}`,
    label: () => item.label,
    keywords: item.crumbs,
    visible: (ctx: DashboardCommandContext) => !group.adminOnly || ctx.isAdministrator,
    current: (ctx: DashboardCommandContext) => item.isActive(ctx.route),
    run: (ctx: DashboardCommandContext) => ctx.navigate(item.path),
  })),
}));

const helpCommands: readonly DashboardCommand[] = [
  {
    id: 'docs',
    section: 'Help',
    label: () => 'Documentation',
    keywords: ['manual', 'guide', 'help'],
    run: (ctx) => ctx.openExternal(DOCS_URL),
  },
  {
    id: 'github',
    section: 'Help',
    label: () => 'GitHub',
    keywords: ['source', 'repository'],
    run: (ctx) => ctx.openExternal(GITHUB_URL),
  },
  {
    id: 'report-issue',
    section: 'Help',
    label: () => 'Report an Issue',
    keywords: ['bug', 'feedback', 'support'],
    run: (ctx) => ctx.openExternal(ISSUES_URL),
  },
];

/** Every dashboard command, in menu order. The menu bar and the palette both project this list. */
export const dashboardCommands: readonly DashboardCommand[] = [
  ...fileCommands,
  ...editCommands,
  ...themeCommands,
  ...viewCommands,
  ...goCommandGroups.flatMap((group) => group.commands),
  ...helpCommands,
];

const commandsById = new Map(dashboardCommands.map((command) => [command.id, command]));

export function dashboardCommand(id: string): DashboardCommand {
  const command = commandsById.get(id);
  if (!command) throw new Error(`Unknown dashboard command: ${id}`);
  return command;
}

export function isCommandVisible(command: DashboardCommand, ctx: DashboardCommandContext): boolean {
  return command.visible?.(ctx) ?? true;
}

export function isCommandEnabled(command: DashboardCommand, ctx: DashboardCommandContext): boolean {
  return command.enabled?.(ctx) ?? true;
}
