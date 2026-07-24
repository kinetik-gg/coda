import { Fragment, type ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/DropdownMenu';
import { getKeybindingLabel } from '../../keybindings';
import appStyles from '../../App.styles';
import {
  resolveLabel,
  type MenuBarModel,
  type MenuModel,
  type MenuNode,
  type MenuSubmenuNode,
} from './menu-model';
import { useMenuBar, type MenuBarController } from './use-menu-bar';

interface MenuBarProps<Ctx> {
  model: MenuBarModel<Ctx>;
  context: Ctx;
  className?: string;
  trailingClassName?: string;
  /** Extra class merged onto every menu popup (e.g. an editor z-index tweak). */
  popupClassName?: string;
  /** Enable global keybinding dispatch (breakdown masthead behaviour). */
  globalActions?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

function ariaText(label: ReactNode, fallback: string): string {
  return typeof label === 'string' ? label : fallback;
}

function Submenu<Ctx>({
  node,
  ctx,
  controller,
}: {
  node: MenuSubmenuNode<Ctx>;
  ctx: Ctx;
  controller: MenuBarController;
}) {
  const open = controller.openSubmenuId === node.id;
  const label = resolveLabel(node.label, ctx);
  return (
    <div
      className={appStyles.appSubmenu}
      data-app-submenu={node.id}
      onPointerEnter={() => controller.openSubmenu(node.id, false)}
      onPointerLeave={controller.scheduleSubmenuClose}
    >
      <button
        ref={controller.registrars.submenuTrigger(node.id)}
        type="button"
        role="menuitem"
        className={appStyles.appSubmenuTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => controller.openSubmenu(node.id, true)}
        onKeyDown={(event) => controller.handleSubmenuTriggerKeyDown(node.id, event)}
      >
        <span>{label}</span>
        <CaretRightIcon size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={controller.registrars.submenuPopup(node.id)}
          role="menu"
          aria-label={ariaText(label, node.id)}
          className={appStyles.appSubmenuPopup}
          onPointerEnter={controller.cancelSubmenuClose}
          onPointerLeave={controller.scheduleSubmenuClose}
          onKeyDown={(event) => controller.handleSubmenuMenuKeyDown(node.id, event)}
        >
          {renderNodes(node.items(ctx), ctx, controller)}
        </div>
      )}
    </div>
  );
}

function renderNodes<Ctx>(
  nodes: readonly MenuNode<Ctx>[],
  ctx: Ctx,
  controller: MenuBarController,
): ReactNode {
  return nodes.map((node) => {
    if (node.kind === 'separator') return <DropdownMenuSeparator key={node.id} />;
    if (node.kind === 'custom') return <Fragment key={node.id}>{node.render(ctx)}</Fragment>;
    if (node.kind === 'submenu')
      return <Submenu key={node.id} node={node} ctx={ctx} controller={controller} />;
    return (
      <DropdownMenuItem
        key={node.id}
        dismiss={controller.dismiss}
        dismissOnSelect={node.dismissOnSelect ?? true}
        disabled={node.enabled ? !node.enabled(ctx) : undefined}
        checked={node.checked?.(ctx)}
        ariaCurrent={node.ariaCurrent?.(ctx)}
        shortcut={node.keybinding ? getKeybindingLabel(node.keybinding) : undefined}
        onSelect={() => node.run(ctx)}
      >
        {resolveLabel(node.label, ctx)}
      </DropdownMenuItem>
    );
  });
}

function MenuButton<Ctx>({
  menu,
  ctx,
  controller,
  sharedPopupClassName,
}: {
  menu: MenuModel<Ctx>;
  ctx: Ctx;
  controller: MenuBarController;
  sharedPopupClassName?: string;
}) {
  const label = resolveLabel(menu.label, ctx);
  return (
    <DropdownMenu
      id={`app-menu-${menu.id}`}
      label={label}
      ariaLabel={menu.ariaLabel}
      open={controller.openMenuId === menu.id}
      className={`${appStyles.appMenu} ${menu.className ?? ''}`}
      triggerClassName={appStyles.menuTrigger}
      popupClassName={`${appStyles.appMenuPopup} ${sharedPopupClassName ?? ''} ${menu.popupClassName ?? ''}`}
      align={menu.align ?? 'start'}
      rootRole="none"
      triggerRole="menuitem"
      triggerRef={controller.registrars.trigger(menu.id)}
      popupRef={controller.registrars.popup(menu.id)}
      onToggle={() => controller.toggleMenu(menu.id)}
      onTriggerKeyDown={(event) => controller.handleTriggerKeyDown(menu.id, event)}
      onMenuKeyDown={(event) => controller.handleMenuKeyDown(menu.id, event)}
    >
      {renderNodes(menu.items(ctx), ctx, controller)}
    </DropdownMenu>
  );
}

/**
 * The one controller component both editors' menu bars are declared onto. Give
 * it a {@link MenuBarModel} and a context and it renders the whole bar with the
 * full keyboard navigation of the breakdown gold standard — start-aligned
 * menus in the menubar, end-aligned menus (e.g. a project chip) in the trailing
 * region, arbitrary leading/trailing chrome via slots.
 */
export function MenuBar<Ctx>({
  model,
  context,
  className,
  trailingClassName,
  popupClassName,
  globalActions = false,
  leading,
  trailing,
}: MenuBarProps<Ctx>) {
  const visible = model.menus.filter((menu) => menu.visible?.(context) ?? true);
  const order = visible.map((menu) => menu.id);
  const controller = useMenuBar(order, globalActions);
  const startMenus = visible.filter((menu) => menu.align !== 'end');
  const endMenus = visible.filter((menu) => menu.align === 'end');
  const renderMenu = (menu: MenuModel<Ctx>) => (
    <MenuButton
      key={menu.id}
      menu={menu}
      ctx={context}
      controller={controller}
      sharedPopupClassName={popupClassName}
    />
  );
  return (
    <header className={className ?? appStyles.masthead}>
      <div className={appStyles.appMenus}>
        {leading}
        <nav className={appStyles.menuBar} role="menubar" aria-label={model.ariaLabel}>
          {startMenus.map(renderMenu)}
        </nav>
      </div>
      {(endMenus.length > 0 || trailing) && (
        <div className={trailingClassName ?? appStyles.mastheadEnd}>
          {endMenus.map(renderMenu)}
          {trailing}
        </div>
      )}
    </header>
  );
}
