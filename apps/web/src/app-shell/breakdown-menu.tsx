import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { dispatchAppAction } from '../keybindings';
import { themes, type ThemeId } from '../themes';
import appStyles from '../App.styles';
import { commandItems, commandNode, type ApplicationCommand } from './application-command';
import {
  commandPaletteCommand,
  fullscreenCommand,
  helpCommands,
  helpMenu,
  shareCommand,
  signOutCommand,
  type CommonApplicationCommandContext,
} from './common-commands';
import type { MenuBarModel, MenuNode } from './menu-bar';

export interface ProjectSummary {
  id: string;
  name: string;
  currentMembership?: {
    role: { permissions: Array<{ permission: string }> };
  } | null;
}

export interface BreakdownMenuContext extends CommonApplicationCommandContext {
  surface: 'breakdown';
  workspaceId: string;
  currentProject?: ProjectSummary;
  projects?: ProjectSummary[];
  displayName?: string;
  theme: ThemeId;
  isFullscreen: boolean;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  logout: () => void;
  openShare: () => void;
  openManage: () => void;
  canManage: boolean;
  requestResetWorkspace: () => void;
  requestPublishWorkspace: () => void;
}

export type BreakdownCommand = ApplicationCommand<BreakdownMenuContext>;
type BreakdownNode = MenuNode<BreakdownMenuContext>;

function dispatchedCommand(
  id: string,
  section: string,
  label: string,
  action: 'zoomIn' | 'zoomOut' | 'zoomReset' | 'textIncrease' | 'textDecrease' | 'textReset',
  keybinding?: 'zoomIn' | 'zoomOut' | 'zoomReset',
): BreakdownCommand {
  return {
    id,
    section,
    label: () => label,
    keybinding,
    dismissOnSelect: false,
    run: () => dispatchAppAction(action),
  };
}

const themeCommands: readonly BreakdownCommand[] = themes.map((entry) => ({
  id: `theme-${entry.id}`,
  section: 'Theme',
  label: () => entry.label,
  checked: (ctx) => entry.id === ctx.theme,
  current: (ctx) => entry.id === ctx.theme,
  keywords: ['appearance', 'colour', 'color', 'dark', 'light'],
  run: (ctx) => ctx.chooseTheme(entry.id),
}));

export const breakdownCommands: readonly BreakdownCommand[] = [
  {
    id: 'screenplays',
    section: 'File',
    label: () => 'Screenplays',
    keywords: ['library', 'home'],
    run: (ctx) => ctx.navigate('/'),
  },
  {
    id: 'new-breakdown',
    section: 'File',
    label: () => 'New Breakdown',
    keybinding: 'newBreakdown',
    run: (ctx) => ctx.navigate('/breakdowns/new'),
  },
  signOutCommand<BreakdownMenuContext>(),
  {
    id: 'undo',
    section: 'Edit',
    label: () => 'Undo',
    keybinding: 'undoItem',
    run: () => dispatchAppAction('undoItem'),
  },
  {
    id: 'redo',
    section: 'Edit',
    label: () => 'Redo',
    keybinding: 'redoItem',
    run: () => dispatchAppAction('redoItem'),
  },
  ...themeCommands,
  commandPaletteCommand<BreakdownMenuContext>(),
  dispatchedCommand('zoom-in', 'View', 'Zoom In', 'zoomIn', 'zoomIn'),
  dispatchedCommand('zoom-out', 'View', 'Zoom Out', 'zoomOut', 'zoomOut'),
  dispatchedCommand('zoom-reset', 'View', 'Actual Size', 'zoomReset', 'zoomReset'),
  dispatchedCommand('text-increase', 'View', 'Increase Text Size', 'textIncrease'),
  dispatchedCommand('text-decrease', 'View', 'Decrease Text Size', 'textDecrease'),
  dispatchedCommand('text-reset', 'View', 'Reset Text Size', 'textReset'),
  fullscreenCommand<BreakdownMenuContext>(),
  {
    id: 'reset-workspace',
    section: 'Workspace',
    label: () => 'Reset Workspace…',
    keywords: ['layout', 'default'],
    run: (ctx) => ctx.requestResetWorkspace(),
  },
  {
    id: 'publish-workspace',
    section: 'Workspace',
    label: () => 'Publish Default…',
    keywords: ['layout', 'team', 'members'],
    run: (ctx) => ctx.requestPublishWorkspace(),
  },
  shareCommand<BreakdownMenuContext>(),
  {
    id: 'breakdown-settings',
    section: 'Breakdown',
    label: () => 'Manage breakdown…',
    enabled: (ctx) => ctx.canManage,
    disabledReason: (ctx) =>
      ctx.canManage ? undefined : 'You do not have permission to manage this breakdown.',
    run: (ctx) => ctx.openManage(),
  },
  {
    id: 'account-settings',
    section: 'Account',
    label: () => 'Account Settings',
    run: (ctx) => ctx.navigate('/account'),
  },
  ...helpCommands<BreakdownMenuContext>(),
];

const commandsById = new Map(breakdownCommands.map((command) => [command.id, command]));

function breakdownCommand(id: string): BreakdownCommand {
  const command = commandsById.get(id);
  if (!command) throw new Error(`Unknown breakdown command: ${id}`);
  return command;
}

function items(...ids: string[]): (ctx: BreakdownMenuContext) => BreakdownNode[] {
  return commandItems(breakdownCommands, ...ids);
}

const themeSubmenu: BreakdownNode = {
  kind: 'submenu',
  id: 'theme',
  label: 'Theme',
  items: items(...themes.map((entry) => `theme-${entry.id}`)),
};

function projectItems(ctx: BreakdownMenuContext): BreakdownNode[] {
  return (ctx.projects ?? []).map((project) => ({
    kind: 'action',
    id: `project-${project.id}`,
    label: project.name,
    run: (context) => context.navigate(`/breakdowns/${project.id}`),
  }));
}

export const breakdownMenuBarModel: MenuBarModel<BreakdownMenuContext> = {
  ariaLabel: 'Application menu',
  menus: [
    {
      id: 'file',
      label: 'File',
      items: items('screenplays', 'new-breakdown', '---', 'sign-out'),
    },
    {
      id: 'edit',
      label: 'Edit',
      items: (ctx) => [...items('undo', 'redo', '---')(ctx), themeSubmenu],
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
        'text-increase',
        'text-decrease',
        'text-reset',
        '---',
        'fullscreen',
      ),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      items: items('reset-workspace', 'publish-workspace'),
    },
    helpMenu(breakdownCommands),
    {
      id: 'project',
      align: 'end',
      className: appStyles.projectMenu,
      popupClassName: appStyles.projectMenuPopup,
      label: (ctx) => (
        <>
          <FilmReelIcon size={12} aria-hidden="true" />
          <span>{ctx.currentProject?.name ?? 'Breakdown'}</span>
          <CaretUpDownIcon className={appStyles.projectMenuCaret} size={12} aria-hidden="true" />
        </>
      ),
      items: (ctx) => [
        commandNode(breakdownCommand('share')),
        commandNode(breakdownCommand('breakdown-settings')),
        { kind: 'separator', id: 'project-sep-1' },
        ...projectItems(ctx),
        { kind: 'separator', id: 'project-sep-2' },
        commandNode(breakdownCommand('account-settings')),
        commandNode(breakdownCommand('sign-out')),
      ],
    },
  ],
};
