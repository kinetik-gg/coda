export type AppActionId =
  | 'undoItem'
  | 'redoItem'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'textIncrease'
  | 'textDecrease'
  | 'textReset';

interface Keybinding {
  code: string;
  shift?: boolean;
  alt?: boolean;
  alternateDisplayKey?: string;
}

interface AppActionDefinition {
  eventName: `coda:${string}`;
  keybindings: readonly Keybinding[];
}

interface NavigatorPlatformInfo {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

export const appActions: Record<AppActionId, AppActionDefinition> = {
  undoItem: {
    eventName: 'coda:undo-item',
    keybindings: [{ code: 'KeyZ' }],
  },
  redoItem: {
    eventName: 'coda:redo-item',
    keybindings: [{ code: 'KeyZ', shift: true }, { code: 'KeyY' }],
  },
  zoomIn: {
    eventName: 'coda:zoom-in',
    keybindings: [
      { code: 'Equal', shift: true, alternateDisplayKey: '+' },
      { code: 'NumpadAdd', alternateDisplayKey: '+' },
    ],
  },
  zoomOut: {
    eventName: 'coda:zoom-out',
    keybindings: [
      { code: 'Minus', alternateDisplayKey: '−' },
      { code: 'NumpadSubtract', alternateDisplayKey: '−' },
    ],
  },
  zoomReset: {
    eventName: 'coda:zoom-reset',
    keybindings: [
      { code: 'Digit0', alternateDisplayKey: '0' },
      { code: 'Numpad0', alternateDisplayKey: '0' },
    ],
  },
  textIncrease: { eventName: 'coda:text-increase', keybindings: [] },
  textDecrease: { eventName: 'coda:text-decrease', keybindings: [] },
  textReset: { eventName: 'coda:text-reset', keybindings: [] },
};

const applePlatformPattern = /Mac|iPhone|iPad|iPod/i;

export function isApplePlatform(platformInfo: NavigatorPlatformInfo = navigator) {
  const userAgentDataPlatform = platformInfo.userAgentData?.platform?.trim();
  if (userAgentDataPlatform) return applePlatformPattern.test(userAgentDataPlatform);

  return applePlatformPattern.test(
    `${platformInfo.platform ?? ''} ${platformInfo.userAgent ?? ''}`,
  );
}

function codeDisplay(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Equal') return '=';
  if (code === 'Minus') return '−';
  return code.replace('Numpad', 'Num ');
}

export function getKeybindingLabel(actionId: AppActionId) {
  const binding = appActions[actionId].keybindings[0];
  if (!binding) return undefined;
  const apple = isApplePlatform();
  const modifier = apple ? '⌘' : 'Ctrl';
  const keys = [modifier];
  if (binding.alt) keys.push(apple ? '⌥' : 'Alt');
  if (binding.shift && binding.alternateDisplayKey !== '+') keys.push(apple ? '⇧' : 'Shift');
  keys.push(binding.alternateDisplayKey ?? codeDisplay(binding.code));
  return apple ? keys.join('') : keys.join(' + ');
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
  );
}

export function actionForKeyboardEvent(event: KeyboardEvent): AppActionId | undefined {
  if (isEditableKeyboardTarget(event.target)) return undefined;
  const apple = isApplePlatform();
  const commandPressed = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!commandPressed) return undefined;

  for (const [actionId, action] of Object.entries(appActions) as [
    AppActionId,
    AppActionDefinition,
  ][]) {
    if (
      action.keybindings.some(
        (binding) =>
          binding.code === event.code &&
          Boolean(binding.shift) === event.shiftKey &&
          Boolean(binding.alt) === event.altKey,
      )
    ) {
      return actionId;
    }
  }
  return undefined;
}

export function dispatchAppAction(actionId: AppActionId, target: Window = window) {
  target.dispatchEvent(new CustomEvent(appActions[actionId].eventName));
}
