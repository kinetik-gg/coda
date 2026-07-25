import { themes, type ThemeId } from '../themes';
import type { MenuBarModel, MenuNode } from './menu-bar';

/**
 * The authenticated dashboard's menu-bar context. Mirrors the editor menu
 * contexts ({@link ./breakdown-menu}, {@link ../screenplays/screenplay-menu}):
 * everything the declarative model needs to label, enable, and run its items,
 * expressed as plain data and callbacks. No editor document is in scope here —
 * the dashboard shell hosts the library, account, and administration surfaces.
 */
export interface DashboardMenuContext {
  theme: ThemeId;
  isFullscreen: boolean;
  railCollapsed: boolean;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  toggleRail: () => void;
  logout: () => void;
  /** Opens an external resource without a full-page navigation (Electron-safe). */
  openExternal: (url: string) => void;
}

type DashboardNode = MenuNode<DashboardMenuContext>;

const DOCS_URL = 'https://coda.github.io';
const GITHUB_URL = 'https://github.com/kinetik-gg/coda';

function themeItems(): DashboardNode[] {
  return themes.map((entry) => ({
    kind: 'action',
    id: `theme-${entry.id}`,
    label: entry.label,
    checked: (ctx) => ctx.theme === entry.id,
    ariaCurrent: (ctx) => ctx.theme === entry.id,
    run: (ctx) => ctx.chooseTheme(entry.id),
  }));
}

const fileMenu = {
  id: 'file',
  label: 'File',
  items: (): DashboardNode[] => [
    { kind: 'action', id: 'new-screenplay', label: 'New screenplay', run: (c) => c.navigate('/') },
    {
      kind: 'action',
      id: 'new-breakdown',
      label: 'New breakdown',
      run: (c) => c.navigate('/breakdowns/new'),
    },
    {
      kind: 'action',
      id: 'import-screenplay',
      label: 'Import screenplay…',
      run: (c) => c.navigate('/'),
    },
    { kind: 'separator', id: 'file-sep' },
    { kind: 'action', id: 'sign-out', label: 'Sign out', run: (c) => c.logout() },
  ],
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const editMenu = {
  id: 'edit',
  label: 'Edit',
  items: (): DashboardNode[] => [
    { kind: 'submenu', id: 'theme', label: 'Theme', items: themeItems },
  ],
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const viewMenu = {
  id: 'view',
  label: 'View',
  items: (): DashboardNode[] => [
    {
      kind: 'action',
      id: 'toggle-rail',
      label: (c) => (c.railCollapsed ? 'Show Sidebar' : 'Hide Sidebar'),
      run: (c) => c.toggleRail(),
    },
    { kind: 'separator', id: 'view-sep' },
    {
      kind: 'action',
      id: 'fullscreen',
      label: (c) => (c.isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'),
      keybinding: 'toggleFullscreen',
      run: (c) => c.toggleFullscreen(),
    },
  ],
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

const helpMenu = {
  id: 'help',
  label: 'Help',
  items: (): DashboardNode[] => [
    { kind: 'action', id: 'docs', label: 'Documentation', run: (c) => c.openExternal(DOCS_URL) },
    { kind: 'action', id: 'github', label: 'GitHub', run: (c) => c.openExternal(GITHUB_URL) },
  ],
} satisfies MenuBarModel<DashboardMenuContext>['menus'][number];

/**
 * The dashboard masthead, declared as data. Shares File/Edit/View semantics
 * with the editors; `Help` gathers the marketing-style Docs/GitHub links that
 * previously lived in the hand-rolled sidebar footer. The account/instance
 * chips and the user menu render in the trailing region as shell chrome.
 */
export const dashboardMenuBarModel: MenuBarModel<DashboardMenuContext> = {
  ariaLabel: 'Application menu',
  menus: [fileMenu, editMenu, viewMenu, helpMenu],
};
