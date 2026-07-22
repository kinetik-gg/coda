import type { AccountPreferences } from '@coda/contracts';
import { applyTheme, isThemeId } from './themes';

export const defaultAccountPreferences: AccountPreferences = {
  theme: 'coda-dark',
  fontSize: 'default',
  motion: 'system',
  pdfAppearance: 'theme',
};

export const fontSizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const;

export function applyAccountPreferences(preferences: AccountPreferences): void {
  applyTheme(preferences.theme);
  document.documentElement.dataset.fontSize = preferences.fontSize;
  document.documentElement.dataset.motion = preferences.motion;
  document.documentElement.dataset.pdfAppearance = preferences.pdfAppearance;
}

export function preferencesFromAccount(account: {
  theme?: string;
  fontSize?: string;
  motionPreference?: string;
  pdfAppearance?: string;
}): AccountPreferences {
  return {
    theme: isThemeId(account.theme) ? account.theme : defaultAccountPreferences.theme,
    fontSize: fontSizeOptions.some((option) => option.value === account.fontSize)
      ? (account.fontSize as AccountPreferences['fontSize'])
      : defaultAccountPreferences.fontSize,
    motion: account.motionPreference === 'reduced' ? 'reduced' : 'system',
    pdfAppearance:
      account.pdfAppearance === 'light' || account.pdfAppearance === 'dark'
        ? account.pdfAppearance
        : 'theme',
  };
}

export function workspaceFontScaleMultiplier(): number {
  switch (document.documentElement.dataset.fontSize) {
    case 'small':
      return 0.88;
    case 'medium':
      return 1.12;
    case 'large':
      return 1.25;
    case 'default':
    case undefined:
      return 1;
    default:
      return 1;
  }
}
