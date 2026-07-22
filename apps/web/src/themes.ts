export const themes = [
  { id: 'coda-dark', label: 'Coda Dark' },
  { id: 'light', label: 'Light' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'everforest', label: 'Everforest' },
  { id: 'rose-pine', label: 'Rosé Pine' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

const storageKey = 'coda-theme';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && themes.some((theme) => theme.id === value);
}

export function initialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (isThemeId(saved)) return saved;
  } catch {
    // Storage can be unavailable in hardened browser contexts. The theme still works in-session.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'coda-dark';
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  const themeColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--coda-body')
    .trim();
  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta && themeColor) themeMeta.content = themeColor;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // See initialTheme: persistence is best effort until account preferences are exposed by the API.
  }
  window.dispatchEvent(new CustomEvent<ThemeId>('coda:theme-change', { detail: theme }));
}
