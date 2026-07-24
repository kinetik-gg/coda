export type AppActionId =
  | 'undoItem'
  | 'redoItem'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'textIncrease'
  | 'textDecrease'
  | 'textReset';

/**
 * Display-only shortcut identifiers. These name the keyboard chords rendered
 * beside menu items whose commands are handled elsewhere (CodeMirror keymaps,
 * component callbacks) rather than through the global {@link dispatchAppAction}
 * bus. Keeping them here means no menu renders a hand-typed platform string —
 * every shortcut label resolves through this layer.
 */
export type MenuShortcutId =
  | 'save'
  | 'saveCopy'
  | 'exportPdf'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'find'
  | 'replace'
  | 'findNext'
  | 'findPrevious'
  | 'formatBold'
  | 'formatItalic'
  | 'formatUnderline'
  | 'zenMode'
  | 'toggleFullscreen';

export type KeybindingId = AppActionId | MenuShortcutId;

interface Keybinding {
  code: string;
  shift?: boolean;
  alt?: boolean;
  /** When false the chord needs no Command/Ctrl modifier (e.g. F11). */
  mod?: boolean;
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

const menuShortcutKeybindings: Record<MenuShortcutId, readonly Keybinding[]> = {
  save: [{ code: 'KeyS' }],
  saveCopy: [{ code: 'KeyS', shift: true }],
  exportPdf: [{ code: 'KeyP' }],
  undo: [{ code: 'KeyZ' }],
  redo: [{ code: 'KeyZ', shift: true }],
  cut: [{ code: 'KeyX' }],
  copy: [{ code: 'KeyC' }],
  paste: [{ code: 'KeyV' }],
  selectAll: [{ code: 'KeyA' }],
  find: [{ code: 'KeyF' }],
  replace: [{ code: 'KeyF', alt: true }],
  findNext: [{ code: 'KeyG' }],
  findPrevious: [{ code: 'KeyG', shift: true }],
  formatBold: [{ code: 'KeyB' }],
  formatItalic: [{ code: 'KeyI' }],
  formatUnderline: [{ code: 'KeyU' }],
  zenMode: [{ code: 'Enter', shift: true }],
  toggleFullscreen: [{ code: 'F11', mod: false }],
};

const keybindingChords: Record<KeybindingId, readonly Keybinding[]> = {
  ...(Object.fromEntries(
    (Object.entries(appActions) as [AppActionId, AppActionDefinition][]).map(([id, action]) => [
      id,
      action.keybindings,
    ]),
  ) as Record<AppActionId, readonly Keybinding[]>),
  ...menuShortcutKeybindings,
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

export function getKeybindingLabel(actionId: KeybindingId) {
  const binding = keybindingChords[actionId][0];
  if (!binding) return undefined;
  const apple = isApplePlatform();
  const keys: string[] = [];
  if (binding.mod !== false) keys.push(apple ? '⌘' : 'Ctrl');
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
