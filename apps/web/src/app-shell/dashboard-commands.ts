import { themes, type ThemeId } from '../themes';
import { isCommandEnabled, isCommandVisible, type ApplicationCommand } from './application-command';
import {
  commandPaletteCommand,
  fullscreenCommand,
  helpCommands,
  signOutCommand,
  type CommonApplicationCommandContext,
} from './common-commands';
import type { LibraryCapability, LibrarySurfaceCapability, LibraryTarget } from './library-target';
import { navGroups } from './nav-model';

export type { PaletteMode } from './common-commands';
export { isCommandEnabled, isCommandVisible } from './application-command';

/**
 * Everything the dashboard's commands need to label, enable, and run. The
 * menu bar and command palette are projections of this same context.
 */
export interface DashboardCommandContext extends CommonApplicationCommandContext {
  surface: 'dashboard';
  route: string;
  theme: ThemeId;
  isFullscreen: boolean;
  railCollapsed: boolean;
  isAdministrator: boolean;
  displayName?: string;
  updateAvailable: boolean;
  library?: LibraryTarget;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  toggleRail: () => void;
  logout: () => void;
  runLibrary: (capability: LibrarySurfaceCapability) => void;
}

export type DashboardCommand = ApplicationCommand<DashboardCommandContext>;

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
    visible: (ctx) => Boolean(ctx.library?.exportObject),
    enabled: (ctx) => hasObjects(ctx, 'exportObject'),
    disabledReason: (ctx) =>
      hasObjects(ctx, 'exportObject') ? undefined : 'No screenplays are available to export.',
    run: (ctx) => ctx.openPalette('export'),
  },
  {
    id: 'rename-item',
    section: 'File',
    label: (ctx) => `Rename ${ctx.library?.singular ?? 'Item'}…`,
    keywords: ['title', 'retitle'],
    visible: (ctx) => Boolean(ctx.library?.renameObject),
    enabled: (ctx) => hasObjects(ctx, 'renameObject'),
    disabledReason: (ctx) =>
      hasObjects(ctx, 'renameObject') ? undefined : 'No items are available to rename.',
    run: (ctx) => ctx.openPalette('rename'),
  },
  {
    id: 'move-to-trash',
    section: 'File',
    label: () => 'Move to Trash…',
    keybinding: 'moveToTrash',
    keywords: ['delete', 'remove', 'discard'],
    visible: (ctx) => Boolean(ctx.library?.trashObject),
    enabled: (ctx) => hasObjects(ctx, 'trashObject'),
    disabledReason: (ctx) =>
      hasObjects(ctx, 'trashObject') ? undefined : 'No items are available to move to trash.',
    run: (ctx) => ctx.openPalette('trash'),
  },
  signOutCommand<DashboardCommandContext>(),
];

const editCommands: readonly DashboardCommand[] = [
  {
    id: 'find-in-library',
    section: 'Edit',
    label: (ctx) => `Find in ${titleCase(ctx.library?.noun ?? 'Library')}`,
    keybinding: 'find',
    keywords: ['search', 'filter'],
    visible: (ctx) => Boolean(ctx.library?.focusSearch),
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
  commandPaletteCommand<DashboardCommandContext>(),
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
    visible: (ctx) => Boolean(ctx.library?.refresh),
    run: (ctx) => ctx.runLibrary('refresh'),
  },
  fullscreenCommand<DashboardCommandContext>(),
];

/**
 * Navigation commands are derived from the same declarations as the rail, so
 * Go and the palette stay complete as dashboard routes evolve.
 */
export const goCommandGroups: readonly {
  id: string;
  label: string;
  commands: readonly DashboardCommand[];
}[] = navGroups.map((group) => ({
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

/** Every dashboard command, in menu order. */
export const dashboardCommands: readonly DashboardCommand[] = [
  ...fileCommands,
  ...editCommands,
  ...themeCommands,
  ...viewCommands,
  ...goCommandGroups.flatMap((group) => group.commands),
  ...helpCommands<DashboardCommandContext>(),
];

const commandsById = new Map(dashboardCommands.map((command) => [command.id, command]));

export function dashboardCommand(id: string): DashboardCommand {
  const command = commandsById.get(id);
  if (!command) throw new Error(`Unknown dashboard command: ${id}`);
  return command;
}

/** Narrows the re-exported generic helpers for callers that prefer dashboard names. */
export function isDashboardCommandVisible(
  command: DashboardCommand,
  ctx: DashboardCommandContext,
): boolean {
  return isCommandVisible(command, ctx);
}

export function isDashboardCommandEnabled(
  command: DashboardCommand,
  ctx: DashboardCommandContext,
): boolean {
  return isCommandEnabled(command, ctx);
}
