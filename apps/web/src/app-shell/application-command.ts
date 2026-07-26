import type { KeybindingId } from '../keybindings';
import type { MenuNode } from './menu-bar';

/**
 * A command is the shared behavioural unit projected into both the application
 * menu and the command palette. Surface registries declare commands once; the
 * two pieces of chrome decide only how to render them.
 */
export interface ApplicationCommand<Ctx> {
  id: string;
  section: string;
  label: (ctx: Ctx) => string;
  keybinding?: KeybindingId;
  visible?: (ctx: Ctx) => boolean;
  enabled?: (ctx: Ctx) => boolean;
  disabledReason?: (ctx: Ctx) => string | undefined;
  checked?: (ctx: Ctx) => boolean;
  current?: (ctx: Ctx) => boolean;
  keywords?: readonly string[];
  dismissOnSelect?: boolean;
  run: (ctx: Ctx) => void;
}

export function isCommandVisible<Ctx>(command: ApplicationCommand<Ctx>, ctx: Ctx): boolean {
  return command.visible?.(ctx) ?? true;
}

export function isCommandEnabled<Ctx>(command: ApplicationCommand<Ctx>, ctx: Ctx): boolean {
  return command.enabled?.(ctx) ?? true;
}

/** Lifts one registry command into the shared declarative menu model. */
export function commandNode<Ctx>(command: ApplicationCommand<Ctx>): MenuNode<Ctx> {
  return {
    kind: 'action',
    id: command.id,
    label: (ctx) => command.label(ctx),
    ...(command.keybinding ? { keybinding: command.keybinding } : {}),
    enabled: (ctx) => isCommandEnabled(command, ctx),
    ...(command.disabledReason ? { disabledReason: command.disabledReason } : {}),
    ...(command.checked ? { checked: command.checked } : {}),
    ...(command.current ? { ariaCurrent: command.current } : {}),
    ...(command.dismissOnSelect !== undefined ? { dismissOnSelect: command.dismissOnSelect } : {}),
    run: (ctx) => command.run(ctx),
  };
}

/**
 * Resolves menu declarations written as command IDs, with `---` separators.
 * Visibility stays in the registry, so a menu and palette cannot disagree
 * about whether a command belongs on the current surface.
 */
export function commandItems<Ctx>(
  commands: readonly ApplicationCommand<Ctx>[],
  ...ids: readonly string[]
): (ctx: Ctx) => MenuNode<Ctx>[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  return (ctx) => {
    const nodes: MenuNode<Ctx>[] = [];
    ids.forEach((id, index) => {
      if (id === '---') {
        nodes.push({ kind: 'separator', id: `separator-${index}` });
        return;
      }
      const command = byId.get(id);
      if (!command) throw new Error(`Unknown application command: ${id}`);
      if (isCommandVisible(command, ctx)) nodes.push(commandNode(command));
    });
    return nodes;
  };
}
