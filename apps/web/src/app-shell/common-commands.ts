import type { ApplicationCommand } from './application-command';
import { commandItems } from './application-command';
import type { MenuBarModel } from './menu-bar';

export const HELP_URLS = {
  documentation: 'https://kinetik-gg.github.io/coda-docs/',
  github: 'https://github.com/kinetik-gg/coda',
  issues: 'https://github.com/kinetik-gg/coda/issues',
} as const;

export type PaletteMode = 'all' | 'open' | 'rename' | 'export' | 'trash';

export interface CommonApplicationCommandContext {
  openExternal: (url: string) => void;
  openCredits: () => void;
  openPalette: (mode: PaletteMode) => void;
}

const helpCommandDefinitions: readonly ApplicationCommand<CommonApplicationCommandContext>[] = [
  {
    id: 'docs',
    section: 'Help',
    label: () => 'Documentation',
    keywords: ['manual', 'guide', 'help'],
    run: (ctx) => ctx.openExternal(HELP_URLS.documentation),
  },
  {
    id: 'github',
    section: 'Help',
    label: () => 'GitHub',
    keywords: ['source', 'repository'],
    run: (ctx) => ctx.openExternal(HELP_URLS.github),
  },
  {
    id: 'credits',
    section: 'Help',
    label: () => 'Open Source Credits…',
    keywords: ['licenses', 'acknowledgements', 'third party', 'software'],
    run: (ctx) => ctx.openCredits(),
  },
  {
    id: 'report-issue',
    section: 'Help',
    label: () => 'Report an Issue',
    keywords: ['bug', 'feedback', 'support'],
    run: (ctx) => ctx.openExternal(HELP_URLS.issues),
  },
];

/**
 * The universal Help command set. The cast is safe because every application
 * surface context extends the exact callback contract these commands read.
 */
export function helpCommands<
  Ctx extends CommonApplicationCommandContext,
>(): readonly ApplicationCommand<Ctx>[] {
  return helpCommandDefinitions as readonly ApplicationCommand<Ctx>[];
}

export function helpMenu<Ctx extends CommonApplicationCommandContext>(
  commands: readonly ApplicationCommand<Ctx>[],
): MenuBarModel<Ctx>['menus'][number] {
  return {
    id: 'help',
    label: 'Help',
    items: commandItems(commands, 'docs', 'github', 'credits', '---', 'report-issue'),
  };
}

export function commandPaletteCommand<
  Ctx extends Pick<CommonApplicationCommandContext, 'openPalette'>,
>(): ApplicationCommand<Ctx> {
  return {
    id: 'command-palette',
    section: 'View',
    label: () => 'Command Palette…',
    keybinding: 'commandPalette',
    keywords: ['commands', 'run', 'search', 'quick open'],
    run: (ctx) => ctx.openPalette('all'),
  };
}

export function shareCommand<
  Ctx extends { canManage: boolean; openShare: () => void },
>(): ApplicationCommand<Ctx> {
  return {
    id: 'share',
    section: 'File',
    label: () => 'Share…',
    enabled: (ctx) => ctx.canManage,
    disabledReason: (ctx) => (ctx.canManage ? undefined : 'You do not have permission to share.'),
    run: (ctx) => ctx.openShare(),
  };
}

export function signOutCommand<Ctx extends { logout: () => void }>(): ApplicationCommand<Ctx> {
  return {
    id: 'sign-out',
    section: 'File',
    label: () => 'Sign Out',
    keywords: ['log out', 'session'],
    run: (ctx) => ctx.logout(),
  };
}

export function fullscreenCommand<
  Ctx extends { isFullscreen: boolean; toggleFullscreen: () => void },
>(): ApplicationCommand<Ctx> {
  return {
    id: 'fullscreen',
    section: 'View',
    label: (ctx) => (ctx.isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'),
    keybinding: 'toggleFullscreen',
    keywords: ['window', 'maximise', 'maximize'],
    run: (ctx) => ctx.toggleFullscreen(),
  };
}
