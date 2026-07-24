import type { ReactNode } from 'react';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import { dispatchAppAction } from '../keybindings';
import { themes, type ThemeId } from '../themes';
import appStyles from '../App.styles';
import type { MenuBarModel, MenuNode } from './menu-bar';

export interface ProjectSummary {
  id: string;
  name: string;
}

/**
 * The breakdown editor's menu-bar context: everything the declarative model
 * needs to label, enable, and run its items for the workspace being edited.
 */
export interface BreakdownMenuContext {
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
}

type BreakdownNode = MenuNode<BreakdownMenuContext>;

function iconItem(icon: ReactNode, text: string): ReactNode {
  return (
    <span className={appStyles.menuItemWithIcon}>
      {icon} {text}
    </span>
  );
}

function themeItems(): BreakdownNode[] {
  return themes.map((entry) => ({
    kind: 'action',
    id: `theme-${entry.id}`,
    ariaCurrent: (ctx) => entry.id === ctx.theme,
    run: (ctx) => ctx.chooseTheme(entry.id),
    label: (ctx) => (
      <span className={appStyles.themeMenuOption}>
        <span className={appStyles.themeMenuCheck} aria-hidden="true">
          {entry.id === ctx.theme && <CheckIcon size={12} weight="bold" />}
        </span>
        <span>{entry.label}</span>
      </span>
    ),
  }));
}

function projectItems(ctx: BreakdownMenuContext): BreakdownNode[] {
  return (ctx.projects ?? []).map((project) => ({
    kind: 'action',
    id: `project-${project.id}`,
    label: project.name,
    run: (context) => context.navigate(`/breakdowns/${project.id}`),
  }));
}

function dispatchItem(
  id: string,
  label: string,
  action: 'zoomIn' | 'zoomOut' | 'zoomReset' | 'textIncrease' | 'textDecrease' | 'textReset',
  keybinding?: 'zoomIn' | 'zoomOut' | 'zoomReset',
): BreakdownNode {
  return {
    kind: 'action',
    id,
    label,
    keybinding,
    dismissOnSelect: false,
    run: () => dispatchAppAction(action),
  };
}

const zoomItems: BreakdownNode[] = [
  dispatchItem('zoom-in', 'Zoom In', 'zoomIn', 'zoomIn'),
  dispatchItem('zoom-out', 'Zoom Out', 'zoomOut', 'zoomOut'),
  dispatchItem('zoom-reset', 'Actual Size', 'zoomReset', 'zoomReset'),
];

const textItems: BreakdownNode[] = [
  dispatchItem('text-increase', 'Increase text size', 'textIncrease'),
  dispatchItem('text-decrease', 'Decrease text size', 'textDecrease'),
  dispatchItem('text-reset', 'Reset text size', 'textReset'),
];

function workspaceEvent(name: string) {
  return () => window.dispatchEvent(new CustomEvent(name));
}

/**
 * The breakdown masthead, declared as data. Shares File/Edit/View semantics
 * with the screenplay editor; `Workspace` is the breakdown-specific menu, and
 * the end-aligned project chip preserves the project switcher and identity
 * rows verbatim.
 */
export const breakdownMenuBarModel: MenuBarModel<BreakdownMenuContext> = {
  ariaLabel: 'Application menu',
  menus: [
    {
      id: 'file',
      label: 'File',
      items: () => [
        { kind: 'action', id: 'screenplays', label: 'Screenplays', run: (c) => c.navigate('/') },
        {
          kind: 'action',
          id: 'new-breakdown',
          label: 'New breakdown',
          run: (c) => c.navigate('/breakdowns/new'),
        },
        { kind: 'separator', id: 'file-sep' },
        {
          kind: 'action',
          id: 'sign-out',
          label: iconItem(<SignOutIcon size={12} aria-hidden="true" />, 'Sign out'),
          run: (c) => c.logout(),
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        {
          kind: 'action',
          id: 'undo',
          label: 'Undo',
          keybinding: 'undoItem',
          run: () => dispatchAppAction('undoItem'),
        },
        {
          kind: 'action',
          id: 'redo',
          label: 'Redo',
          keybinding: 'redoItem',
          run: () => dispatchAppAction('redoItem'),
        },
        { kind: 'separator', id: 'edit-sep' },
        { kind: 'submenu', id: 'theme', label: 'Theme', items: themeItems },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: () => [
        ...zoomItems,
        { kind: 'separator', id: 'view-sep-1' },
        ...textItems,
        { kind: 'separator', id: 'view-sep-2' },
        {
          kind: 'action',
          id: 'fullscreen',
          label: (c) => (c.isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'),
          keybinding: 'toggleFullscreen',
          run: (c) => c.toggleFullscreen(),
        },
      ],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      items: () => [
        {
          kind: 'action',
          id: 'reset-workspace',
          label: 'Reset workspace',
          run: workspaceEvent('coda:reset-workspace'),
        },
        {
          kind: 'action',
          id: 'publish-workspace',
          label: 'Publish default',
          run: workspaceEvent('coda:publish-workspace'),
        },
      ],
    },
    {
      id: 'project',
      align: 'end',
      className: appStyles.projectMenu,
      popupClassName: appStyles.projectMenuPopup,
      label: (c) => (
        <>
          <FilmReelIcon size={12} aria-hidden="true" />
          <span>{c.currentProject?.name ?? 'Breakdown'}</span>
          <CaretUpDownIcon className={appStyles.projectMenuCaret} size={12} aria-hidden="true" />
        </>
      ),
      items: (c) => [
        {
          kind: 'action',
          id: 'manage-breakdown',
          label: 'Manage current breakdown',
          run: (context) => context.navigate(`/breakdowns/${context.workspaceId}/manage`),
        },
        { kind: 'separator', id: 'project-sep-1' },
        ...projectItems(c),
        { kind: 'separator', id: 'project-sep-2' },
        {
          kind: 'custom',
          id: 'account-name',
          render: (context) => (
            <span role="presentation" className={appStyles.accountName}>
              {context.displayName}
            </span>
          ),
        },
        {
          kind: 'action',
          id: 'account-settings',
          label: iconItem(<UserCircleIcon size={12} aria-hidden="true" />, 'Account settings'),
          run: (context) => context.navigate('/account'),
        },
        {
          kind: 'action',
          id: 'project-sign-out',
          label: iconItem(<SignOutIcon size={12} aria-hidden="true" />, 'Sign out'),
          run: (context) => context.logout(),
        },
      ],
    },
  ],
};
