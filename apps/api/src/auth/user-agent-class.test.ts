import { describe, expect, it } from 'vitest';
import { classifyUserAgent } from './user-agent-class';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/126.0.0.0`;
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0';
const SAFARI_MACOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('classifyUserAgent', () => {
  it.each([
    [CHROME_WINDOWS, 'Chrome on Windows'],
    [EDGE_WINDOWS, 'Edge on Windows'],
    [FIREFOX_LINUX, 'Firefox on Linux'],
    [SAFARI_MACOS, 'Safari on macOS'],
    [SAFARI_IOS, 'Safari on iOS'],
    [CHROME_ANDROID, 'Chrome on Android'],
  ])('classifies %s as %s', (userAgent, expected) => {
    expect(classifyUserAgent(userAgent)).toBe(expected);
  });

  it('falls back to Other for unrecognized browsers or platforms', () => {
    expect(classifyUserAgent('curl/8.4.0')).toBe('Other on Other');
  });

  it.each([undefined, null, '', '   '])('reports Unknown for %s user-agent input', (value) => {
    expect(classifyUserAgent(value)).toBe('Unknown');
  });

  it('never returns a label longer than 64 characters', () => {
    const absurd = `Chrome/1 ${'x'.repeat(200)}`;
    expect(classifyUserAgent(absurd).length).toBeLessThanOrEqual(64);
  });
});
