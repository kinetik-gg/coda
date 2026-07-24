import type { ReactNode } from 'react';
import type { KeybindingId } from '../../keybindings';

/**
 * Declarative application menu-bar model.
 *
 * A menu bar is data: a list of top-level menus, each resolving to a list of
 * nodes for the current editor context. One controller component
 * ({@link ../MenuBar}) renders any model and owns the full keyboard-navigation
 * behaviour, so porting an editor — or adding a future dashboard shell — is
 * purely a matter of declaring another {@link MenuBarModel}.
 *
 * `Ctx` is the editor-supplied menu context (current document/project,
 * selection, capabilities). Labels, enablement, and checked state are all
 * pure functions of it, which keeps enable/disable and dynamic labelling
 * declarative rather than wired imperatively per editor.
 */
export interface MenuBarModel<Ctx> {
  /** Accessible name for the `role="menubar"` container. */
  ariaLabel: string;
  menus: readonly MenuModel<Ctx>[];
}

export interface MenuModel<Ctx> {
  id: string;
  /** Trigger content: plain text, or a node (e.g. the project chip). */
  label: MenuLabel<Ctx>;
  ariaLabel?: string;
  align?: 'start' | 'end';
  className?: string;
  popupClassName?: string;
  /** Whether the menu is present at all for the current context. */
  visible?: (ctx: Ctx) => boolean;
  items: (ctx: Ctx) => readonly MenuNode<Ctx>[];
}

export type MenuLabel<Ctx> = ReactNode | ((ctx: Ctx) => ReactNode);

export type MenuNode<Ctx> =
  MenuActionNode<Ctx> | MenuSubmenuNode<Ctx> | MenuSeparatorNode | MenuCustomNode<Ctx>;

export interface MenuActionNode<Ctx> {
  kind: 'action';
  id: string;
  label: MenuLabel<Ctx>;
  /** Shortcut label reference resolved through the keybindings layer. */
  keybinding?: KeybindingId;
  /** Enablement predicate; omitted means always enabled. */
  enabled?: (ctx: Ctx) => boolean;
  /** Checkbox state; when defined the item renders as `menuitemcheckbox`. */
  checked?: (ctx: Ctx) => boolean;
  /** Marks the item as the current choice within a set (e.g. active theme). */
  ariaCurrent?: (ctx: Ctx) => boolean;
  /** Keep the menu open after selection (defaults to closing). */
  dismissOnSelect?: boolean;
  run: (ctx: Ctx) => void;
}

export interface MenuSubmenuNode<Ctx> {
  kind: 'submenu';
  id: string;
  label: MenuLabel<Ctx>;
  items: (ctx: Ctx) => readonly MenuNode<Ctx>[];
}

export interface MenuSeparatorNode {
  kind: 'separator';
  id: string;
}

/** Escape hatch for non-interactive presentation rows (e.g. account name). */
export interface MenuCustomNode<Ctx> {
  kind: 'custom';
  id: string;
  render: (ctx: Ctx) => ReactNode;
}

export function resolveLabel<Ctx>(label: MenuLabel<Ctx>, ctx: Ctx): ReactNode {
  return typeof label === 'function' ? (label as (ctx: Ctx) => ReactNode)(ctx) : label;
}
