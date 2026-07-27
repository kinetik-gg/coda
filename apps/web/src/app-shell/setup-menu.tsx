import { themes, type ThemeId } from '../themes';
import { commandItems, type ApplicationCommand } from './application-command';
import {
  commandPaletteCommand,
  fullscreenCommand,
  helpCommands,
  helpMenu,
  signOutCommand,
  type CommonApplicationCommandContext,
} from './common-commands';
import type { MenuBarModel, MenuNode } from './menu-bar';

export interface SetupMenuContext extends CommonApplicationCommandContext {
  surface: 'setup';
  theme: ThemeId;
  isFullscreen: boolean;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  logout: () => void;
}

export type SetupCommand = ApplicationCommand<SetupMenuContext>;
type SetupNode = MenuNode<SetupMenuContext>;

const themeCommands: readonly SetupCommand[] = themes.map((entry) => ({
  id: `theme-${entry.id}`,
  section: 'Theme',
  label: () => entry.label,
  checked: (ctx) => ctx.theme === entry.id,
  current: (ctx) => ctx.theme === entry.id,
  run: (ctx) => ctx.chooseTheme(entry.id),
}));

export const setupCommands: readonly SetupCommand[] = [
  {
    id: 'screenplays',
    section: 'File',
    label: () => 'Screenplays',
    run: (ctx) => ctx.navigate('/'),
  },
  {
    id: 'breakdowns',
    section: 'File',
    label: () => 'Breakdowns',
    run: (ctx) => ctx.navigate('/breakdowns'),
  },
  signOutCommand<SetupMenuContext>(),
  ...themeCommands,
  commandPaletteCommand<SetupMenuContext>(),
  fullscreenCommand<SetupMenuContext>(),
  ...helpCommands<SetupMenuContext>(),
];

const items = (...ids: string[]) => commandItems(setupCommands, ...ids);
const themeSubmenu: SetupNode = {
  kind: 'submenu',
  id: 'theme',
  label: 'Theme',
  items: items(...themes.map((entry) => `theme-${entry.id}`)),
};

export const setupMenuBarModel: MenuBarModel<SetupMenuContext> = {
  ariaLabel: 'Application menu',
  menus: [
    {
      id: 'file',
      label: 'File',
      items: items('screenplays', 'breakdowns', '---', 'sign-out'),
    },
    {
      id: 'edit',
      label: 'Edit',
      items: (): SetupNode[] => [themeSubmenu],
    },
    {
      id: 'view',
      label: 'View',
      items: items('command-palette', '---', 'fullscreen'),
    },
    helpMenu(setupCommands),
  ],
};
