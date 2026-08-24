// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme, isThemeId } from './themes';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('themes', () => {
  it('validates theme ids strictly', () => {
    expect(isThemeId('nord')).toBe(true);
    expect(isThemeId('not-a-theme')).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it('applies a theme to the document and persists it', () => {
    document.body.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#000000">');
    const listener = vi.fn();
    window.addEventListener('coda:theme-change', listener);
    applyTheme('dracula');
    expect(document.documentElement.dataset.theme).toBe('dracula');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('coda-theme')).toBe('dracula');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: 'dracula' }));
    window.removeEventListener('coda:theme-change', listener);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.remove();
  });

  it('prefers the light scheme for the light theme', () => {
    applyTheme('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('falls back through saved theme, system preference, then default', () => {
    window.localStorage.setItem('coda-theme', 'tokyo-night');
    expect(initialTheme()).toBe('tokyo-night');

    window.localStorage.setItem('coda-theme', 'bogus');
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({ matches: query.includes('light') }),
      configurable: true,
    });
    expect(initialTheme()).toBe('light');
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false }),
      configurable: true,
    });
    expect(initialTheme()).toBe('coda-dark');
  });
});
