// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, initialTheme, themes } from './themes';
import {
  applyAccountPreferences,
  preferencesFromAccount,
  workspaceFontScaleMultiplier,
} from './account-preferences';

describe('theme preferences', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.fontSize;
    delete document.documentElement.dataset.motion;
    delete document.documentElement.dataset.pdfAppearance;
  });

  it('applies account-wide interface preferences', () => {
    applyAccountPreferences({
      theme: 'nord',
      fontSize: 'large',
      motion: 'reduced',
      pdfAppearance: 'dark',
    });
    expect(document.documentElement.dataset.theme).toBe('nord');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(document.documentElement.dataset.pdfAppearance).toBe('dark');
    expect(workspaceFontScaleMultiplier()).toBe(1.25);
  });

  it('offers the default, light, and nine palette themes', () => {
    expect(themes).toHaveLength(11);
    expect(themes.map((theme) => theme.id)).toContain('coda-dark');
    expect(themes.map((theme) => theme.id)).toContain('light');
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(11);
  });

  it('applies and restores a saved theme', () => {
    applyTheme('catppuccin-mocha');
    expect(document.documentElement.dataset.theme).toBe('catppuccin-mocha');
    expect(initialTheme()).toBe('catppuccin-mocha');
  });

  it('normalizes stored account values defensively', () => {
    expect(
      preferencesFromAccount({
        theme: 'nord',
        fontSize: 'small',
        motionPreference: 'reduced',
        pdfAppearance: 'light',
      }),
    ).toEqual({ theme: 'nord', fontSize: 'small', motion: 'reduced', pdfAppearance: 'light' });
    expect(
      preferencesFromAccount({
        theme: 'unknown',
        fontSize: 'huge',
        motionPreference: 'animated',
        pdfAppearance: 'sepia',
      }),
    ).toEqual({
      theme: 'coda-dark',
      fontSize: 'default',
      motion: 'system',
      pdfAppearance: 'theme',
    });
  });

  it.each([
    ['small', 0.88],
    ['medium', 1.12],
    ['large', 1.25],
    ['default', 1],
  ])('uses the %s workspace font multiplier', (fontSize, expected) => {
    document.documentElement.dataset.fontSize = fontSize;
    expect(workspaceFontScaleMultiplier()).toBe(expected);
  });
});
