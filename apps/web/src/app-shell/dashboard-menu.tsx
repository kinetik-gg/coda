import { themes } from '../themes';
import {
  dashboardCommand,
  goCommandGroups,
  isCommandEnabled,
  isCommandVisible,
  type DashboardCommand,
  type DashboardCommandContext,
} from './dashboard-commands';
import type { MenuBarModel, MenuNode } from './menu-bar';

/**
 * The authenticated dashboard's menu-bar context. Mirrors the editor menu contexts
 * ({@link ./breakdown-menu}, {@link ../screenplays/screenplay-menu}): everything the declarative
 * model needs to label, enable, and run its items, expressed as plain data and callbacks.
 *
 * The dashboard's context is the shared {@link DashboardCommandContext}, because the menu bar is
 * one of two projections of the command registry — the ⌘K palette is the other.
 */
export type DashboardMenuContext = DashboardCommandContext;

type DashboardNode = MenuNode<DashboardMenuContext>;

/** Lifts a registered command into a menu node. Labels, enablement, and checked state stay in the
 * registry, so the menu can never disagree with the palette about what a command is called or
 * whether it can run. */
function commandNode(command: DashboardCommand): DashboardNode {
  return {
    kind: 'action',
    id: command.id,
    label: (ctx) => command.label(ctx),
    ...(command.keybinding ? { keybinding: command.keybinding } : {}),
    enabled: (ctx) => isCommandEnabled(command, ctx),
    ...(command.checked ? { checked: command.checked } : {}),
    ...(command.current ? { ariaCurrent: command.current } : {}),
    run: (ctx) => command.run(ctx),
  };
}

/** Menu items, declared as command ids with `---` marking a separator. */
function items(...ids: string[]): (ctx: DashboardMenuContext) => DashboardNode[] {
  return (ctx) => {
    const nodes: DashboardNode[] = [];
    ids.forEach((id, index) => {
      if (id === '---') {
        nodes.push({ kind: 'separator', id: `separator-${index}` });
        return;
      }
      const command = dashboardCommand(id);
      if (isCommandVisible(command, ctx)) nodes.push(commandNode(command));
    });
    return nodes;
  };
}

const themeSubmenu: DashboardNode = {
  kind: 'submenu',
  id: 'theme',
  label: 'Theme',
  items: items(...themes.map((entry) => `theme-${entry.id}`)),
};

const fileMenu = {
  id: 'file',
  label: 'File',
  items: items(
    'new-screenplay',
    'new-breakdown',
    '---',
    'import-screenplay',
    'export-screenplay',
    '---',
    'rename-item',
    'move-to-trash',
    '---',
    'sign-out',
  ),
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const editMenu = {
  id: 'edit',
  label: 'Edit',
  items: (ctx: DashboardMenuContext): DashboardNode[] => [
    ...items('find-in-library', '---')(ctx),
    themeSubmenu,
    ...items('---', 'preferences')(ctx),
  ],
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const viewMenu = {
  id: 'view',
  label: 'View',
  items: items('command-palette', '---', 'toggle-rail', 'refresh-library', '---', 'fullscreen'),
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

/**
 * `Go` mirrors the rail one submenu per group, derived from the same declarations — the Finder
 * convention, where the menu and the sidebar are two views of one place list.
 */
const goMenu = {
  id: 'go',
  label: 'Go',
  items: (ctx: DashboardMenuContext): DashboardNode[] =>
    goCommandGroups
      .filter((group) => group.commands.some((command) => isCommandVisible(command, ctx)))
      .map((group) => ({
        kind: 'submenu',
        id: `go-${group.id}`,
        label: group.label,
        items: items(...group.commands.map((command) => command.id)),
      })),
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const helpMenu = {
  id: 'help',
  label: 'Help',
  items: items('docs', 'github', '---', 'report-issue'),
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

/**
 * The dashboard masthead, declared as data. A library surface owns real commands — creating,
 * importing, exporting, renaming, and trashing documents; moving between places; changing the
 * view — so the menu carries them rather than standing in as editor-shaped decoration. Handlers
 * for the document commands come from whichever surface is mounted (see {@link ./library-target}),
 * which is why they grey out on surfaces that cannot service them.
 */
export const dashboardMenuBarModel: MenuBarModel<DashboardMenuContext> = {
  ariaLabel: 'Application menu',
  menus: [fileMenu, editMenu, viewMenu, goMenu, helpMenu],
};
